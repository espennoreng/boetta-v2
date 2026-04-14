import { describe, it, expect } from "bun:test";
import { riksantikvarenCheckToolDefinition } from "./riksantikvaren";

describe("tool definition", () => {
  it("is named riksantikvaren_check and requires only matrikkel_id", () => {
    expect(riksantikvarenCheckToolDefinition.name).toBe("riksantikvaren_check");
    expect(riksantikvarenCheckToolDefinition.type).toBe("custom");
    const schema = riksantikvarenCheckToolDefinition.input_schema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(["matrikkel_id"]);
    expect(Object.keys(schema.properties)).toEqual(["matrikkel_id"]);
  });
});

import { riksantikvarenCheck } from "./riksantikvaren";
import { CoordCache } from "./cache";
import {
  emptyCollection,
  lokaliteterHit,
  enkeltminnerHit,
  sikringssonerHit,
  fredeteBygJHit,
  sefrakBygJHit,
  kulturmiljoerHit,
} from "./riksantikvaren.fixtures";

function primedCache(): CoordCache {
  const c = new CoordCache(10);
  c.set("4601-207-80", { utm33: [297000, 6699000] });
  return c;
}

function allEmptyFetch(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(emptyCollection), { status: 200 })) as unknown as typeof fetch;
}

describe("riksantikvaren_check", () => {
  it("returns has_any: false with all arrays empty when no layers hit", async () => {
    const raw = await riksantikvarenCheck(
      { matrikkel_id: "4601-207-80" },
      { fetchImpl: allEmptyFetch(), cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.source).toBe("Riksantikvaren");
    expect(parsed.findings.has_any).toBe(false);
    expect(parsed.findings.lokaliteter).toEqual([]);
    expect(parsed.findings.enkeltminner).toEqual([]);
    expect(parsed.findings.sikringssoner).toEqual([]);
    expect(parsed.findings.fredete_bygg).toEqual([]);
    expect(parsed.findings.sefrak_bygg).toEqual([]);
    expect(parsed.findings.kulturmiljoer).toEqual([]);
    expect(parsed.findings.partial_errors).toBeUndefined();
  });
});

function routingFetch(
  routes: Array<{ match: RegExp; body: unknown }>,
): typeof fetch {
  return (async (url: string) => {
    const route = routes.find((r) => r.match.test(url));
    if (!route) return new Response(JSON.stringify(emptyCollection), { status: 200 });
    return new Response(JSON.stringify(route.body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("riksantikvaren_check — all layers hit", () => {
  it("returns pruned attributes and has_any: true when every layer hits", async () => {
    const fetchImpl = routingFetch([
      { match: /MapServer\/7\/query/, body: lokaliteterHit },
      { match: /MapServer\/6\/query/, body: enkeltminnerHit },
      { match: /MapServer\/8\/query/, body: sikringssonerHit },
      { match: /MapServer\/1\/query/, body: fredeteBygJHit },
      { match: /MapServer\/2\/query/, body: sefrakBygJHit },
      { match: /MapServer\/15\/query/, body: kulturmiljoerHit },
    ]);
    const raw = await riksantikvarenCheck(
      { matrikkel_id: "4601-207-80" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings.has_any).toBe(true);
    expect(parsed.findings.lokaliteter).toEqual([
      {
        navn: "Bryggen",
        vernetype: "Fredet",
        vernelov: "Kulturminneloven",
        verneparagraf: "§ 15",
        link_askeladden: "https://askeladden.ra.no/lokalitet/45765",
      },
    ]);
    expect(parsed.findings.enkeltminner[0].navn).toBe("Bryggen — bygning nr. 12");
    expect(parsed.findings.sikringssoner).toEqual([
      {
        lokalitet_id: "45765",
        link_askeladden: "https://askeladden.ra.no/lokalitet/45765",
      },
    ]);
    expect(parsed.findings.fredete_bygg[0].navn).toBe("Bryggen, Jacobsfjorden");
    expect(parsed.findings.sefrak_bygg).toEqual([
      {
        hustype: "Bolighus",
        datering: "Før 1850",
        link_askeladden: "https://askeladden.ra.no/sefrak/99887",
      },
    ]);
    expect(parsed.findings.kulturmiljoer[0].navn).toBe("Bergen historiske havneområde");
    expect(parsed.findings.partial_errors).toBeUndefined();
  });
});
