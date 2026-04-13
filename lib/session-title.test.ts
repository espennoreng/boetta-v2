import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock the Anthropic SDK BEFORE importing the module under test.
const createMock = mock(async (_args: unknown) => ({
  content: [{ type: "text", text: "Byggesak i Bergen" }],
}));

mock.module("@anthropic-ai/sdk", () => {
  return {
    default: class AnthropicMock {
      messages = { create: createMock };
    },
  };
});

const { generateSessionTitle } = await import("./session-title");

beforeEach(() => {
  createMock.mockClear();
});

describe("generateSessionTitle", () => {
  it("calls Haiku with the user and assistant text and returns the title", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Fradeling av tomt" }],
    });

    const title = await generateSessionTitle({
      userMessage: "Kan jeg dele fra en tomt?",
      assistantMessage: "Ja, men det krever tillatelse...",
    });

    expect(title).toBe("Fradeling av tomt");
    expect(createMock).toHaveBeenCalledTimes(1);
    const args = createMock.mock.calls[0][0] as { model: string; max_tokens: number };
    expect(args.model).toBe("claude-haiku-4-5-20251001");
    expect(args.max_tokens).toBe(30);
  });

  it("strips surrounding quotes and trims whitespace", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: '  "Byggesak Bergen"\n' }],
    });

    const title = await generateSessionTitle({
      userMessage: "hei",
      assistantMessage: "hei",
    });

    expect(title).toBe("Byggesak Bergen");
  });

  it("truncates model input text to avoid token waste", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });

    const bigText = "a".repeat(5000);
    await generateSessionTitle({
      userMessage: bigText,
      assistantMessage: bigText,
    });

    const args = createMock.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    // Each side capped at 500 chars; content has both.
    expect(args.messages[0].content.length).toBeLessThan(1500);
  });

  it("returns null when the model returns empty text (fail-safe)", async () => {
    createMock.mockResolvedValueOnce({ content: [{ type: "text", text: "" }] });
    const title = await generateSessionTitle({
      userMessage: "x",
      assistantMessage: "y",
    });
    expect(title).toBeNull();
  });

  it("returns null when the API throws (never breaks the caller)", async () => {
    createMock.mockRejectedValueOnce(new Error("network"));
    const title = await generateSessionTitle({
      userMessage: "x",
      assistantMessage: "y",
    });
    expect(title).toBeNull();
  });
});
