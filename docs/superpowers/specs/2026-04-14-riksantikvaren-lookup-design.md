---
name: Riksantikvaren lookup (`riksantikvaren_check`)
description: Phase 2 of external-registers — adds cultural heritage point-in-polygon lookup via Riksantikvaren's open ArcGIS REST endpoint.
extends: 2026-04-13-external-registers-design.md
---

# Riksantikvaren lookup — `riksantikvaren_check`

## Goal

Add a byggesak agent tool that tells the saksbehandler, for a resolved property, whether any registered cultural heritage (kulturminner, fredete bygg, SEFRAK-bygg, kulturmiljø, sikringssoner) touches it — with a per-feature `linkAskeladden` URL so each finding is independently verifiable.

This is Phase 2 of the external-registers workstream. The architecture, Tier A contract, citation discipline, and failure semantics are defined in the Phase 1 spec and reused here without restatement.

## Non-goals

- Not shipping NGU (`radon`, `losmasser`) — separate design, separate implementation.
- Not surfacing per-source hover-card UI. Markdown links are sufficient, same as NVE.
- Not replacing fysisk inspeksjon. `has_any: false` means "no *registered* kulturminner," not "no kulturminner."

## Decisions

- **Single tool, fan-out, no `topic` param.** One `riksantikvaren_check(matrikkel_id)` call fans out across six layers in parallel. Heritage is one domain; splitting by topic (kulturminner vs SEFRAK vs kulturmiljø) would force multiple calls for the same underlying "is there anything heritage-relevant here?" question. Contrast with `nve_check`, where flom and skred are genuinely different hazard domains.
- **Grouped findings, not flat.** Output groups features by layer family (`lokaliteter`, `enkeltminner`, `sikringssoner`, `fredete_bygg`, `sefrak_bygg`, `kulturmiljoer`) because the legal treatment differs meaningfully by type (fredet ≠ listeført ≠ SEFRAK).
- **Per-feature `link_askeladden`.** The ArcGIS response already includes this field. Keeping it on every feature lets the agent render per-item markdown links rather than a single aggregate source link — the saksbehandler clicks through to the specific object, not a query URL.
- **No result cap.** Properties rarely exceed a handful of heritage features; hotspots (Bryggen) accept a longer response rather than silent truncation.
- **Open API, no auth.** Verified: `https://kart.ra.no/arcgis/rest/services/Distribusjon/Kulturminner20180301/MapServer` responds to `/query` without credentials. EPSG:25833 native (same as NVE and Kartverket) — no reprojection.

## Architecture

One new file plus two registrations; zero changes to `byggesak/agent.ts` composition.

```
lib/agents/norwegian-registers/
├── index.ts          # + register riksantikvaren_check in toolDefinitions + switch
├── http.ts           # reused — fetch + timeout + retry
├── types.ts          # reused
├── resolve.ts
├── nve.ts
├── riksantikvaren.ts # NEW
├── cache.ts          # reused — matrikkel_id → coords lookup
└── display-names.ts  # + "riksantikvaren_check" → "Oppslag kulturminne"
```

`riksantikvaren.ts` exports `riksantikvarenCheckToolDefinition` (`CustomToolDefinition`) and `riksantikvarenCheck(input)` returning `Promise<string>`, matching the existing Tier A contract exactly.

## Tool contract

### Input

```ts
{ matrikkel_id: string }   // canonical knr-gnr-bnr[-festenr]
```

Coords are read from `cache.ts`, populated by a prior `resolve_property` call. Cache miss → fail-fast error (see below).

### Output (success)

```ts
{
  source: "Riksantikvaren",
  source_url: string,   // aggregate query URL (layer 7 by convention)
  findings: {
    lokaliteter:    Array<{ navn: string, vernetype: string | null, vernelov: string | null, verneparagraf: string | null, link_askeladden: string }>,
    enkeltminner:   Array<{ navn: string, vernetype: string | null, vernelov: string | null, verneparagraf: string | null, link_askeladden: string }>,
    sikringssoner:  Array<{ lokalitet_id: string, link_askeladden: string }>,
    fredete_bygg:   Array<{ navn: string, vernelov: string | null, verneparagraf: string | null, link_askeladden: string }>,
    sefrak_bygg:    Array<{ hustype: string | null, datering: string | null, link_askeladden: string }>,
    kulturmiljoer:  Array<{ navn: string, vernetype: string | null, link_askeladden: string }>,
    has_any: boolean,
    partial_errors?: string[]   // only present if ≥1 layer failed
  }
}
```

Each feature pruned to 3–5 fields — not the full ArcGIS attribute dump.

### Output (failure)

Same shell as Phase 1 tools:

```ts
{ source: "Riksantikvaren", source_url: string, findings: null, error: string }
```

### Backend

Six parallel `ArcGIS REST /query` calls against layers on `https://kart.ra.no/arcgis/rest/services/Distribusjon/Kulturminner20180301/MapServer`:

| Layer | ID | Output group |
|---|---|---|
| Lokaliteter (polygon) | 7 | `lokaliteter` |
| Enkeltminner (polygon) | 6 | `enkeltminner` |
| Sikringssoner (polygon) | 8 | `sikringssoner` |
| FredaBygninger (point) | 1 | `fredete_bygg` |
| SefrakBygninger (point) | 2 | `sefrak_bygg` |
| Kulturmiljoer_flate (polygon) | 15 | `kulturmiljoer` |

Query shape (same pattern as `nve.ts`):

```
?geometry=<east>,<north>
&geometryType=esriGeometryPoint
&inSR=25833
&spatialRel=esriSpatialRelIntersects
&outFields=*
&f=json
```

Hit = `features.length > 0`.

## Error handling

Three-level cascade:

1. **Cache miss** — `matrikkel_id` not in coord cache. Return `{ findings: null, error: "Property not resolved — call resolve_property first" }`. Agent will (per system prompt) call `resolve_property` first.
2. **Partial layer failure** — 1–5 of 6 layers 5xx or timeout. Do **not** fail the whole call. Failed layer's array is `[]`; add `partial_errors: ["layer_7: timeout"]` to `findings`. Other layers' data is still useful.
3. **Total failure** — all 6 layers fail, or DNS/connect failure before any layer returns. Return `{ findings: null, error }`. Agent falls back to asking saksbehandler.

**Timeout:** 8s per layer (same as NVE). Six parallel — wall-clock bounded by slowest layer, not sum.

## System prompt additions

Append to the existing "Oppslag i offentlige registre" block in `byggesak/agent.ts`, after point 6 from Phase 1:

```
7. For spørsmål om kulturminner, fredning, SEFRAK eller
   kulturmiljø, kall riksantikvaren_check. Registrer hvert
   funn med sin egen link_askeladden i stedet for én samlet
   kilde — saksbehandler vil klikke seg videre til det
   aktuelle kulturminnet.
8. has_any: false betyr ingen registrerte kulturminner på
   eiendommen. Dette utelukker IKKE uregistrerte funn —
   fysisk inspeksjon kan fortsatt avdekke nye kulturminner.
```

Point 8 mirrors the Phase 1 `area_mapped: false` nuance: registered absence ≠ actual absence.

## Testing

Pattern identical to `nve.ts`:

1. **Unit tests** (`riksantikvaren.test.ts`)
   - One fixture per layer captured from a real call against Bryggen, Bergen → assert normalized output matches pruned shape.
   - Empty-features fixture → assert `has_any: false` and all six arrays empty.
   - Partial-failure mock → one layer throws; assert `partial_errors` populated, other five layers still parsed correctly.
2. **Live integration test** gated by `ENABLE_LIVE_API_TESTS=1`. Target: Bryggen, Bergen (guaranteed `has_any: true` with hits in lokaliteter, enkeltminner, and fredete_bygg). CI skips by default.

Fixtures committed to `lib/agents/norwegian-registers/__fixtures__/riksantikvaren/`.

## Display names

Add to `norwegian-registers/display-names.ts`:

```ts
"riksantikvaren_check": "Oppslag kulturminne"
```

## Out of scope for this spec

- NGU (`radon`, `losmasser`) — separate design.
- Vegvesen, Miljødirektoratet, Kartverket Plan — separate designs, Phase 4.
- Richer citation hover-card UI — deferred from Phase 1, still deferred.
- Multi-instance caching, rate limiting, auth-gated dataset access — inherited open questions from Phase 1 spec, still deferred.
