import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { presignGet } from "@/lib/r2";

const queries = makeQueries(db);

export async function GET(
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
  const row = await queries.getAttachmentForDownload({ id, clerkOrgId: ctx.orgId });
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  const url = await presignGet({ key: row.r2Key });
  return Response.redirect(url, 302);
}
