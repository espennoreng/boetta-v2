import { describe, it, expect } from "bun:test";
import { buildContentBlocksFromAttachments } from "./attachments";

describe("buildContentBlocksFromAttachments", () => {
  it("emits an image block for an image mime", () => {
    const blocks = buildContentBlocksFromAttachments({
      text: "what is this?",
      attachments: [
        {
          id: "1", mime: "image/png", anthropicFileId: "file_a",
          originalName: "x.png",
        },
      ],
    });
    expect(blocks).toEqual([
      { type: "image", source: { type: "file", file_id: "file_a" } },
      { type: "text", text: "what is this?" },
    ]);
  });

  it("emits a document block for a non-image mime, with title", () => {
    const blocks = buildContentBlocksFromAttachments({
      text: "summarize",
      attachments: [
        {
          id: "1", mime: "application/pdf", anthropicFileId: "file_b",
          originalName: "draw.pdf",
        },
      ],
    });
    expect(blocks).toEqual([
      { type: "document", source: { type: "file", file_id: "file_b" }, title: "draw.pdf" },
      { type: "text", text: "summarize" },
    ]);
  });

  it("preserves attachment order and appends text last", () => {
    const blocks = buildContentBlocksFromAttachments({
      text: "compare",
      attachments: [
        { id: "1", mime: "image/png", anthropicFileId: "fa", originalName: "a.png" },
        { id: "2", mime: "application/pdf", anthropicFileId: "fb", originalName: "b.pdf" },
      ],
    });
    expect(blocks.map((b) => b.type)).toEqual(["image", "document", "text"]);
  });

  it("omits the text block when text is empty", () => {
    const blocks = buildContentBlocksFromAttachments({
      text: "",
      attachments: [
        { id: "1", mime: "image/png", anthropicFileId: "fa", originalName: "a.png" },
      ],
    });
    expect(blocks).toEqual([
      { type: "image", source: { type: "file", file_id: "fa" } },
    ]);
  });

  it("throws if an attachment is missing its file_id", () => {
    expect(() =>
      buildContentBlocksFromAttachments({
        text: "x",
        attachments: [
          { id: "1", mime: "image/png", anthropicFileId: null, originalName: "a.png" },
        ],
      }),
    ).toThrow(/anthropicFileId/);
  });
});

import { resolveAttachmentsForChat } from "./attachments";

describe("resolveAttachmentsForChat", () => {
  it("uploads only rows missing anthropicFileId and persists the result", async () => {
    const persisted: Record<string, string> = {};
    const uploads: string[] = [];
    const out = await resolveAttachmentsForChat({
      rows: [
        { id: "1", r2Key: "k1", mime: "application/pdf", originalName: "a.pdf", anthropicFileId: null },
        { id: "2", r2Key: "k2", mime: "image/png", originalName: "b.png", anthropicFileId: "file_existing" },
      ],
      setAnthropicFileId: async ({ id, anthropicFileId }) => {
        persisted[id] = anthropicFileId;
      },
      upload: async ({ r2Key }) => {
        uploads.push(r2Key);
        return `file_for_${r2Key}`;
      },
    });
    expect(uploads).toEqual(["k1"]);
    expect(persisted).toEqual({ "1": "file_for_k1" });
    expect(out).toEqual([
      { id: "1", mime: "application/pdf", originalName: "a.pdf", anthropicFileId: "file_for_k1" },
      { id: "2", mime: "image/png", originalName: "b.png", anthropicFileId: "file_existing" },
    ]);
  });
});
