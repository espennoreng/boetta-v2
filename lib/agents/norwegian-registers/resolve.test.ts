import { describe, it, expect } from "bun:test";
import {
  resolvePropertyToolDefinition,
  resolveProperty,
  parseAdresserResponse,
  parseGeokodingResponse,
} from "./resolve";
import {
  adresserSokResponse,
  eiendomGeokodingResponse,
} from "./resolve.fixtures";
import { CoordCache } from "./cache";

describe("parseAdresserResponse", () => {
  it("normalizes the first hit into a PropertyIdentity", () => {
    const parsed = parseAdresserResponse(adresserSokResponse, "https://example");
    expect(parsed.matrikkel_id).toBe("0301-207-80");
    expect(parsed.matrikkelnummertekst).toBe("207/80");
    expect(parsed.address).toBe("Karl Johans gate 1, 0154 OSLO");
    expect(parsed.kommune).toBe("Oslo");
    expect(parsed.kommunenummer).toBe("0301");
    expect(parsed.coords_utm33).toEqual([597345.2, 6643212.8]);
    expect(parsed.objtype).toBe("Vegadresse");
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates![0].address).toContain("Karl Johans gate 1B");
  });

  it("omits candidates when exactly one hit", () => {
    const single = {
      ...adresserSokResponse,
      metadata: { ...adresserSokResponse.metadata, totaltAntallTreff: 1 },
      adresser: adresserSokResponse.adresser.slice(0, 1),
    };
    const parsed = parseAdresserResponse(single, "https://example");
    expect(parsed.candidates).toBeUndefined();
  });

  it("throws when no hits found", () => {
    expect(() =>
      parseAdresserResponse(
        { metadata: { totaltAntallTreff: 0 }, adresser: [] },
        "https://example",
      ),
    ).toThrow(/no address matches/i);
  });
});

describe("parseGeokodingResponse", () => {
  it("normalizes the first feature into a PropertyIdentity", () => {
    const parsed = parseGeokodingResponse(
      eiendomGeokodingResponse,
      "0301",
      207,
      80,
      "https://example",
    );
    expect(parsed.matrikkel_id).toBe("0301-207-80");
    expect(parsed.coords_utm33).toEqual([597345.2, 6643212.8]);
    expect(parsed.objtype).toBe("Matrikkeladresse");
    expect(parsed.address).toBe("");
  });
});

describe("resolveProperty (handler)", () => {
  it("uses adresser endpoint when given an address", async () => {
    const cache = new CoordCache(10);
    const fakeFetch = (async (url: string) => {
      expect(url).toContain("/adresser/v1/sok");
      return new Response(JSON.stringify(adresserSokResponse), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await resolveProperty(
      { address: "Karl Johans gate 1" },
      { fetchImpl: fakeFetch, cache },
    );
    expect(result.source).toBe("Kartverket");
    expect(result.matrikkel_id).toBe("0301-207-80");
    expect(result.coords_utm33).toEqual([597345.2, 6643212.8]);
    expect(cache.get("0301-207-80")?.utm33).toEqual([597345.2, 6643212.8]);
  });

  it("uses geokoding endpoint when given knr/gnr/bnr", async () => {
    const cache = new CoordCache(10);
    const fakeFetch = (async (url: string) => {
      expect(url).toContain("/eiendom/v1/geokoding");
      return new Response(JSON.stringify(eiendomGeokodingResponse), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await resolveProperty(
      { knr: "0301", gnr: 207, bnr: 80 },
      { fetchImpl: fakeFetch, cache },
    );
    expect(result.matrikkel_id).toBe("0301-207-80");
  });

  it("throws when neither address nor knr/gnr/bnr provided", async () => {
    await expect(resolveProperty({}, {})).rejects.toThrow(/address or knr/i);
  });
});

describe("tool definition", () => {
  it("is named resolve_property", () => {
    expect(resolvePropertyToolDefinition.name).toBe("resolve_property");
  });
});
