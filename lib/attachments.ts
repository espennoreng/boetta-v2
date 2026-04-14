import { uploadObjectToFiles } from "./anthropic-files";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "file"; file_id: string } }
  | {
      type: "document";
      source: { type: "file"; file_id: string };
      title?: string;
    };

export interface AttachmentForChat {
  id: string;
  mime: string;
  originalName: string;
  anthropicFileId: string | null;
}

export function buildContentBlocksFromAttachments(params: {
  text: string;
  attachments: Array<{
    id: string;
    mime: string;
    originalName: string;
    anthropicFileId: string | null;
  }>;
}): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const a of params.attachments) {
    if (!a.anthropicFileId) {
      throw new Error(
        `attachment ${a.id} is missing anthropicFileId — resolveAttachmentsForChat must run first`,
      );
    }
    if (a.mime.startsWith("image/")) {
      blocks.push({
        type: "image",
        source: { type: "file", file_id: a.anthropicFileId },
      });
    } else {
      blocks.push({
        type: "document",
        source: { type: "file", file_id: a.anthropicFileId },
        title: a.originalName,
      });
    }
  }
  if (params.text) {
    blocks.push({ type: "text", text: params.text });
  }
  return blocks;
}

/**
 * For each attachment row missing an anthropicFileId, upload the R2 object to
 * the Anthropic Files API, persist the returned file_id, and return rows ready
 * for the content-block builder. Idempotent: rows that already have a file_id
 * are passed through unchanged.
 */
export async function resolveAttachmentsForChat(params: {
  rows: Array<{
    id: string;
    r2Key: string;
    mime: string;
    originalName: string;
    anthropicFileId: string | null;
  }>;
  setAnthropicFileId: (p: { id: string; anthropicFileId: string }) => Promise<void>;
  upload?: typeof uploadObjectToFiles; // injectable for tests
}): Promise<AttachmentForChat[]> {
  const upload = params.upload ?? uploadObjectToFiles;
  const out: AttachmentForChat[] = [];
  for (const r of params.rows) {
    let fileId = r.anthropicFileId;
    if (!fileId) {
      fileId = await upload({
        r2Key: r.r2Key,
        mime: r.mime,
        originalName: r.originalName,
      });
      await params.setAnthropicFileId({ id: r.id, anthropicFileId: fileId });
    }
    out.push({
      id: r.id,
      mime: r.mime,
      originalName: r.originalName,
      anthropicFileId: fileId,
    });
  }
  return out;
}
