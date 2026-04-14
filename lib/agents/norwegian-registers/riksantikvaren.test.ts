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
import { emptyCollection } from "./riksantikvaren.fixtures";

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
