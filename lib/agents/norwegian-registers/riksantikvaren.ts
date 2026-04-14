// lib/agents/norwegian-registers/riksantikvaren.ts
import type { CustomToolDefinition } from "@/lib/agents/types";
import type { Fetcher, ToolFailure } from "./types";
import { fetchJson } from "./http";
import { CoordCache, globalCoordCache } from "./cache";

export const RA_BASE =
  "https://kart.ra.no/arcgis/rest/services/Distribusjon/Kulturminner20180301/MapServer";

// Layer IDs verified against the live ArcGIS MapServer.
// Keep this table aligned with the output groups in `findings`.
export const RA_LAYERS = {
  fredete_bygg: 1,      // FredaBygninger (point)
  sefrak_bygg: 2,       // SefrakBygninger (point)
  enkeltminner: 6,      // Enkeltminner (polygon)
  lokaliteter: 7,       // Lokaliteter (polygon)
  sikringssoner: 8,     // Sikringssoner (polygon)
  kulturmiljoer: 15,    // Kulturmiljoer_flate (polygon)
} as const;

export const riksantikvarenCheckToolDefinition: CustomToolDefinition = {
  type: "custom",
  name: "riksantikvaren_check",
  description:
    "Check Riksantikvaren's cultural heritage registers for a property. Call resolve_property first to get matrikkel_id. Returns any registered kulturminner, fredete bygninger, SEFRAK-bygninger, kulturmiljø, or sikringssoner that intersect the property, each with its own linkAskeladden URL. has_any: false means no REGISTERED heritage — does not rule out uregistrerte funn discovered on physical inspection.",
  input_schema: {
    type: "object",
    properties: {
      matrikkel_id: {
        type: "string",
        description: "Canonical property ID, e.g. '4601-207-80', from resolve_property",
      },
    },
    required: ["matrikkel_id"],
  },
};

export interface RaInput {
  matrikkel_id: string;
}

export interface RaDeps {
  fetchImpl?: Fetcher;
  cache?: CoordCache;
}

interface ArcGisFC {
  features: Array<{ attributes?: Record<string, unknown> }>;
}

export interface RaLokalitet {
  navn: string;
  vernetype: string | null;
  vernelov: string | null;
  verneparagraf: string | null;
  link_askeladden: string;
}

export interface RaEnkeltminne {
  navn: string;
  vernetype: string | null;
  vernelov: string | null;
  verneparagraf: string | null;
  link_askeladden: string;
}

export interface RaSikringssone {
  lokalitet_id: string;
  link_askeladden: string;
}

export interface RaFredetBygg {
  navn: string;
  vernelov: string | null;
  verneparagraf: string | null;
  link_askeladden: string;
}

export interface RaSefrakBygg {
  hustype: string | null;
  datering: string | null;
  link_askeladden: string;
}

export interface RaKulturmiljo {
  navn: string;
  vernetype: string | null;
  link_askeladden: string;
}

export interface RaFindings {
  lokaliteter: RaLokalitet[];
  enkeltminner: RaEnkeltminne[];
  sikringssoner: RaSikringssone[];
  fredete_bygg: RaFredetBygg[];
  sefrak_bygg: RaSefrakBygg[];
  kulturmiljoer: RaKulturmiljo[];
  has_any: boolean;
  partial_errors?: string[];
}

export interface RaResult {
  source: "Riksantikvaren";
  source_url: string;
  findings: RaFindings;
}

function pointQueryUrl(layerId: number, east: number, north: number): string {
  const params = new URLSearchParams({
    geometry: `${east},${north}`,
    geometryType: "esriGeometryPoint",
    inSR: "25833",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    f: "json",
  });
  return `${RA_BASE}/${layerId}/query?${params.toString()}`;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function queryLayer(
  layerId: number,
  east: number,
  north: number,
  fetchImpl?: Fetcher,
): Promise<ArcGisFC> {
  return fetchJson<ArcGisFC>(pointQueryUrl(layerId, east, north), {
    fetchImpl,
    timeoutMs: 8000,
  });
}

export async function riksantikvarenCheck(
  input: RaInput,
  deps: RaDeps = {},
): Promise<string> {
  const cache = deps.cache ?? globalCoordCache;
  const sourceUrl = `${RA_BASE}/${RA_LAYERS.lokaliteter}/query`;
  const entry = cache.get(input.matrikkel_id);
  if (!entry) {
    const failure: ToolFailure = {
      source: "Riksantikvaren",
      source_url: sourceUrl,
      findings: null,
      error: `matrikkel_id '${input.matrikkel_id}' not in coord cache — call resolve_property first`,
    };
    return JSON.stringify(failure);
  }
  const [east, north] = entry.utm33;

  const partial_errors: string[] = [];
  async function tryLayer(layerId: number): Promise<ArcGisFC> {
    try {
      return await queryLayer(layerId, east, north, deps.fetchImpl);
    } catch (err) {
      partial_errors.push(`layer_${layerId}: ${err instanceof Error ? err.message : String(err)}`);
      return { features: [] };
    }
  }

  const [lokR, enkR, sikR, fredR, sefR, kulR] = await Promise.all([
    tryLayer(RA_LAYERS.lokaliteter),
    tryLayer(RA_LAYERS.enkeltminner),
    tryLayer(RA_LAYERS.sikringssoner),
    tryLayer(RA_LAYERS.fredete_bygg),
    tryLayer(RA_LAYERS.sefrak_bygg),
    tryLayer(RA_LAYERS.kulturmiljoer),
  ]);

  if (partial_errors.length === Object.keys(RA_LAYERS).length) {
    const failure: ToolFailure = {
      source: "Riksantikvaren",
      source_url: sourceUrl,
      findings: null,
      error: `All ${Object.keys(RA_LAYERS).length} layers failed: ${partial_errors.join("; ")}`,
    };
    return JSON.stringify(failure);
  }

  const lokaliteter: RaLokalitet[] = lokR.features.map((f) => {
    const a = f.attributes ?? {};
    return {
      navn: str(a.navn) ?? "",
      vernetype: str(a.vernetype),
      vernelov: str(a.vernelov),
      verneparagraf: str(a.verneparagraf),
      link_askeladden: str(a.linkAskeladden) ?? "",
    };
  });

  const enkeltminner: RaEnkeltminne[] = enkR.features.map((f) => {
    const a = f.attributes ?? {};
    return {
      navn: str(a.navn) ?? "",
      vernetype: str(a.vernetype),
      vernelov: str(a.vernelov),
      verneparagraf: str(a.verneparagraf),
      link_askeladden: str(a.linkAskeladden) ?? "",
    };
  });

  const sikringssoner: RaSikringssone[] = sikR.features.map((f) => {
    const a = f.attributes ?? {};
    return {
      lokalitet_id: str(a.lokalitetID) ?? "",
      link_askeladden: str(a.linkAskeladden) ?? "",
    };
  });

  const fredete_bygg: RaFredetBygg[] = fredR.features.map((f) => {
    const a = f.attributes ?? {};
    return {
      navn: str(a.navn) ?? "",
      vernelov: str(a.vernelov),
      verneparagraf: str(a.verneparagraf),
      link_askeladden: str(a.linkAskeladden) ?? "",
    };
  });

  const sefrak_bygg: RaSefrakBygg[] = sefR.features.map((f) => {
    const a = f.attributes ?? {};
    return {
      hustype: str(a.hustype),
      datering: str(a.datering),
      link_askeladden: str(a.linkAskeladden) ?? "",
    };
  });

  const kulturmiljoer: RaKulturmiljo[] = kulR.features.map((f) => {
    const a = f.attributes ?? {};
    return {
      navn: str(a.navn) ?? "",
      vernetype: str(a.vernetype),
      link_askeladden: str(a.linkAskeladden) ?? "",
    };
  });

  const has_any =
    lokaliteter.length +
      enkeltminner.length +
      sikringssoner.length +
      fredete_bygg.length +
      sefrak_bygg.length +
      kulturmiljoer.length >
    0;

  const findings: RaFindings = {
    lokaliteter,
    enkeltminner,
    sikringssoner,
    fredete_bygg,
    sefrak_bygg,
    kulturmiljoer,
    has_any,
  };
  if (partial_errors.length > 0) findings.partial_errors = partial_errors;

  const result: RaResult = {
    source: "Riksantikvaren",
    source_url: sourceUrl,
    findings,
  };
  return JSON.stringify(result);
}
