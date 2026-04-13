import {
  createSession,
  streamWithToolHandling,
} from "@/lib/agent-manager";
import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { makeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { FileUIPart } from "ai";

const queries = makeQueries(db);
const audit = makeAudit(db);

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireActive();
  } catch (err) {
    const status = err instanceof Error && err.name === "NotActiveError" ? 403 : 401;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unauthorized" }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }

  const { message, sessionId: existingSessionId, files } =
    (await request.json()) as {
      message: string;
      sessionId?: string;
      files?: FileUIPart[];
    };

  let sessionId = existingSessionId;
  let eventForAudit: "session.created" | "session.opened" = "session.opened";

  if (!sessionId) {
    sessionId = await createSession({
      clerkOrgId: ctx.orgId,
      clerkUserId: ctx.userId,
    });
    eventForAudit = "session.created";
  } else {
    // Verify the caller's org owns this session
    const ownership = await queries.getSessionOwnership(sessionId);
    if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  await audit.logEvent({
    actorUserId: ctx.userId,
    actorOrgId: ctx.orgId,
    event: eventForAudit,
    subjectType: "session",
    subjectId: sessionId,
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of streamWithToolHandling(
          sessionId!,
          message,
          files ?? [],
        )) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
          if (event.type === "done") break;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Session-Id": sessionId,
    },
  });
}
