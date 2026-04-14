export interface UploadAttachmentResult {
  attachmentId: string;
}

/**
 * Uploads a single File to R2 via our presigned-URL flow.
 * Throws on any non-2xx — caller handles rendering.
 */
export async function uploadAttachment(params: {
  file: File;
  sessionId: string;
  signal?: AbortSignal;
}): Promise<UploadAttachmentResult> {
  const presignRes = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: params.signal,
    body: JSON.stringify({
      sessionId: params.sessionId,
      filename: params.file.name,
      mime: params.file.type,
      size: params.file.size,
    }),
  });
  if (!presignRes.ok) {
    const text = await presignRes.text();
    throw new Error(`presign failed (${presignRes.status}): ${text}`);
  }
  const { attachmentId, putUrl, headers } = (await presignRes.json()) as {
    attachmentId: string;
    putUrl: string;
    headers: Record<string, string>;
  };

  const putRes = await fetch(putUrl, {
    method: "PUT",
    body: params.file,
    headers, // { "Content-Type": params.file.type } — must match what was signed
    signal: params.signal,
  });
  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`R2 PUT failed (${putRes.status}): ${text}`);
  }

  const completeRes = await fetch(`/api/uploads/${attachmentId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: params.signal,
    body: JSON.stringify({ etag: putRes.headers.get("ETag") ?? null }),
  });
  if (!completeRes.ok) {
    const text = await completeRes.text();
    throw new Error(`complete failed (${completeRes.status}): ${text}`);
  }

  return { attachmentId };
}
