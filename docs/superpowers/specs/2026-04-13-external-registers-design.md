# External Norwegian Registers — Agent Tool Integration

## Goal

Reduce how often the byggesak agent asks the saksbehandler for facts that live in authoritative external registers (flom/skred, kulturminne, radon, matrikkel, vegfare, naturtype, reguleringsplan). Lookups are a *pre-check* that the agent cites with source + URL; legal determination still belongs to the saksbehandler.

## Non-goals

- Not replacing the saksbehandler's GIS/fagsystem. Results are indikasjon, not avgjørelse.
- Not building a general-purpose web browser/scraper. Each tool talks to a known, structured API.
- Not persisting lookup results across sessions. In-process LRU cache only.
- Not returning raw API payloads. Tool responses are normalized and pruned to fields the saksbehandler acts on.

## Decisions

- **Tool shape:** one tool per agency (with a `topic` enum where an agency covers multiple hazard types). Per-agency framing matches how the system already treats *source* as first-class (pbl/SAK10 citation discipline).
- **Property identity:** canonical key is `matrikkel_id` in the form `knr-gnr-bnr` (festenummer appended when present). `resolve_property` is the foundation; all other tools take `matrikkel_id`.
- **Trust model:** every tool response includes `source` + `source_url`. Agent must surface findings as *"Ifølge \[NVE Atlas\](URL) ligger tomta i flomsone F200 — bør bekreftes i kommunens fagsystem."*
- **Failure mode:** API down / no data / coverage gap → tool returns `findings: null, error`, agent falls back to asking the saksbehandler.
- **Phased:** full design approved upfront; Phase 1 ships `resolve_property` + `nve_check` (flom + skred). Later agencies are sketches.

## Architecture

Three tiers. Cross-cutting tool modules sit alongside agent-specific tool modules; agent modules compose them.

```
lib/agents/
├── types.ts
├── registry.ts
│
├── norwegian-registers/     # NEW — Tier A: cross-cutting
│   ├── index.ts             # toolDefinitions, ownsTool, handleToolCall
│   ├── http.ts              # fetch + timeout + retry helper
│   ├── types.ts
│   ├── resolve.ts           # Kartverket (adresser + eiendom/geokoding)
│   ├── nve.ts               # NVE ArcGIS REST
│   └── cache.ts             # in-process LRU: matrikkel_id → coords
│
└── byggesak/                # Tier C: agent module
    ├── agent.ts             # composes norwegian-registers + byggesak/tools
    ├── tools.ts             # Tier B: byggesak-specific (checklists + renamed find_checkpoints_by_law)
    ├── data.ts
    └── display-names.ts
```

**Tier A contract** — every cross-cutting module exports the same shape:

```ts
export const toolDefinitions: CustomToolDefinition[];
export function ownsTool(name: string): boolean;
export async function handleToolCall(name: string, input: Record<string, unknown>): Promise<string>;
```

**Agent composition** in `byggesak/agent.ts`:

```ts
import * as registers from "../norwegian-registers";
import * as byggesakTools from "./tools";

tools: [
  { type: "agent_toolset_20260401" },
  ...registers.toolDefinitions,
  ...byggesakTools.toolDefinitions,
]

async handleToolCall(name, input) {
  if (registers.ownsTool(name)) return registers.handleToolCall(name, input);
  return byggesakTools.handleToolCall(name, input);
}
```

A future `plansak` agent imports the same `registers` module and skips `byggesak/tools` — zero duplication.

### `shared-tools.ts` cleanup (included in Phase 1)

Today `shared-tools.ts` holds the `search_lovdata` *definition* but its handler lives in `byggesak/data.ts` against *local JSON* — the tool name implies a Lovdata API call, but it actually reverse-looks-up byggesak checkpoints that cite a given paragraph. Doubly misleading.

Actions:
1. Rename `search_lovdata` → `find_checkpoints_by_law`. Update description to reflect real behaviour.
2. Move both definition and handler fully into `byggesak/tools.ts`. It's a byggesak tool.
3. Delete `lib/agents/shared-tools.ts`.
4. Do NOT create an empty `lib/agents/lovdata/` module. If a real Lovdata-API integration lands later, create it then with an accurate tool name (e.g. `fetch_law_text`).

## Phase 1 tool contracts

### `resolve_property`

Resolve address OR matrikkel → canonical identity record. Fans out to the right Kartverket endpoint based on which input was provided.

**Backend:**
- Address path → `GET https://ws.geonorge.no/adresser/v1/sok?sok=...&utkoordsys=25833`
- Matrikkel path → `GET https://ws.geonorge.no/eiendom/v1/geokoding?kommunenummer=&gardsnummer=&bruksnummer=&utkoordsys=25833`

Both open, no auth.

**Input:**

```ts
{
  address?: string,         // OR
  knr?: string,             // 4-digit kommunenummer
  gnr?: number,
  bnr?: number,
  festenummer?: number,     // optional
  seksjonsnummer?: number   // optional
}
```

**Output (JSON-stringified):**

```ts
{
  source: "Kartverket",
  source_url: string,                       // exact request URL
  matrikkel_id: "4601-207-80",              // knr-gnr-bnr[-festenr]
  matrikkelnummertekst: "207/80",
  address: "Karl Johans gate 1, 0154 Oslo",
  kommune: "Oslo",
  kommunenummer: "0301",
  coords_utm33: [east, north],              // EPSG:25833
  coords_wgs84: [lon, lat],
  objtype: "Vegadresse" | "Matrikkeladresse",
  candidates?: [ /* up to 5 alternatives if address was ambiguous */ ]
}
```

Ambiguity: if the adresser API returns multiple hits, include up to 5 candidates and let the agent ask the saksbehandler which one. Tool also populates the coord cache (keyed by `matrikkel_id`) for downstream tools.

### `nve_check`

Point-in-polygon query against NVE's ArcGIS MapServices for flom or skred hazards.

**Backend:** `https://nve.geodataonline.no/arcgis/rest/services/<Service>/MapServer/<layer>/query?geometry=<lon>,<lat>&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson`

Hit = `features.length > 0`.

**Input:**

```ts
{ matrikkel_id: string, topic: "flom" | "skred" }
```

**Output (`topic = "flom"`):** fans out across three MapServices in parallel.

```ts
{
  source: "NVE (nve.geodataonline.no)",
  source_url: "https://atlas.nve.no/...",
  topic: "flom",
  findings: {
    flomsoner: [ { gjentaksintervall: 200, layer: "Flomsoner1/17" } ],  // [] if none
    in_aktsomhetsomrade_flom: boolean,
    area_mapped: boolean   // from FlomAktsomhet layer 2 (Dekning) — distinguishes "not in zone" from "not yet mapped"
  }
}
```

Layers queried: `Flomsoner1/MapServer/11..17` (return-period flomsoner), `FlomAktsomhet/MapServer/1` (aktsomhet), `FlomAktsomhet/MapServer/2` (coverage).

**Output (`topic = "skred"`):** fans out across three services.

```ts
{
  source: "NVE",
  source_url: string,
  topic: "skred",
  findings: {
    kvikkleire:  { in_aktsomhetsomrade: true,  skredtype_kode: 141 } | { in_aktsomhetsomrade: false },
    steinsprang: { in_utlosningsomrade: true, skredtype: "..."    } | { in_utlosningsomrade: false },
    snoskred:    { in_aktsomhetsomrade: true,  sikkerhetsklasse: "..." } | { in_aktsomhetsomrade: false }
  }
}
```

Services queried: `KvikkleireskredAktsomhet/MapServer/0`, `SkredSteinAktR/MapServer/1`, `SnoskredAktsomhet/MapServer/1`.

**Failure shape (all topics):**

```ts
{ source, source_url, topic, findings: null, error: string }
```

**Coverage handling (flom specific):** `area_mapped: false` means "ikke kartlagt", not "ikke i sone". Agent must report these distinctly.

## Phase 2+ tools (sketches, not implemented)

Same `{ source, source_url, findings | null, error? }` shell for all. Real endpoints verified at implementation time.

```
riksantikvaren_check(matrikkel_id)
  → { kulturminner: [...], sefrak: {...}, vernetype: "fredet" | null, ... }

ngu_check(matrikkel_id, topic: "radon" | "losmasser")
  → { radon_aktsomhet: "moderat-lav" | "moderat-hoy" | ..., losmassetype: "..." }

vegvesen_check(matrikkel_id)
  → { tilgrensende_veg: {...}, byggegrense_m: number | null, avkjoersel: {...} }

miljodir_check(matrikkel_id)
  → { naturtyper: [...], verneomraader: [...], prioriterte_arter: [...] }

kartverket_plan(matrikkel_id)
  → { reguleringsplan: {...}, arealformål: "...", bestemmelser_url: "..." }
```

## UI / citation integration

Phase 1 makes **no changes** to `lib/citations.ts`. The existing citation system is narrowly built around lovhjemmel patterns (`pbl § 21-2` + hover card → Lovdata). External sources don't fit.

External-register findings surface as **plain markdown links** in the agent's text — the tool always returns `source_url`, the system prompt instructs the agent to always render it with a human-readable label. Adequate for Phase 1.

Richer hover-card UX for external sources is deliberately deferred — per-source rendering is its own design exercise and isn't needed to reduce question volume.

## System prompt additions

Add to `lib/agents/byggesak/agent.ts` system prompt, between "Verktøybruk" and "Sjekkpunktindeks":

```
## Oppslag i offentlige registre

Før du ber saksbehandleren om faktaopplysninger om eiendommen,
sjekk om svaret finnes i registrene:

1. Identifiser eiendommen. Les adresse eller gnr/bnr fra søknaden.
   Hvis uklart, kall resolve_property først.
2. For spørsmål om flom- eller skredfare, kall nve_check.
3. Alle funn fra registrene MÅ presenteres med kilde som
   markdown-lenke: "[NVE Atlas](URL)". Ikke oppgi funn uten kilde.
4. Registrene er INDIKASJON, ikke avgjørelse. Avslutt slike
   funn med "– bør bekreftes i kommunens fagsystem".
5. Hvis et oppslag returnerer error eller findings: null, fall
   tilbake til å spørre saksbehandleren (som før).
6. area_mapped: false på flom betyr "ikke kartlagt", ikke "ikke i
   sone". Rapporter dette presist.
```

Also: rename any references to `search_lovdata` in the existing prompt to `find_checkpoints_by_law`.

## Testing

- Unit tests per parser: known Geonorge / NVE response fixtures → expected normalized output. Fixtures captured once from real API calls, committed to repo.
- One end-to-end integration test per tool hitting the live API with a known-stable property (e.g. Karl Johans gate 1, 0154 Oslo). Gated behind env flag so CI doesn't depend on network.
- No agent-level eval in this spec — separate workstream.

## Phasing

| Phase | Scope | Ship condition |
|---|---|---|
| 1 | `norwegian-registers/` scaffolding, `resolve_property`, `nve_check` (flom + skred), `search_lovdata` rename/move, `shared-tools.ts` deletion | Agent asks saksbehandler fewer flom/skred questions on a real test søknad |
| 2 | `riksantikvaren_check` | Verified Askeladden/Kulturminnesøk API access |
| 3 | `ngu_check` (radon + løsmasser) | Verified NGU endpoints |
| 4 | `vegvesen_check`, `miljodir_check`, `kartverket_plan` | One at a time, driven by which checkpoint gaps hurt most |

## Open questions (deliberately deferred)

- **Multi-instance caching.** Phase 1 uses in-process LRU. If deployment moves to multiple instances, need shared cache (Redis?). Not blocking.
- **Rate limiting.** Kartverket/NVE are open but not infinite. Add a semaphore if we hit limits. Not pre-optimizing.
- **Auth-gated APIs.** Riksantikvaren Askeladden (full dataset) and Kartverket matrikkel (full) require registration. Phase 2+ decides whether to register.
- **Ambiguous-address UX.** Tool returns `candidates[]` and agent asks; could later become a dedicated clarification turn.
