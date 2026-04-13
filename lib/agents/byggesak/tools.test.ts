import { describe, it, expect } from "bun:test";
import { handleToolCall, byggesakToolDefinitions } from "./tools";

describe("find_checkpoints_by_law", () => {
  it("is registered under the new name", () => {
    const names = byggesakToolDefinitions.map((t) => t.name);
    expect(names).toContain("find_checkpoints_by_law");
    expect(names).not.toContain("search_lovdata");
  });

  it("returns JSON when called with a valid lovhjemmel", async () => {
    const raw = await handleToolCall("find_checkpoints_by_law", {
      lovhjemmel: "pbl § 21-2",
    });
    const parsed = JSON.parse(raw);
    expect(parsed).toBeDefined();
  });
});
