import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const queries = makeQueries(db);

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params;
  await queries.markAttachmentUploaded({ id, clerkOrgId: ctx.orgId });
  return Response.json({ ok: true });
}
