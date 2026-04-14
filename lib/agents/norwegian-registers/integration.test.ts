import { describe, it, expect } from "bun:test";
import { resolveProperty } from "./resolve";
import { nveCheck } from "./nve";
import { riksantikvarenCheck } from "./riksantikvaren";
import { CoordCache } from "./cache";

const LIVE = process.env.RUN_LIVE_REGISTERS_TESTS === "1";
const d = LIVE ? describe : describe.skip;

d("live: Kartverket + NVE (gated by RUN_LIVE_REGISTERS_TESTS=1)", () => {
  const cache = new CoordCache(10);
  let matrikkelId = "";

  it("resolveProperty resolves a known address", async () => {
    const result = await resolveProperty(
      { address: "Karl Johans gate 1, 0154 Oslo" },
      { cache },
    );
    expect(result.matrikkel_id).toMatch(/^\d{4}-\d+-\d+/);
    expect(result.coords_utm33[0]).toBeGreaterThan(0);
    matrikkelId = result.matrikkel_id;
  }, 15000);

  it("nveCheck topic=flom returns a structured result for the same property", async () => {
    expect(matrikkelId).not.toBe("");
    const raw = await nveCheck({ matrikkel_id: matrikkelId, topic: "flom" }, { cache });
    const parsed = JSON.parse(raw);
    expect(parsed.topic).toBe("flom");
    expect(typeof parsed.findings.area_mapped).toBe("boolean");
  }, 15000);

  it("nveCheck topic=skred returns a structured result", async () => {
    expect(matrikkelId).not.toBe("");
    const raw = await nveCheck({ matrikkel_id: matrikkelId, topic: "skred" }, { cache });
    const parsed = JSON.parse(raw);
    expect(parsed.topic).toBe("skred");
    expect(parsed.findings.kvikkleire).toBeDefined();
    expect(parsed.findings.steinsprang).toBeDefined();
    expect(parsed.findings.snoskred).toBeDefined();
  }, 15000);

  it("riksantikvarenCheck returns has_any: true for Bryggen, Bergen", async () => {
    const bryggenCache = new CoordCache(10);
    const resolved = await resolveProperty(
      { address: "Bryggen 5, 5003 Bergen" },
      { cache: bryggenCache },
    );
    const raw = await riksantikvarenCheck(
      { matrikkel_id: resolved.matrikkel_id },
      { cache: bryggenCache },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.source).toBe("Riksantikvaren");
    expect(parsed.findings).not.toBeNull();
    expect(parsed.findings.has_any).toBe(true);
  }, 20000);
});
