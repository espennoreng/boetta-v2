import { interruptSession } from "@/lib/agent-manager";
import { requireActive, type CurrentContext } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const queries = makeQueries(db);

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

  let parsedBody: { sessionId?: string };
  try {
    parsedBody = (await request.json()) as typeof parsedBody;
  } catch {
    return new Response(
      JSON.stringify({ error: "Could not parse request body as JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { sessionId } = parsedBody;
  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: "Missing sessionId" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const ownership = await queries.getSessionOwnership(sessionId);
  if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    await interruptSession(sessionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
