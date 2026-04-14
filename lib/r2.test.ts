import { describe, it, expect } from "bun:test";
import { sanitizeFilename, buildR2Key } from "./r2";

describe("sanitizeFilename", () => {
  it("preserves a normal name", () => {
    expect(sanitizeFilename("byggesoknad.pdf")).toBe("byggesoknad.pdf");
  });
  it("replaces path separators", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("etc-passwd");
  });
  it("strips leading dots", () => {
    expect(sanitizeFilename(".env")).toBe("env");
  });
  it("collapses whitespace and weird chars to dashes", () => {
    expect(sanitizeFilename("My  File (v2).pdf")).toBe("My-File-v2.pdf");
  });
  it("preserves a trailing extension", () => {
    expect(sanitizeFilename("draw#1!.PDF")).toBe("draw-1.PDF");
  });
  it("truncates to a safe length, keeping the extension", () => {
    const long = "a".repeat(300) + ".pdf";
    const out = sanitizeFilename(long);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith(".pdf")).toBe(true);
  });
  it("falls back to 'file' when input is empty after sanitizing", () => {
    expect(sanitizeFilename("///")).toBe("file");
  });
});

describe("buildR2Key", () => {
  it("composes the canonical layout", () => {
    const key = buildR2Key({
      orgId: "org_abc",
      sessionId: "sess_123",
      uuid: "11111111-2222-3333-4444-555555555555",
      filename: "draw.pdf",
    });
    expect(key).toBe(
      "org/org_abc/session/sess_123/11111111-2222-3333-4444-555555555555-draw.pdf",
    );
  });
  it("sanitizes the filename component", () => {
    const key = buildR2Key({
      orgId: "o", sessionId: "s", uuid: "u", filename: "../bad name.pdf",
    });
    expect(key).toBe("org/o/session/s/u-bad-name.pdf");
  });
  it("rejects orgId with slashes", () => {
    expect(() =>
      buildR2Key({ orgId: "a/b", sessionId: "s", uuid: "u", filename: "x.pdf" }),
    ).toThrow(/orgId/);
  });
  it("rejects sessionId with traversal", () => {
    expect(() =>
      buildR2Key({ orgId: "o", sessionId: "..", uuid: "u", filename: "x.pdf" }),
    ).toThrow(/sessionId/);
  });
  it("rejects empty uuid", () => {
    expect(() =>
      buildR2Key({ orgId: "o", sessionId: "s", uuid: "", filename: "x.pdf" }),
    ).toThrow(/uuid/);
  });
});
