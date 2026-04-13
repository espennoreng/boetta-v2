// lib/agents/norwegian-registers/types.ts
export interface PropertyIdentity {
  matrikkel_id: string;
  matrikkelnummertekst: string;
  address: string;
  kommune: string;
  kommunenummer: string;
  coords_utm33: [number, number];  // [east, north] — EPSG:25833
  objtype: "Vegadresse" | "Matrikkeladresse";
}

export interface ResolveResult {
  source: "Kartverket";
  source_url: string;
  matrikkel_id: string;
  matrikkelnummertekst: string;
  address: string;
  kommune: string;
  kommunenummer: string;
  coords_utm33: [number, number];
  objtype: PropertyIdentity["objtype"];
  candidates?: PropertyIdentity[];
}

export interface ToolFailure {
  source: string;
  source_url: string;
  findings: null;
  error: string;
  topic?: string;
}

export type Fetcher = typeof fetch;
