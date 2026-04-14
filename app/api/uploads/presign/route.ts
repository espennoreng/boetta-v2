import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { buildR2Key, presignPut } from "@/lib/r2";

const queries = makeQueries(db);

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(request: Request) {
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

  let body: { sessionId: string; filename: string; mime: string; size: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.sessionId || !body.filename || !body.mime || typeof body.size !== "number") {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(body.mime)) {
    return Response.json({ error: `Unsupported mime: ${body.mime}` }, { status: 400 });
  }
  if (body.size <= 0 || body.size > MAX_BYTES) {
    return Response.json(
      { error: `size must be between 1 and ${MAX_BYTES} bytes` },
      { status: 400 },
    );
  }

  const ownership = await queries.getSessionOwnership(body.sessionId);
  if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const uuid = crypto.randomUUID();
  const r2Key = buildR2Key({
    orgId: ctx.orgId,
    sessionId: body.sessionId,
    uuid,
    filename: body.filename,
  });

  const attachmentId = await queries.createAttachment({
    clerkOrgId: ctx.orgId,
    clerkUserId: ctx.userId,
    anthropicSessionId: body.sessionId,
    r2Key,
    mime: body.mime,
    sizeBytes: body.size,
    originalName: body.filename,
  });

  const putUrl = await presignPut({ key: r2Key, contentType: body.mime });

  return Response.json({
    attachmentId,
    putUrl,
    headers: { "Content-Type": body.mime },
  });
}
