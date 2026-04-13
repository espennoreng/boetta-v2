import type { CustomToolDefinition } from "@/lib/agents/types";
import type { PropertyIdentity, ResolveResult, Fetcher } from "./types";
import { fetchJson } from "./http";
import { CoordCache, globalCoordCache } from "./cache";

const ADRESSER_URL = "https://ws.geonorge.no/adresser/v1/sok";
const GEOKODING_URL = "https://ws.geonorge.no/eiendom/v1/geokoding";

export const resolvePropertyToolDefinition: CustomToolDefinition = {
  type: "custom",
  name: "resolve_property",
  description:
    "Resolve a Norwegian property to a canonical identity record (matrikkel_id + coords + address). Accepts EITHER a free-text address OR a kommunenummer/gardsnummer/bruksnummer triple. Call this first before any other register lookup. If the address is ambiguous, returns up to 5 candidates so you can ask the saksbehandler which one.",
  input_schema: {
    type: "object",
    properties: {
      address: { type: "string", description: "Free-text address, e.g. 'Karl Johans gate 1, 0154 Oslo'" },
      knr: { type: "string", description: "4-digit kommunenummer, e.g. '0301'" },
      gnr: { type: "number", description: "Gardsnummer" },
      bnr: { type: "number", description: "Bruksnummer" },
      festenummer: { type: "number", description: "Festenummer (optional)" },
    },
    required: [],
  },
};

export interface AdresseHit {
  adressetekst?: string;
  postnummer?: string;
  poststed?: string;
  kommunenummer: string;
  kommunenavn: string;
  gardsnummer: number;
  bruksnummer: number;
  festenummer?: number;
  objtype: "Vegadresse" | "Matrikkeladresse";
  representasjonspunkt: { epsg: string; lat: number; lon: number };
}

export interface AdresserResponse {
  metadata: { totaltAntallTreff: number };
  adresser: AdresseHit[];
}

export interface GeokodingFeature {
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    kommunenummer: string;
    kommunenavn?: string;
    gardsnummer: number;
    bruksnummer: number;
    festenummer?: number;
    matrikkelnummertekst?: string;
  };
}

export interface GeokodingResponse {
  type: "FeatureCollection";
  features: GeokodingFeature[];
}

function matrikkelId(knr: string, gnr: number, bnr: number, festenr?: number): string {
  return festenr && festenr > 0 ? `${knr}-${gnr}-${bnr}-${festenr}` : `${knr}-${gnr}-${bnr}`;
}

function hitToIdentity(h: AdresseHit): PropertyIdentity {
  const festenr = h.festenummer ?? 0;
  const id = matrikkelId(h.kommunenummer, h.gardsnummer, h.bruksnummer, festenr);
  const addr = [h.adressetekst, [h.postnummer, h.poststed].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return {
    matrikkel_id: id,
    matrikkelnummertekst: `${h.gardsnummer}/${h.bruksnummer}`,
    address: addr,
    kommune: h.kommunenavn,
    kommunenummer: h.kommunenummer,
    coords_utm33: [h.representasjonspunkt.lon, h.representasjonspunkt.lat],
    objtype: h.objtype,
  };
}

export function parseAdresserResponse(
  data: AdresserResponse,
  sourceUrl: string,
): ResolveResult {
  if (!data.adresser?.length) {
    throw new Error("No address matches");
  }
  const [head, ...rest] = data.adresser.map(hitToIdentity);
  const result: ResolveResult = {
    source: "Kartverket",
    source_url: sourceUrl,
    matrikkel_id: head.matrikkel_id,
    matrikkelnummertekst: head.matrikkelnummertekst,
    address: head.address,
    kommune: head.kommune,
    kommunenummer: head.kommunenummer,
    coords_utm33: head.coords_utm33,
    objtype: head.objtype,
  };
  if (rest.length > 0) {
    result.candidates = rest.slice(0, 5);
  }
  return result;
}

export function parseGeokodingResponse(
  data: GeokodingResponse,
  knr: string,
  gnr: number,
  bnr: number,
  sourceUrl: string,
): ResolveResult {
  const feature = data.features?.[0];
  if (!feature) throw new Error("No matrikkel match");
  const [east, north] = feature.geometry.coordinates;
  const festenr = feature.properties.festenummer ?? 0;
  return {
    source: "Kartverket",
    source_url: sourceUrl,
    matrikkel_id: matrikkelId(knr, gnr, bnr, festenr),
    matrikkelnummertekst: feature.properties.matrikkelnummertekst ?? `${gnr}/${bnr}`,
    address: "",
    kommune: feature.properties.kommunenavn ?? "",
    kommunenummer: knr,
    coords_utm33: [east, north],
    objtype: "Matrikkeladresse",
  };
}

export interface ResolveInput {
  address?: string;
  knr?: string;
  gnr?: number;
  bnr?: number;
  festenummer?: number;
}

export interface ResolveDeps {
  fetchImpl?: Fetcher;
  cache?: CoordCache;
}

export async function resolveProperty(
  input: ResolveInput,
  deps: ResolveDeps = {},
): Promise<ResolveResult> {
  const cache = deps.cache ?? globalCoordCache;

  if (input.address) {
    const url = `${ADRESSER_URL}?sok=${encodeURIComponent(input.address)}&utkoordsys=25833&treffPerSide=6`;
    const data = await fetchJson<AdresserResponse>(url, { fetchImpl: deps.fetchImpl });
    const result = parseAdresserResponse(data, url);
    if (!result.candidates) {
      cache.set(result.matrikkel_id, { utm33: result.coords_utm33 });
    }
    return result;
  }

  if (input.knr && input.gnr !== undefined && input.bnr !== undefined) {
    const params = new URLSearchParams({
      kommunenummer: input.knr,
      gardsnummer: String(input.gnr),
      bruksnummer: String(input.bnr),
      utkoordsys: "25833",
    });
    if (input.festenummer !== undefined && input.festenummer > 0) {
      params.set("festenummer", String(input.festenummer));
    }
    const url = `${GEOKODING_URL}?${params.toString()}`;
    const data = await fetchJson<GeokodingResponse>(url, { fetchImpl: deps.fetchImpl });
    const result = parseGeokodingResponse(data, input.knr, input.gnr, input.bnr, url);
    cache.set(result.matrikkel_id, { utm33: result.coords_utm33 });
    return result;
  }

  throw new Error("resolveProperty requires either address or knr+gnr+bnr");
}
