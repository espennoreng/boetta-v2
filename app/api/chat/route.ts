import {
  createSession,
  streamWithToolHandling,
} from "@/lib/agent-manager";
import { requireActive, type CurrentContext } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { makeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { generateSessionTitle } from "@/lib/session-title";
import { resolveAttachmentsForChat } from "@/lib/attachments";

const queries = makeQueries(db);
const audit = makeAudit(db);

export async function POST(request: Request) {
  let ctx: CurrentContext;
  try {
    ctx = await requireActive();
  } catch (err) {
    const status = err instanceof Error && err.name === "NotActiveError" ? 403 : 401;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unauthorized" }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }

  let parsedBody: { message: string; sessionId?: string; attachmentIds?: string[] };
  try {
    parsedBody = (await request.json()) as typeof parsedBody;
  } catch {
    return new Response(
      JSON.stringify({ error: "Could not parse request body as JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { message, sessionId: existingSessionId, attachmentIds = [] } = parsedBody;

  if ((!message || message.trim().length === 0) && attachmentIds.length === 0) {
    return new Response(
      JSON.stringify({ error: "message or attachmentIds required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let sessionId = existingSessionId;
  let eventForAudit: "session.created" | "session.opened" = "session.opened";

  if (!sessionId) {
    sessionId = await createSession({
      clerkOrgId: ctx.orgId,
      clerkUserId: ctx.userId,
    });
    eventForAudit = "session.created";
  } else {
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

  const rows = attachmentIds.length
    ? await queries.getAttachmentsForChat({ ids: attachmentIds, clerkOrgId: ctx.orgId })
    : [];
  const resolved = await resolveAttachmentsForChat({
    rows,
    setAnthropicFileId: async ({ id, anthropicFileId }) =>
      queries.setAnthropicFileId({ id, anthropicFileId }),
  });

  const isNewSession = eventForAudit === "session.created";
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      let assistantText = "";
      let resolvedAddress: string | null = null;
      try {
        async function* runStream() {
          try {
            yield* streamWithToolHandling(sessionId!, message, resolved);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes("stale file_id")) throw err;
            for (const a of resolved) {
              await queries.clearAnthropicFileId({ id: a.id });
            }
            const reFetched = await queries.getAttachmentsForChat({
              ids: attachmentIds, clerkOrgId: ctx.orgId,
            });
            const reResolved = await resolveAttachmentsForChat({
              rows: reFetched,
              setAnthropicFileId: async ({ id, anthropicFileId }) =>
                queries.setAnthropicFileId({ id, anthropicFileId }),
            });
            yield* streamWithToolHandling(sessionId!, message, reResolved);
          }
        }

        for await (const event of runStream()) {
          if (event.type === "text" && typeof event.text === "string") {
            assistantText += event.text;
          }

          // Internal event: capture resolved property address for title,
          // but don't forward to the client.
          if (event.type === "property_address" && typeof event.address === "string") {
            resolvedAddress ??= event.address;
            continue;
          }

          // Forward every event except `done` — we defer `done` until after
          // we have optionally emitted `session_title`.
          if (event.type === "done") break;

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }

        // For newly created sessions with a non-empty assistant response,
        // set a title — prefer the resolved property address if available,
        // otherwise generate one via Haiku.
        if (isNewSession && assistantText.trim().length > 0) {
          const title =
            resolvedAddress ??
            (await generateSessionTitle({
              userMessage: message,
              assistantMessage: assistantText,
            }));
          if (title) {
            await queries.updateSessionTitle(sessionId!, title);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "session_title",
                  sessionId,
                  title,
                })}\n\n`,
              ),
            );
          }
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
        );
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
