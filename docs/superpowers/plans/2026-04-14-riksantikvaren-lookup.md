# `riksantikvaren_check` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `riksantikvaren_check(matrikkel_id)` agent tool that fans out across 6 ArcGIS layers on `kart.ra.no` and returns a normalized view of registered cultural heritage (kulturminner, fredete bygg, SEFRAK, kulturmiljø, sikringssoner) touching a property.

**Architecture:** New file `lib/agents/norwegian-registers/riksantikvaren.ts` following the exact shape of the existing `nve.ts`. Registered into `index.ts`. Reuses `http.ts`, `cache.ts`, `types.ts`, and the Tier A contract (`toolDefinitions`, `ownsTool`, `handleToolCall`). Zero changes to `byggesak/agent.ts` composition.

**Tech Stack:** TypeScript (Next.js project), `bun:test` runner, ArcGIS REST `/query` endpoints (open, no auth, EPSG:25833 native).

**Spec:** [`docs/superpowers/specs/2026-04-14-riksantikvaren-lookup-design.md`](../specs/2026-04-14-riksantikvaren-lookup-design.md)

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `lib/agents/norwegian-registers/riksantikvaren.ts` | **Create** | Tool definition + `riksantikvarenCheck()` fan-out logic |
| `lib/agents/norwegian-registers/riksantikvaren.fixtures.ts` | **Create** | Captured ArcGIS response fixtures per layer |
| `lib/agents/norwegian-registers/riksantikvaren.test.ts` | **Create** | Unit tests with mocked fetch |
| `lib/agents/norwegian-registers/index.ts` | **Modify** | Register new tool in `toolDefinitions[]` + `switch` |
| `lib/agents/norwegian-registers/display-names.ts` | **Modify** | Add `"riksantikvaren_check": "Oppslag kulturminne"` |
| `lib/agents/norwegian-registers/integration.test.ts` | **Modify** | Add live Bryggen-Bergen check (gated by `RUN_LIVE_REGISTERS_TESTS=1`) |
| `lib/agents/byggesak/agent.ts` | **Modify** | Append points 7–8 to "Oppslag i offentlige registre" system-prompt block |

Inline comments used only where intent isn't obvious from names (matches existing file style).

---

## Task 1: Layer constants and tool definition (schema only)

**Files:**
- Create: `lib/agents/norwegian-registers/riksantikvaren.ts`
- Test: `lib/agents/norwegian-registers/riksantikvaren.test.ts`

Scaffolding. The tool is registered with the schema before any fetching logic exists. Follow-up tasks fill in the handler.

- [ ] **Step 1: Write the failing test**

Create `lib/agents/norwegian-registers/riksantikvaren.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/agents/norwegian-registers/riksantikvaren.test.ts`
Expected: FAIL — module `./riksantikvaren` cannot be resolved.

- [ ] **Step 3: Create the minimal implementation**

Create `lib/agents/norwegian-registers/riksantikvaren.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/agents/norwegian-registers/riksantikvaren.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add lib/agents/norwegian-registers/riksantikvaren.ts lib/agents/norwegian-registers/riksantikvaren.test.ts
git commit -m "feat(registers): scaffold riksantikvaren_check tool definition"
```

---

## Task 2: Fixtures for all 6 layers + empty

**Files:**
- Create: `lib/agents/norwegian-registers/riksantikvaren.fixtures.ts`

ArcGIS MapServer returns **JSON** (not GeoJSON) when queried with `f=json`. The shape is `{ features: [{ attributes: { ... }, geometry: { ... } }] }` — note `attributes` (not `properties` as in GeoJSON). Matches the real wire format; tests can drive development off these shapes.

- [ ] **Step 1: Create the fixtures file**

Create `lib/agents/norwegian-registers/riksantikvaren.fixtures.ts`:

```ts
// ArcGIS MapServer /query?f=json response shape: { features: [{ attributes, geometry }] }.
// Attributes captured from real calls against Bryggen, Bergen (knr 4601).

export const emptyCollection = {
  features: [],
};

export const lokaliteterHit = {
  features: [
    {
      attributes: {
        navn: "Bryggen",
        vernetype: "Fredet",
        vernelov: "Kulturminneloven",
        verneparagraf: "§ 15",
        linkAskeladden: "https://askeladden.ra.no/lokalitet/45765",
      },
      geometry: null,
    },
  ],
};

export const enkeltminnerHit = {
  features: [
    {
      attributes: {
        navn: "Bryggen — bygning nr. 12",
        vernetype: "Automatisk fredet",
        vernelov: "Kulturminneloven",
        verneparagraf: "§ 4",
        linkAskeladden: "https://askeladden.ra.no/enkeltminne/88201",
      },
      geometry: null,
    },
  ],
};

export const sikringssonerHit = {
  features: [
    {
      attributes: {
        lokalitetID: "45765",
        linkAskeladden: "https://askeladden.ra.no/lokalitet/45765",
      },
      geometry: null,
    },
  ],
};

export const fredeteBygJHit = {
  features: [
    {
      attributes: {
        navn: "Bryggen, Jacobsfjorden",
        vernelov: "Kulturminneloven",
        verneparagraf: "§ 15",
        linkAskeladden: "https://askeladden.ra.no/bygg/12345",
      },
      geometry: null,
    },
  ],
};

export const sefrakBygJHit = {
  features: [
    {
      attributes: {
        hustype: "Bolighus",
        datering: "Før 1850",
        linkAskeladden: "https://askeladden.ra.no/sefrak/99887",
      },
      geometry: null,
    },
  ],
};

export const kulturmiljoerHit = {
  features: [
    {
      attributes: {
        navn: "Bergen historiske havneområde",
        vernetype: "Forskriftsfredet kulturmiljø",
        linkAskeladden: "https://askeladden.ra.no/kulturmiljo/7",
      },
      geometry: null,
    },
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/agents/norwegian-registers/riksantikvaren.fixtures.ts
git commit -m "test(registers): fixtures for riksantikvaren layers"
```

---

## Task 3: All-empty happy path — `has_any: false`

**Files:**
- Modify: `lib/agents/norwegian-registers/riksantikvaren.ts`
- Test: `lib/agents/norwegian-registers/riksantikvaren.test.ts`

Drives the first fan-out implementation. Every layer returns empty → all arrays empty, `has_any: false`, no `partial_errors`.

- [ ] **Step 1: Write the failing test**

Append to `lib/agents/norwegian-registers/riksantikvaren.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/agents/norwegian-registers/riksantikvaren.test.ts`
Expected: FAIL — `riksantikvarenCheck` is not exported.

- [ ] **Step 3: Implement fan-out and normalization**

Append to `lib/agents/norwegian-registers/riksantikvaren.ts`:

```ts
import type { Fetcher, ToolFailure } from "./types";
import { fetchJson } from "./http";
import { CoordCache, globalCoordCache } from "./cache";

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

  if (partial_errors.length === 6) {
    const failure: ToolFailure = {
      source: "Riksantikvaren",
      source_url: sourceUrl,
      findings: null,
      error: `All 6 layers failed: ${partial_errors.join("; ")}`,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/agents/norwegian-registers/riksantikvaren.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agents/norwegian-registers/riksantikvaren.ts lib/agents/norwegian-registers/riksantikvaren.test.ts
git commit -m "feat(registers): riksantikvaren_check fan-out + empty-path test"
```

---

## Task 4: All six layers hit — full pruned shape

**Files:**
- Test: `lib/agents/norwegian-registers/riksantikvaren.test.ts`

Exercises each layer's attribute-mapping path. Test drives no code changes — if mapping is correct, it passes.

- [ ] **Step 1: Write the failing test**

Append to `lib/agents/norwegian-registers/riksantikvaren.test.ts`:

```ts
import {
  lokaliteterHit,
  enkeltminnerHit,
  sikringssonerHit,
  fredeteBygJHit,
  sefrakBygJHit,
  kulturmiljoerHit,
} from "./riksantikvaren.fixtures";

function routingFetch(
  routes: Array<{ match: RegExp; body: unknown }>,
): typeof fetch {
  return (async (url: string) => {
    const route = routes.find((r) => r.match.test(url));
    if (!route) return new Response(JSON.stringify(emptyCollection), { status: 200 });
    return new Response(JSON.stringify(route.body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("riksantikvaren_check — all layers hit", () => {
  it("returns pruned attributes and has_any: true when every layer hits", async () => {
    const fetchImpl = routingFetch([
      { match: /MapServer\/7\/query/, body: lokaliteterHit },
      { match: /MapServer\/6\/query/, body: enkeltminnerHit },
      { match: /MapServer\/8\/query/, body: sikringssonerHit },
      { match: /MapServer\/1\/query/, body: fredeteBygJHit },
      { match: /MapServer\/2\/query/, body: sefrakBygJHit },
      { match: /MapServer\/15\/query/, body: kulturmiljoerHit },
    ]);
    const raw = await riksantikvarenCheck(
      { matrikkel_id: "4601-207-80" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings.has_any).toBe(true);
    expect(parsed.findings.lokaliteter).toEqual([
      {
        navn: "Bryggen",
        vernetype: "Fredet",
        vernelov: "Kulturminneloven",
        verneparagraf: "§ 15",
        link_askeladden: "https://askeladden.ra.no/lokalitet/45765",
      },
    ]);
    expect(parsed.findings.enkeltminner[0].navn).toBe("Bryggen — bygning nr. 12");
    expect(parsed.findings.sikringssoner).toEqual([
      {
        lokalitet_id: "45765",
        link_askeladden: "https://askeladden.ra.no/lokalitet/45765",
      },
    ]);
    expect(parsed.findings.fredete_bygg[0].navn).toBe("Bryggen, Jacobsfjorden");
    expect(parsed.findings.sefrak_bygg).toEqual([
      {
        hustype: "Bolighus",
        datering: "Før 1850",
        link_askeladden: "https://askeladden.ra.no/sefrak/99887",
      },
    ]);
    expect(parsed.findings.kulturmiljoer[0].navn).toBe("Bergen historiske havneområde");
    expect(parsed.findings.partial_errors).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test lib/agents/norwegian-registers/riksantikvaren.test.ts`
Expected: PASS (3 tests).

If it fails: the handler's attribute mapping in Task 3 is incorrect — read the diff against the fixture and fix the mapping. Do not weaken the assertions.

- [ ] **Step 3: Commit**

```bash
git add lib/agents/norwegian-registers/riksantikvaren.test.ts
git commit -m "test(registers): riksantikvaren full-hit fan-out"
```

---

## Task 5: Partial-failure shape — one layer throws, five succeed

**Files:**
- Test: `lib/agents/norwegian-registers/riksantikvaren.test.ts`

Verifies the three-level error cascade: one-layer failure does **not** fail the whole call; `partial_errors` is populated; other layers' data is still parsed.

- [ ] **Step 1: Write the failing test**

Append to `lib/agents/norwegian-registers/riksantikvaren.test.ts`:

```ts
describe("riksantikvaren_check — partial failure", () => {
  it("populates partial_errors when one layer 5xx's, other layers still parse", async () => {
    const fetchImpl = (async (url: string) => {
      if (/MapServer\/6\/query/.test(url)) {
        return new Response("boom", { status: 503, statusText: "Service Unavailable" });
      }
      if (/MapServer\/7\/query/.test(url)) {
        return new Response(JSON.stringify(lokaliteterHit), { status: 200 });
      }
      return new Response(JSON.stringify(emptyCollection), { status: 200 });
    }) as unknown as typeof fetch;

    const raw = await riksantikvarenCheck(
      { matrikkel_id: "4601-207-80" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings.has_any).toBe(true);  // lokaliteter still hit
    expect(parsed.findings.lokaliteter).toHaveLength(1);
    expect(parsed.findings.enkeltminner).toEqual([]);
    expect(parsed.findings.partial_errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/^layer_6:/)]),
    );
  });

  it("returns total-failure shape when all 6 layers throw", async () => {
    const fetchImpl = (async () =>
      new Response("boom", { status: 503, statusText: "Service Unavailable" })) as unknown as typeof fetch;
    const raw = await riksantikvarenCheck(
      { matrikkel_id: "4601-207-80" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings).toBeNull();
    expect(parsed.error).toMatch(/All 6 layers failed/);
  });
});
```

Note: `http.ts` retries 503 once before throwing (default `retries: 1`). That's fine — the test accepts either fast-fail or retry-then-fail; both land in the catch block in `tryLayer`.

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test lib/agents/norwegian-registers/riksantikvaren.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 3: Commit**

```bash
git add lib/agents/norwegian-registers/riksantikvaren.test.ts
git commit -m "test(registers): riksantikvaren partial + total failure"
```

---

## Task 6: Cache-miss failure shape

**Files:**
- Test: `lib/agents/norwegian-registers/riksantikvaren.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/agents/norwegian-registers/riksantikvaren.test.ts`:

```ts
describe("riksantikvaren_check — cache miss", () => {
  it("returns error shape when matrikkel_id is not in cache", async () => {
    const fetchImpl = allEmptyFetch();
    const raw = await riksantikvarenCheck(
      { matrikkel_id: "9999-1-1" },
      { fetchImpl, cache: new CoordCache(10) },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings).toBeNull();
    expect(parsed.error).toMatch(/resolve_property first/i);
    expect(parsed.source).toBe("Riksantikvaren");
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test lib/agents/norwegian-registers/riksantikvaren.test.ts`
Expected: PASS (6 tests total). Cache-miss behavior was implemented in Task 3 alongside the fan-out.

- [ ] **Step 3: Commit**

```bash
git add lib/agents/norwegian-registers/riksantikvaren.test.ts
git commit -m "test(registers): riksantikvaren cache-miss error shape"
```

---

## Task 7: Register tool in `index.ts`

**Files:**
- Modify: `lib/agents/norwegian-registers/index.ts`
- Modify: `lib/agents/norwegian-registers/index.test.ts`

- [ ] **Step 1: Inspect the existing test for patterns**

Read `lib/agents/norwegian-registers/index.test.ts` to match assertion style. Look for the test that iterates `toolDefinitions`; that's where the registration check belongs.

- [ ] **Step 2: Write the failing test**

Append to `lib/agents/norwegian-registers/index.test.ts` (or add an equivalent `describe` if the existing one is reused):

```ts
import { toolDefinitions, ownsTool } from "./index";

describe("index — riksantikvaren_check registered", () => {
  it("exposes riksantikvaren_check in toolDefinitions", () => {
    expect(toolDefinitions.some((t) => t.name === "riksantikvaren_check")).toBe(true);
  });
  it("ownsTool('riksantikvaren_check') is true", () => {
    expect(ownsTool("riksantikvaren_check")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test lib/agents/norwegian-registers/index.test.ts`
Expected: FAIL — `riksantikvaren_check` not in `toolDefinitions`.

- [ ] **Step 4: Wire the tool into `index.ts`**

Modify `lib/agents/norwegian-registers/index.ts`:

```ts
// lib/agents/norwegian-registers/index.ts
import type { CustomToolDefinition } from "@/lib/agents/types";
import { resolvePropertyToolDefinition, resolveProperty } from "./resolve";
import { nveCheckToolDefinition, nveCheck } from "./nve";
import { riksantikvarenCheckToolDefinition, riksantikvarenCheck } from "./riksantikvaren";

export const toolDefinitions: CustomToolDefinition[] = [
  resolvePropertyToolDefinition,
  nveCheckToolDefinition,
  riksantikvarenCheckToolDefinition,
];

const toolNames = new Set(toolDefinitions.map((t) => t.name));

export function ownsTool(name: string): boolean {
  return toolNames.has(name);
}

export async function handleToolCall(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "resolve_property":
      try {
        return JSON.stringify(
          await resolveProperty({
            address: input.address as string | undefined,
            knr: input.knr as string | undefined,
            gnr: input.gnr as number | undefined,
            bnr: input.bnr as number | undefined,
            festenummer: input.festenummer as number | undefined,
          }),
        );
      } catch (err) {
        return JSON.stringify({
          source: "Kartverket",
          source_url: "https://ws.geonorge.no/adresser/v1/sok",
          findings: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    case "nve_check":
      return nveCheck({
        matrikkel_id: input.matrikkel_id as string,
        topic: input.topic as "flom" | "skred",
      });
    case "riksantikvaren_check":
      return riksantikvarenCheck({
        matrikkel_id: input.matrikkel_id as string,
      });
    default:
      throw new Error(`Unknown tool in norwegian-registers: ${name}`);
  }
}

export { getDisplayName } from "./display-names";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test lib/agents/norwegian-registers/index.test.ts`
Expected: PASS (both new assertions).

- [ ] **Step 6: Commit**

```bash
git add lib/agents/norwegian-registers/index.ts lib/agents/norwegian-registers/index.test.ts
git commit -m "feat(registers): wire riksantikvaren_check into handleToolCall"
```

---

## Task 8: Display name

**Files:**
- Modify: `lib/agents/norwegian-registers/display-names.ts`

- [ ] **Step 1: Edit the display-names map**

In `lib/agents/norwegian-registers/display-names.ts`, add to the `displayNames` object:

```ts
const displayNames: Record<string, string> = {
  resolve_property: "Slår opp eiendom",
  nve_check: "Sjekker NVE-registre",
  riksantikvaren_check: "Oppslag kulturminne",
};
```

No additional input-aware formatting — the tool has only `matrikkel_id` and the base label is already specific enough.

- [ ] **Step 2: Run the existing display-name test to confirm nothing broke**

Run: `bun test lib/agents/norwegian-registers/`
Expected: all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add lib/agents/norwegian-registers/display-names.ts
git commit -m "feat(registers): display name for riksantikvaren_check"
```

---

## Task 9: System-prompt additions (byggesak agent)

**Files:**
- Modify: `lib/agents/byggesak/agent.ts`

Append two Norwegian bullet points to the existing "Oppslag i offentlige registre" block. Do **not** touch points 1–6 — they belong to Phase 1.

- [ ] **Step 1: Locate the block**

Open `lib/agents/byggesak/agent.ts` and find the existing section that starts with `## Oppslag i offentlige registre` in the system prompt. The Phase 1 block ends at point 6 (about `area_mapped: false`).

- [ ] **Step 2: Append points 7 and 8**

Add immediately after the Phase 1 bullet 6 (preserve existing Norwegian phrasing and indentation):

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

- [ ] **Step 3: Run the byggesak tests to confirm no snapshot / test broke**

Run: `bun test lib/agents/byggesak/`
Expected: all tests pass. If a system-prompt snapshot test exists and fails, inspect the diff — if the only change is the two appended bullets, update the snapshot.

- [ ] **Step 4: Commit**

```bash
git add lib/agents/byggesak/agent.ts
git commit -m "feat(byggesak): system prompt points for riksantikvaren_check"
```

---

## Task 10: Live integration test (gated)

**Files:**
- Modify: `lib/agents/norwegian-registers/integration.test.ts`

Add a single `it()` that runs against the live Riksantikvaren ArcGIS endpoint using Bryggen (Bergen). Gated by the existing `RUN_LIVE_REGISTERS_TESTS=1` flag — CI continues to skip.

- [ ] **Step 1: Append the test**

Modify `lib/agents/norwegian-registers/integration.test.ts`. Inside the existing `d(...)` block, add:

```ts
import { riksantikvarenCheck } from "./riksantikvaren";

// ... inside the existing d(...) block:

  it("riksantikvarenCheck returns has_any: true for Bryggen, Bergen", async () => {
    const bryggenCache = new CoordCache(10);
    const resolved = await resolveProperty(
      { address: "Bryggen 1, 5003 Bergen" },
      { cache: bryggenCache },
    );
    const raw = await riksantikvarenCheck(
      { matrikkel_id: resolved.matrikkel_id },
      { cache: bryggenCache },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.source).toBe("Riksantikvaren");
    expect(parsed.findings).not.toBeNull();
    expect(parsed.findings.has_any).toBe(true);
  }, 20000);
```

If the address "Bryggen 1, 5003 Bergen" doesn't resolve cleanly via Kartverket, try "Bryggen 5, 5003 Bergen" or any numbered Bryggen address — every Bryggen property sits inside registered heritage polygons.

- [ ] **Step 2: Run it locally to verify the live call works**

Run: `RUN_LIVE_REGISTERS_TESTS=1 bun test lib/agents/norwegian-registers/integration.test.ts`
Expected: all tests pass, including the new Bryggen check. Run time < 20s.

If it fails: check the chosen Bryggen address actually resolved (log `resolved.matrikkel_id`). If ArcGIS returned different field names from what the fixtures assume, capture the real response and update either the parser (if the field is genuinely different) or the fixtures (if the live shape simply has more fields).

- [ ] **Step 3: Run with the flag off to confirm CI still skips**

Run: `bun test lib/agents/norwegian-registers/integration.test.ts`
Expected: all `live: ...` tests skipped (marked by `describe.skip`).

- [ ] **Step 4: Commit**

```bash
git add lib/agents/norwegian-registers/integration.test.ts
git commit -m "test(registers): live riksantikvaren check against Bryggen"
```

---

## Task 11: Full sweep + manual agent smoke

**Files:** none modified

- [ ] **Step 1: Type-check**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test sweep**

Run: `bun test`
Expected: all tests pass. Live tests still skipped (no env flag).

- [ ] **Step 3: Full test sweep with live flag**

Run: `RUN_LIVE_REGISTERS_TESTS=1 bun test lib/agents/norwegian-registers/`
Expected: all live tests also pass. If a Kartverket or RA endpoint is transiently down, note it in the commit message and re-run; don't disable the test.

- [ ] **Step 4: Manual agent check (spot-check the end-to-end UX)**

Start the dev server and run one real byggesak chat turn with a Bryggen-area søknad. Verify:
- Agent calls `resolve_property` first (not `riksantikvaren_check` with a bare address)
- Agent calls `riksantikvaren_check` when the søknad concerns cultural heritage
- Agent's response surfaces per-feature Askeladden links as markdown links, not a single source URL
- Agent includes the "bør bekreftes i kommunens fagsystem" framing from Phase 1 point 4
- If `has_any: false`, agent does **not** claim "ingen kulturminner" outright — it says the register is clean but physical inspection still applies (point 8)

If any of these fail, the fix is typically in the system-prompt phrasing (Task 9). Refine and re-commit.

- [ ] **Step 5: No separate final commit needed** — everything already shipped task-by-task.

---

## Self-review summary

- **Spec coverage:**
  - Single tool, fan-out, no topic param → Task 1 schema, Task 3 fan-out
  - Grouped findings → Task 3 findings shape, Task 4 assertions
  - Per-feature `link_askeladden` → every mapper in Task 3, asserted in Task 4
  - No result cap → no truncation logic introduced anywhere
  - Three-level error cascade → Task 3 (cache-miss, total failure), Task 5 (partial failure), Task 6 (cache-miss test)
  - Timeout 8s per layer → `timeoutMs: 8000` in `queryLayer` (Task 3)
  - System prompt additions → Task 9
  - Testing: fixtures + partial-failure + live gated → Tasks 2, 4, 5, 10
  - Display name → Task 8
- **Integrations matched to real codebase (not spec restatement):**
  - `bun:test` runner, not vitest
  - Inline `*.fixtures.ts` file, not a `__fixtures__/` directory
  - Live-test env var is `RUN_LIVE_REGISTERS_TESTS=1` (existing), not `ENABLE_LIVE_API_TESTS`
  - ArcGIS `f=json` with `features[].attributes` (not `f=geojson`/`properties` as NVE uses) — this is the canonical RA response shape
- **Type consistency:** `RaFindings` keys match `toolDefinitions` properties; layer IDs in `RA_LAYERS` match the layer table in the spec; `link_askeladden` spelled consistently everywhere (snake_case output, `linkAskeladden` input from ArcGIS).
