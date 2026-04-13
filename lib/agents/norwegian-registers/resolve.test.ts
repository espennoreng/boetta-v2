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

  it("includes festenummer in matrikkel_id when > 0", () => {
    const withFeste = {
      metadata: { totaltAntallTreff: 1 },
      adresser: [
        {
          adressetekst: "Fjellveien 3",
          kommunenummer: "4601",
          kommunenavn: "Bergen",
          postnummer: "5003",
          poststed: "BERGEN",
          gardsnummer: 18,
          bruksnummer: 5,
          festenummer: 3,
          objtype: "Vegadresse" as const,
          representasjonspunkt: { epsg: "EPSG:25833", lat: 0, lon: 0 },
        },
      ],
    };
    const parsed = parseAdresserResponse(withFeste, "https://example");
    expect(parsed.matrikkel_id).toBe("4601-18-5-3");
  });

  it("caps candidates at 5 alternatives", () => {
    const many = {
      metadata: { totaltAntallTreff: 8 },
      adresser: Array.from({ length: 8 }, (_, i) => ({
        adressetekst: `Testgate ${i + 1}`,
        kommunenummer: "0301",
        kommunenavn: "Oslo",
        postnummer: "0154",
        poststed: "OSLO",
        gardsnummer: 1,
        bruksnummer: i + 1,
        festenummer: 0,
        objtype: "Vegadresse" as const,
        representasjonspunkt: { epsg: "EPSG:25833", lat: 0, lon: 0 },
      })),
    };
    const parsed = parseAdresserResponse(many, "https://example");
    expect(parsed.candidates).toHaveLength(5);
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
    expect(parsed.kommune).toBe("Oslo");
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
    expect(cache.get("0301-207-80")).toBeUndefined(); // ambiguous — cache not populated
  });

  it("caches coords only for unambiguous address matches", async () => {
    const singleHit = {
      ...adresserSokResponse,
      metadata: { ...adresserSokResponse.metadata, totaltAntallTreff: 1 },
      adresser: adresserSokResponse.adresser.slice(0, 1),
    };
    const cache = new CoordCache(10);
    const fakeFetch = (async () =>
      new Response(JSON.stringify(singleHit), { status: 200 })) as unknown as typeof fetch;
    const result = await resolveProperty(
      { address: "Karl Johans gate 1" },
      { fetchImpl: fakeFetch, cache },
    );
    expect(result.candidates).toBeUndefined();
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
