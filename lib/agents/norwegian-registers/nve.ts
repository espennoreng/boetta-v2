// lib/agents/norwegian-registers/nve.ts
import type { CustomToolDefinition } from "@/lib/agents/types";
import type { Fetcher, ToolFailure } from "./types";
import { fetchJson } from "./http";
import { CoordCache, globalCoordCache } from "./cache";

const NVE_BASE = "https://nve.geodataonline.no/arcgis/rest/services";
const NVE_ATLAS = "https://atlas.nve.no/";

export const nveCheckToolDefinition: CustomToolDefinition = {
  type: "custom",
  name: "nve_check",
  description:
    "Check NVE's flood or landslide hazard registers for a property. Call resolve_property first to get matrikkel_id. For topic='flom', returns which flomsoner (if any) the point lies in, whether it is inside a flood aktsomhetsområde, and whether the area is mapped at all (area_mapped=false means 'ikke kartlagt', not 'ikke i sone'). For topic='skred', returns per-hazard aktsomhet status (kvikkleire, steinsprang, snøskred).",
  input_schema: {
    type: "object",
    properties: {
      matrikkel_id: { type: "string", description: "Canonical property ID, e.g. '0301-207-80', from resolve_property" },
      topic: { type: "string", enum: ["flom", "skred"], description: "Which hazard family to check" },
    },
    required: ["matrikkel_id", "topic"],
  },
};

export interface NveInput {
  matrikkel_id: string;
  topic: "flom" | "skred";
}

export interface NveDeps {
  fetchImpl?: Fetcher;
  cache?: CoordCache;
}

interface GeoJsonFC {
  features: Array<{ properties?: Record<string, unknown> }>;
}

interface FlomResult {
  source: string;
  source_url: string;
  topic: "flom";
  findings: {
    flomsoner: Array<{ gjentaksintervall: number; layer: string }>;
    in_aktsomhetsomrade_flom: boolean;
    area_mapped: boolean;
  };
}

interface SkredResult {
  source: string;
  source_url: string;
  topic: "skred";
  findings: {
    kvikkleire:  { in_aktsomhetsomrade: true; skredtype_kode: number | null } | { in_aktsomhetsomrade: false };
    steinsprang: { in_utlosningsomrade: true; skredtype: string | null }    | { in_utlosningsomrade: false };
    snoskred:    { in_aktsomhetsomrade: true; sikkerhetsklasse: string | null } | { in_aktsomhetsomrade: false };
  };
}

function pointQueryUrl(service: string, layerId: number, east: number, north: number): string {
  const params = new URLSearchParams({
    geometry: `${east},${north}`,
    geometryType: "esriGeometryPoint",
    inSR: "25833",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    f: "geojson",
  });
  return `${NVE_BASE}/${service}/MapServer/${layerId}/query?${params.toString()}`;
}

async function queryLayer(
  service: string,
  layerId: number,
  east: number,
  north: number,
  fetchImpl?: Fetcher,
): Promise<GeoJsonFC> {
  const url = pointQueryUrl(service, layerId, east, north);
  return fetchJson<GeoJsonFC>(url, { fetchImpl });
}

const FLOMSONE_LAYERS: Array<{ layer: number; gjentaksintervall: number }> = [
  { layer: 11, gjentaksintervall: 10 },
  { layer: 12, gjentaksintervall: 20 },
  { layer: 13, gjentaksintervall: 50 },
  { layer: 14, gjentaksintervall: 100 },
  { layer: 15, gjentaksintervall: 200 },
  { layer: 16, gjentaksintervall: 500 },
  { layer: 17, gjentaksintervall: 1000 },
];

async function checkFlom(
  east: number,
  north: number,
  fetchImpl?: Fetcher,
): Promise<FlomResult> {
  const flomsonerPromises = FLOMSONE_LAYERS.map(async (l) => {
    const res = await queryLayer("Flomsoner1", l.layer, east, north, fetchImpl);
    if (res.features.length > 0) {
      return { gjentaksintervall: l.gjentaksintervall, layer: `Flomsoner1/${l.layer}` };
    }
    return null;
  });
  const [aktsomhetRes, dekningRes, flomsonerResults] = await Promise.all([
    queryLayer("FlomAktsomhet", 1, east, north, fetchImpl),
    queryLayer("FlomAktsomhet", 2, east, north, fetchImpl),
    Promise.all(flomsonerPromises),
  ]);
  const flomsoner = flomsonerResults.filter((x): x is NonNullable<typeof x> => x !== null);
  return {
    source: "NVE (nve.geodataonline.no)",
    source_url: NVE_ATLAS,
    topic: "flom",
    findings: {
      flomsoner,
      in_aktsomhetsomrade_flom: aktsomhetRes.features.length > 0,
      area_mapped: dekningRes.features.length > 0,
    },
  };
}

async function checkSkred(
  east: number,
  north: number,
  fetchImpl?: Fetcher,
): Promise<SkredResult> {
  const [kvikkleireRes, steinRes, snoRes] = await Promise.all([
    queryLayer("KvikkleireskredAktsomhet", 0, east, north, fetchImpl),
    queryLayer("SkredSteinAktR", 1, east, north, fetchImpl),
    queryLayer("SnoskredAktsomhet", 1, east, north, fetchImpl),
  ]);

  const kvikkleireHit = kvikkleireRes.features[0];
  const kvikkleireProps = kvikkleireHit?.properties ?? {};
  const kvikkleire: SkredResult["findings"]["kvikkleire"] = kvikkleireHit
    ? {
        in_aktsomhetsomrade: true,
        skredtype_kode: (kvikkleireProps.skredType as number | undefined) ?? null,
      }
    : { in_aktsomhetsomrade: false };

  const steinHit = steinRes.features[0];
  const steinProps = steinHit?.properties ?? {};
  const steinsprang: SkredResult["findings"]["steinsprang"] = steinHit
    ? {
        in_utlosningsomrade: true,
        skredtype: (steinProps.skredtype as string | undefined) ?? null,
      }
    : { in_utlosningsomrade: false };

  const snoHit = snoRes.features[0];
  const snoProps = snoHit?.properties ?? {};
  const snoskred: SkredResult["findings"]["snoskred"] = snoHit
    ? {
        in_aktsomhetsomrade: true,
        sikkerhetsklasse: (snoProps.sikkerhetsklasse as string | undefined) ?? null,
      }
    : { in_aktsomhetsomrade: false };

  return {
    source: "NVE",
    source_url: NVE_ATLAS,
    topic: "skred",
    findings: { kvikkleire, steinsprang, snoskred },
  };
}

export async function nveCheck(input: NveInput, deps: NveDeps = {}): Promise<string> {
  const cache = deps.cache ?? globalCoordCache;
  const entry = cache.get(input.matrikkel_id);
  if (!entry) {
    const failure: ToolFailure = {
      source: "NVE",
      source_url: NVE_ATLAS,
      topic: input.topic,
      findings: null,
      error: `matrikkel_id '${input.matrikkel_id}' not in coord cache — call resolve_property first`,
    };
    return JSON.stringify(failure);
  }
  try {
    const [east, north] = entry.utm33;
    if (input.topic === "flom") {
      return JSON.stringify(await checkFlom(east, north, deps.fetchImpl));
    }
    if (input.topic === "skred") {
      return JSON.stringify(await checkSkred(east, north, deps.fetchImpl));
    }
    throw new Error(`Unknown topic: ${input.topic}`);
  } catch (err) {
    const failure: ToolFailure = {
      source: "NVE",
      source_url: NVE_ATLAS,
      topic: input.topic,
      findings: null,
      error: err instanceof Error ? err.message : String(err),
    };
    return JSON.stringify(failure);
  }
}
