import { describe, it, expect } from "bun:test";
import { CoordCache } from "./cache";

describe("CoordCache", () => {
  it("stores and retrieves coords by matrikkel_id", () => {
    const cache = new CoordCache(10);
    cache.set("0301-207-80", { utm33: [1, 2] });
    expect(cache.get("0301-207-80")).toEqual({ utm33: [1, 2] });
  });

  it("returns undefined for unknown keys", () => {
    expect(new CoordCache(10).get("missing")).toBeUndefined();
  });

  it("evicts least-recently-used when over capacity", () => {
    const cache = new CoordCache(2);
    cache.set("a", { utm33: [0, 0] });
    cache.set("b", { utm33: [0, 0] });
    cache.get("a"); // touch a — b becomes LRU
    cache.set("c", { utm33: [0, 0] });
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeDefined();
  });
});
