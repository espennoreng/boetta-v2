// lib/agents/norwegian-registers/riksantikvaren.ts
import type { CustomToolDefinition } from "@/lib/agents/types";

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
