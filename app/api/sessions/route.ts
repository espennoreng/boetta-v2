import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const queries = makeQueries(db);

export async function GET() {
  let ctx;
  try {
    ctx = await requireActive();
  } catch (err) {
    const status = err instanceof Error && err.name === "NotActiveError" ? 403 : 401;
    return Response.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status },
    );
  }

  const rows = await queries.listSessionsForOrg(ctx.orgId);

  return Response.json({
    sessions: rows.map((r) => ({
      id: r.anthropicSessionId,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      agentType: r.agentType,
    })),
  });
}
