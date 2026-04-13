import { describe, it, expect } from "bun:test";
import {
  toolDefinitions,
  ownsTool,
  handleToolCall,
  getDisplayName,
} from "./index";

describe("norwegian-registers module entry", () => {
  it("exports both tool definitions", () => {
    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain("resolve_property");
    expect(names).toContain("nve_check");
  });

  it("ownsTool identifies registered tools", () => {
    expect(ownsTool("resolve_property")).toBe(true);
    expect(ownsTool("nve_check")).toBe(true);
    expect(ownsTool("get_checkpoints")).toBe(false);
  });

  it("handleToolCall dispatches nve_check with graceful cache-miss", async () => {
    const raw = await handleToolCall("nve_check", {
      matrikkel_id: "nonexistent",
      topic: "flom",
    });
    const parsed = JSON.parse(raw);
    expect(parsed.findings).toBeNull();
  });

  it("handleToolCall throws for unknown tool names", async () => {
    await expect(handleToolCall("not_a_tool", {})).rejects.toThrow(/unknown tool/i);
  });

  it("getDisplayName returns null for unknown tools", () => {
    expect(getDisplayName("not_a_tool")).toBeNull();
    expect(getDisplayName("resolve_property")).toBeTruthy();
  });
});
