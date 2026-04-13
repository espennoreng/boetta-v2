import { describe, it, expect } from "bun:test";
import { nveCheck, nveCheckToolDefinition } from "./nve";
import { CoordCache } from "./cache";
import {
  flomsonerHit,
  emptyCollection,
  aktsomhetHit,
  dekningHit,
  kvikkleireHit,
  steinsprangHit,
  snoskredHit,
} from "./nve.fixtures";

function primedCache(): CoordCache {
  const c = new CoordCache(10);
  c.set("0301-207-80", { utm33: [597345.2, 6643212.8] });
  return c;
}

function routingFetch(
  routes: Array<{ match: RegExp; body: unknown }>,
): typeof fetch {
  return (async (url: string) => {
    const route = routes.find((r) => r.match.test(url));
    if (!route) return new Response(JSON.stringify(emptyCollection), { status: 200 });
    return new Response(JSON.stringify(route.body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("nve_check topic=flom", () => {
  it("reports flomsone hit with gjentaksintervall and area_mapped=true", async () => {
    const fetchImpl = routingFetch([
      { match: /Flomsoner1\/MapServer\/17\/query/, body: flomsonerHit },
      { match: /FlomAktsomhet\/MapServer\/1\/query/, body: aktsomhetHit },
      { match: /FlomAktsomhet\/MapServer\/2\/query/, body: dekningHit },
    ]);
    const raw = await nveCheck(
      { matrikkel_id: "0301-207-80", topic: "flom" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings.flomsoner).toEqual([
      { gjentaksintervall: 1000, layer: "Flomsoner1/17" },
    ]);
    expect(parsed.findings.in_aktsomhetsomrade_flom).toBe(true);
    expect(parsed.findings.area_mapped).toBe(true);
  });

  it("reports area_mapped=false when Dekning layer has no hit", async () => {
    const fetchImpl = routingFetch([]); // all layers empty
    const raw = await nveCheck(
      { matrikkel_id: "0301-207-80", topic: "flom" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings.flomsoner).toEqual([]);
    expect(parsed.findings.in_aktsomhetsomrade_flom).toBe(false);
    expect(parsed.findings.area_mapped).toBe(false);
  });

  it("returns error shape when matrikkel_id is not in cache", async () => {
    const fetchImpl = routingFetch([]);
    const raw = await nveCheck(
      { matrikkel_id: "9999-1-1", topic: "flom" },
      { fetchImpl, cache: new CoordCache(10) },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings).toBeNull();
    expect(parsed.error).toMatch(/resolve_property first/i);
  });
});

describe("tool definition", () => {
  it("is named nve_check with flom+skred enum", () => {
    expect(nveCheckToolDefinition.name).toBe("nve_check");
    const schema = nveCheckToolDefinition.input_schema as {
      properties: { topic: { enum: string[] } };
    };
    expect(schema.properties.topic.enum).toEqual(["flom", "skred"]);
  });
});

describe("nve_check topic=skred", () => {
  it("reports per-hazard aktsomhet status when all three hit", async () => {
    const fetchImpl = routingFetch([
      { match: /KvikkleireskredAktsomhet\/MapServer\/0\/query/, body: kvikkleireHit },
      { match: /SkredSteinAktR\/MapServer\/1\/query/, body: steinsprangHit },
      { match: /SnoskredAktsomhet\/MapServer\/1\/query/, body: snoskredHit },
    ]);
    const raw = await nveCheck(
      { matrikkel_id: "0301-207-80", topic: "skred" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings.kvikkleire).toEqual({
      in_aktsomhetsomrade: true,
      skredtype_kode: 141,
    });
    expect(parsed.findings.steinsprang.in_utlosningsomrade).toBe(true);
    expect(parsed.findings.snoskred.in_aktsomhetsomrade).toBe(true);
  });

  it("reports not-in-zone for all three when no hits", async () => {
    const fetchImpl = routingFetch([]);
    const raw = await nveCheck(
      { matrikkel_id: "0301-207-80", topic: "skred" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings.kvikkleire.in_aktsomhetsomrade).toBe(false);
    expect(parsed.findings.steinsprang.in_utlosningsomrade).toBe(false);
    expect(parsed.findings.snoskred.in_aktsomhetsomrade).toBe(false);
  });
});
