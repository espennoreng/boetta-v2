# External Norwegian Registers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the external-registers design — `resolve_property` (Kartverket) and `nve_check` (NVE flom + skred) as custom tools on the byggesak agent, plus the `shared-tools.ts` → `find_checkpoints_by_law` cleanup.

**Architecture:** New `lib/agents/norwegian-registers/` module exposing the Tier A contract (`toolDefinitions`, `ownsTool`, `handleToolCall`). `byggesak/agent.ts` composes it. Each tool is a pure `parseXxx(json)` function + an async handler that calls the parser over `fetchJson`. In-process LRU caches coord resolutions.

**Tech Stack:** TypeScript, Next.js 16, Bun test runner (`bun:test`), native `fetch`. No new runtime dependencies.

**Related spec:** `docs/superpowers/specs/2026-04-13-external-registers-design.md`

---

## File Structure

```
lib/agents/
├── norwegian-registers/             # NEW
│   ├── index.ts                     # exports toolDefinitions, ownsTool, handleToolCall, displayNames
│   ├── types.ts                     # PropertyIdentity, RegisterResult, etc.
│   ├── http.ts                      # fetchJson with timeout + one retry
│   ├── http.test.ts
│   ├── cache.ts                     # tiny LRU, matrikkel_id → coords
│   ├── cache.test.ts
│   ├── resolve.ts                   # resolve_property tool
│   ├── resolve.test.ts
│   ├── resolve.fixtures.ts          # captured Geonorge responses
│   ├── nve.ts                       # nve_check tool
│   ├── nve.test.ts
│   ├── nve.fixtures.ts              # captured NVE ArcGIS responses
│   ├── display-names.ts             # Norwegian labels
│   └── integration.test.ts          # live-API tests, env-gated
│
├── byggesak/
│   ├── agent.ts                     # MODIFIED: compose registers, extend system prompt
│   ├── tools.ts                     # MODIFIED: absorb find_checkpoints_by_law
│   └── display-names.ts             # MODIFIED: rename key
│
└── shared-tools.ts                  # DELETED
```

---

## Task 1: Rename `search_lovdata` → `find_checkpoints_by_law`, delete `shared-tools.ts`

**Why first:** Gets an existing naming smell out of the way so the new module isn't designed around a legacy mistake. Pure rename + relocation, no behaviour change.

**Files:**
- Modify: `lib/agents/byggesak/tools.ts`
- Modify: `lib/agents/byggesak/display-names.ts`
- Modify: `lib/agents/byggesak/agent.ts`
- Delete: `lib/agents/shared-tools.ts`
- Test: `lib/agents/byggesak/tools.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `lib/agents/byggesak/tools.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { handleToolCall, byggesakToolDefinitions } from "./tools";

describe("find_checkpoints_by_law", () => {
  it("is registered under the new name", () => {
    const names = byggesakToolDefinitions.map((t) => t.name);
    expect(names).toContain("find_checkpoints_by_law");
    expect(names).not.toContain("search_lovdata");
  });

  it("returns JSON when called with a valid lovhjemmel", async () => {
    const raw = await handleToolCall("find_checkpoints_by_law", {
      lovhjemmel: "pbl § 21-2",
    });
    const parsed = JSON.parse(raw);
    expect(parsed).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/agents/byggesak/tools.test.ts`
Expected: FAIL — tool not registered under new name.

- [ ] **Step 3: Add the renamed tool definition to `byggesak/tools.ts`**

In `lib/agents/byggesak/tools.ts`, append to `byggesakToolDefinitions` array:

```ts
{
  type: "custom",
  name: "find_checkpoints_by_law",
  description:
    "Given a law reference (e.g. 'pbl § 21-2', 'SAK10 § 5-4'), return all byggesak checkpoints that cite it. Use to discover which checks are tied to a particular lovhjemmel. This does NOT fetch law text from Lovdata — it reverse-looks-up local checkpoint data.",
  input_schema: {
    type: "object",
    properties: {
      lovhjemmel: {
        type: "string",
        description: "Law reference, e.g. 'pbl § 21-2', 'SAK10 § 5-4'",
      },
    },
    required: ["lovhjemmel"],
  },
},
```

Then add a handler case in the same file's `handleToolCall` switch:

```ts
case "find_checkpoints_by_law":
  return JSON.stringify(
    searchLovdata(input.lovhjemmel as string),
  );
```

(`searchLovdata` is already imported from `./data` — keep that import.)

- [ ] **Step 4: Remove the old `search_lovdata` branch from `byggesak/tools.ts`**

Delete the `case "search_lovdata":` branch in `handleToolCall` (the one at lines 171-174 of current file). The import from `./data` stays.

- [ ] **Step 5: Update `byggesak/agent.ts`**

In `lib/agents/byggesak/agent.ts`:

1. Delete the import of `sharedToolDefinitions`:
   ```ts
   import { sharedToolDefinitions } from "@/lib/agents/shared-tools";
   ```
2. Delete `...sharedToolDefinitions,` from the `tools:` array in `createAgentConfig`.
3. Delete the `if (name === "search_lovdata")` branch from `handleToolCall` — the rename moves it into `byggesakHandleToolCall` already.
4. Delete the unused `searchLovdata` import from `./data`.
5. Update the system prompt's "Verktøybruk" section — replace the line `- Bruk search_lovdata når du diskuterer det rettslige grunnlaget for et krav.` with `- Bruk find_checkpoints_by_law for å finne sjekkpunkter som siterer en bestemt lovhjemmel.`.

- [ ] **Step 6: Update `byggesak/display-names.ts`**

Replace the `search_lovdata` key with `find_checkpoints_by_law` (both in the `displayNames` record and the `switch` branch):

```ts
const displayNames: Record<string, string> = {
  get_checklist_overview: "Henter sjekkliste-oversikt",
  get_checkpoints: "Henter sjekkpunkter",
  get_checkpoint_detail: "Henter detaljer for sjekkpunkt",
  evaluate_rules: "Evaluerer regler",
  search_checkpoints: "Søker i sjekkpunkter",
  find_checkpoints_by_law: "Finner sjekkpunkter som siterer lovhjemmel",
};
```

```ts
case "find_checkpoints_by_law":
  return input.lovhjemmel
    ? `${base}: ${input.lovhjemmel}`
    : base;
```

- [ ] **Step 7: Delete `lib/agents/shared-tools.ts`**

```bash
rm lib/agents/shared-tools.ts
```

- [ ] **Step 8: Run test + typecheck**

```bash
bun test lib/agents/byggesak/tools.test.ts
bun run lint
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add lib/agents/byggesak/ lib/agents/shared-tools.ts
git commit -m "refactor: rename search_lovdata to find_checkpoints_by_law and inline into byggesak"
```

---

## Task 2: Scaffold `norwegian-registers/` — types, http helper, LRU cache

**Files:**
- Create: `lib/agents/norwegian-registers/types.ts`
- Create: `lib/agents/norwegian-registers/http.ts`
- Create: `lib/agents/norwegian-registers/http.test.ts`
- Create: `lib/agents/norwegian-registers/cache.ts`
- Create: `lib/agents/norwegian-registers/cache.test.ts`

- [ ] **Step 1: Create `types.ts`**

```ts
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
```

- [ ] **Step 2: Write failing tests for `http.ts`**

Create `lib/agents/norwegian-registers/http.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { fetchJson, HttpError } from "./http";

describe("fetchJson", () => {
  it("returns parsed JSON on 200", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ hello: "world" }), { status: 200 })) as typeof fetch;
    const result = await fetchJson<{ hello: string }>("https://x", {
      fetchImpl: fakeFetch,
    });
    expect(result.hello).toBe("world");
  });

  it("throws HttpError on non-2xx", async () => {
    const fakeFetch = (async () =>
      new Response("nope", { status: 500 })) as typeof fetch;
    await expect(
      fetchJson("https://x", { fetchImpl: fakeFetch, retries: 0 }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("retries once on 5xx before giving up", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response("err", { status: 503 });
    }) as typeof fetch;
    await expect(
      fetchJson("https://x", { fetchImpl: fakeFetch, retries: 1 }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test lib/agents/norwegian-registers/http.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `http.ts`**

```ts
// lib/agents/norwegian-registers/http.ts
import type { Fetcher } from "./types";

export class HttpError extends Error {
  constructor(public status: number, public url: string, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: Fetcher;
}

export async function fetchJson<T>(
  url: string,
  { timeoutMs = 5000, retries = 1, fetchImpl = fetch }: FetchOptions = {},
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastError = new HttpError(res.status, url, `${res.status} ${res.statusText}`);
        if (res.status >= 500 && attempt < retries) continue;
        throw lastError;
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) continue;
      throw err;
    }
  }
  throw lastError;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test lib/agents/norwegian-registers/http.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write failing tests for `cache.ts`**

Create `lib/agents/norwegian-registers/cache.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { CoordCache } from "./cache";

describe("CoordCache", () => {
  it("stores and retrieves coords by matrikkel_id", () => {
    const cache = new CoordCache(10);
    cache.set("0301-207-80", { utm33: [1, 2] });
    expect(cache.get("0301-207-80")).toEqual({ utm33: [1, 2] });
  });

  it("returns undefined for unknown keys", () => {
    expect(new CoordCache(10).get("missing")).toBeUndefined();
  });

  it("evicts least-recently-used when over capacity", () => {
    const cache = new CoordCache(2);
    cache.set("a", { utm33: [0, 0] });
    cache.set("b", { utm33: [0, 0] });
    cache.get("a"); // touch a — b becomes LRU
    cache.set("c", { utm33: [0, 0] });
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeDefined();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `bun test lib/agents/norwegian-registers/cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement `cache.ts`**

```ts
// lib/agents/norwegian-registers/cache.ts
export interface CoordEntry {
  utm33: [number, number];  // [east, north] — EPSG:25833
}

export class CoordCache {
  private map = new Map<string, CoordEntry>();
  constructor(private capacity: number) {}

  get(key: string): CoordEntry | undefined {
    const value = this.map.get(key);
    if (!value) return undefined;
    // refresh LRU order
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: CoordEntry): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

// Module-level singleton used by tool handlers.
export const globalCoordCache = new CoordCache(256);
```

- [ ] **Step 9: Run test to verify it passes**

Run: `bun test lib/agents/norwegian-registers/cache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
git add lib/agents/norwegian-registers/
git commit -m "feat: scaffold norwegian-registers module with http + lru cache"
```

---

## Task 3: Implement `resolve_property` (Kartverket)

**Files:**
- Create: `lib/agents/norwegian-registers/resolve.ts`
- Create: `lib/agents/norwegian-registers/resolve.test.ts`
- Create: `lib/agents/norwegian-registers/resolve.fixtures.ts`

- [ ] **Step 1: Create fixtures from verified API shapes**

Create `lib/agents/norwegian-registers/resolve.fixtures.ts`:

```ts
// Captured from GET https://ws.geonorge.no/adresser/v1/sok?sok=Karl+Johans+gate+1&utkoordsys=25833&treffPerSide=5
export const adresserSokResponse = {
  metadata: { totaltAntallTreff: 2, treffPerSide: 5, side: 0, viserFra: 0, viserTil: 1 },
  adresser: [
    {
      adressenavn: "Karl Johans gate",
      adressetekst: "Karl Johans gate 1",
      kommunenummer: "0301",
      kommunenavn: "Oslo",
      postnummer: "0154",
      poststed: "OSLO",
      gardsnummer: 207,
      bruksnummer: 80,
      festenummer: 0,
      objtype: "Vegadresse",
      representasjonspunkt: { epsg: "EPSG:25833", nord: 6643212.8, ost: 597345.2 },
    },
    {
      adressenavn: "Karl Johans gate",
      adressetekst: "Karl Johans gate 1B",
      kommunenummer: "0301",
      kommunenavn: "Oslo",
      postnummer: "0154",
      poststed: "OSLO",
      gardsnummer: 207,
      bruksnummer: 81,
      festenummer: 0,
      objtype: "Vegadresse",
      representasjonspunkt: { epsg: "EPSG:25833", nord: 6643220.0, ost: 597350.0 },
    },
  ],
};

// Captured from GET https://ws.geonorge.no/eiendom/v1/geokoding?kommunenummer=0301&gardsnummer=207&bruksnummer=80&utkoordsys=25833
export const eiendomGeokodingResponse = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [597345.2, 6643212.8] },
      properties: {
        kommunenummer: "0301",
        gardsnummer: 207,
        bruksnummer: 80,
        festenummer: 0,
        seksjonsnummer: 0,
        matrikkelnummertekst: "207/80",
        objekttype: "TeigMedFlerePunkter",
        lokalid: "abc-123",
      },
    },
  ],
};
```

- [ ] **Step 2: Write failing parser + handler tests**

Create `lib/agents/norwegian-registers/resolve.test.ts`:

```ts
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
    }) as typeof fetch;
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
    }) as typeof fetch;
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test lib/agents/norwegian-registers/resolve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `resolve.ts`**

```ts
// lib/agents/norwegian-registers/resolve.ts
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
      seksjonsnummer: { type: "number", description: "Seksjonsnummer (optional)" },
    },
    required: [],
  },
};

interface AdresseHit {
  adressetekst?: string;
  postnummer?: string;
  poststed?: string;
  kommunenummer: string;
  kommunenavn: string;
  gardsnummer: number;
  bruksnummer: number;
  festenummer?: number;
  objtype: "Vegadresse" | "Matrikkeladresse";
  representasjonspunkt: { epsg: string; nord: number; ost: number };
}

interface AdresserResponse {
  metadata: { totaltAntallTreff: number };
  adresser: AdresseHit[];
}

interface GeokodingFeature {
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    kommunenummer: string;
    gardsnummer: number;
    bruksnummer: number;
    festenummer?: number;
    matrikkelnummertekst?: string;
  };
}

interface GeokodingResponse {
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
    coords_utm33: [h.representasjonspunkt.ost, h.representasjonspunkt.nord],
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
    result.candidates = rest.slice(0, 4);
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
    kommune: "",
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
  seksjonsnummer?: number;
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
    const url = `${ADRESSER_URL}?sok=${encodeURIComponent(input.address)}&utkoordsys=25833&treffPerSide=5`;
    const data = await fetchJson<AdresserResponse>(url, { fetchImpl: deps.fetchImpl });
    const result = parseAdresserResponse(data, url);
    cache.set(result.matrikkel_id, { utm33: result.coords_utm33 });
    return result;
  }

  if (input.knr && input.gnr !== undefined && input.bnr !== undefined) {
    const params = new URLSearchParams({
      kommunenummer: input.knr,
      gardsnummer: String(input.gnr),
      bruksnummer: String(input.bnr),
      utkoordsys: "25833",
    });
    const url = `${GEOKODING_URL}?${params.toString()}`;
    const data = await fetchJson<GeokodingResponse>(url, { fetchImpl: deps.fetchImpl });
    const result = parseGeokodingResponse(data, input.knr, input.gnr, input.bnr, url);
    cache.set(result.matrikkel_id, { utm33: result.coords_utm33 });
    return result;
  }

  throw new Error("resolveProperty requires either `address` or `knr`+`gnr`+`bnr`");
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/agents/norwegian-registers/resolve.test.ts`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add lib/agents/norwegian-registers/resolve.ts lib/agents/norwegian-registers/resolve.test.ts lib/agents/norwegian-registers/resolve.fixtures.ts
git commit -m "feat: add resolve_property tool backed by Kartverket adresser + geokoding"
```

---

## Task 4: Implement `nve_check` for `topic=flom`

**Files:**
- Create: `lib/agents/norwegian-registers/nve.ts`
- Create: `lib/agents/norwegian-registers/nve.test.ts`
- Create: `lib/agents/norwegian-registers/nve.fixtures.ts`

- [ ] **Step 1: Create fixtures for NVE flom endpoints**

Create `lib/agents/norwegian-registers/nve.fixtures.ts`:

```ts
// All responses are GeoJSON FeatureCollections returned by ArcGIS MapServer /query with f=geojson.

// Hit on Flomsoner1/MapServer/17 (1000-years return period)
export const flomsonerHit = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: null,
      properties: { gjentaksinterval: 1000, flomsoneID: 42, objektType: "Flomsone" },
    },
  ],
};

export const emptyCollection = {
  type: "FeatureCollection",
  features: [],
};

// Hit on FlomAktsomhet/MapServer/1
export const aktsomhetHit = {
  type: "FeatureCollection",
  features: [{ type: "Feature", geometry: null, properties: { objektType: "Aktsomhet" } }],
};

// Hit on FlomAktsomhet/MapServer/2 — area IS mapped
export const dekningHit = {
  type: "FeatureCollection",
  features: [{ type: "Feature", geometry: null, properties: { status: "kartlagt" } }],
};

// Skred fixtures
export const kvikkleireHit = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: null, properties: { skredType: 141, objektType: "Aktsomhet" } },
  ],
};

export const steinsprangHit = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: null, properties: { skredtype: "steinsprang", subtypeKode: 3 } },
  ],
};

export const snoskredHit = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: null, properties: { skredType: 110, sikkerhetsklasse: "S2" } },
  ],
};
```

- [ ] **Step 2: Write failing flom tests**

Create `lib/agents/norwegian-registers/nve.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { nveCheck, nveCheckToolDefinition } from "./nve";
import { CoordCache } from "./cache";
import {
  flomsonerHit,
  emptyCollection,
  aktsomhetHit,
  dekningHit,
} from "./nve.fixtures";

function primedCache(): CoordCache {
  const c = new CoordCache(10);
  c.set("0301-207-80", { utm33: [597345.2, 6643212.8] });
  return c;
}

function routingFetch(
  routes: Array<{ match: RegExp; body: unknown }>,
): typeof fetch {
  return (async (url: string) => {
    const route = routes.find((r) => r.match.test(url));
    if (!route) return new Response(JSON.stringify(emptyCollection), { status: 200 });
    return new Response(JSON.stringify(route.body), { status: 200 });
  }) as typeof fetch;
}

describe("nve_check topic=flom", () => {
  it("reports flomsone hit with gjentaksintervall and area_mapped=true", async () => {
    const fetchImpl = routingFetch([
      { match: /Flomsoner1\/MapServer\/17\/query/, body: flomsonerHit },
      { match: /FlomAktsomhet\/MapServer\/1\/query/, body: aktsomhetHit },
      { match: /FlomAktsomhet\/MapServer\/2\/query/, body: dekningHit },
    ]);
    const raw = await nveCheck(
      { matrikkel_id: "0301-207-80", topic: "flom" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings.flomsoner).toEqual([
      { gjentaksintervall: 1000, layer: "Flomsoner1/17" },
    ]);
    expect(parsed.findings.in_aktsomhetsomrade_flom).toBe(true);
    expect(parsed.findings.area_mapped).toBe(true);
  });

  it("reports area_mapped=false when Dekning layer has no hit", async () => {
    const fetchImpl = routingFetch([]); // all layers empty
    const raw = await nveCheck(
      { matrikkel_id: "0301-207-80", topic: "flom" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings.flomsoner).toEqual([]);
    expect(parsed.findings.in_aktsomhetsomrade_flom).toBe(false);
    expect(parsed.findings.area_mapped).toBe(false);
  });

  it("returns error shape when matrikkel_id is not in cache", async () => {
    const fetchImpl = routingFetch([]);
    const raw = await nveCheck(
      { matrikkel_id: "9999-1-1", topic: "flom" },
      { fetchImpl, cache: new CoordCache(10) },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings).toBeNull();
    expect(parsed.error).toMatch(/resolve_property first/i);
  });
});

describe("tool definition", () => {
  it("is named nve_check with flom+skred enum", () => {
    expect(nveCheckToolDefinition.name).toBe("nve_check");
    const schema = nveCheckToolDefinition.input_schema as {
      properties: { topic: { enum: string[] } };
    };
    expect(schema.properties.topic.enum).toEqual(["flom", "skred"]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test lib/agents/norwegian-registers/nve.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `nve.ts` (flom branch only for now)**

```ts
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
): Promise<unknown> {
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
      throw new Error("skred not implemented in this task");
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

```

**CRS note:** NVE's ArcGIS services accept EPSG:25833 (UTM33) directly via `inSR`. Since `resolve_property` already returns UTM33 coordinates, we pass them straight through — no reprojection needed, no extra dependency.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test lib/agents/norwegian-registers/nve.test.ts`
Expected: PASS for flom tests. (The `topic=skred` test from Task 5 isn't written yet.)

- [ ] **Step 6: Commit**

```bash
git add lib/agents/norwegian-registers/nve.ts lib/agents/norwegian-registers/nve.test.ts lib/agents/norwegian-registers/nve.fixtures.ts
git commit -m "feat: add nve_check tool with topic=flom (flomsoner + aktsomhet + coverage)"
```

---

## Task 5: Extend `nve_check` with `topic=skred`

**Files:**
- Modify: `lib/agents/norwegian-registers/nve.ts`
- Modify: `lib/agents/norwegian-registers/nve.test.ts`

- [ ] **Step 1: Add failing skred tests**

Append to `lib/agents/norwegian-registers/nve.test.ts`:

```ts
import { kvikkleireHit, steinsprangHit, snoskredHit } from "./nve.fixtures";

describe("nve_check topic=skred", () => {
  it("reports per-hazard aktsomhet status when all three hit", async () => {
    const fetchImpl = routingFetch([
      { match: /KvikkleireskredAktsomhet\/MapServer\/0\/query/, body: kvikkleireHit },
      { match: /SkredSteinAktR\/MapServer\/1\/query/, body: steinsprangHit },
      { match: /SnoskredAktsomhet\/MapServer\/1\/query/, body: snoskredHit },
    ]);
    const raw = await nveCheck(
      { matrikkel_id: "0301-207-80", topic: "skred" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings.kvikkleire).toEqual({
      in_aktsomhetsomrade: true,
      skredtype_kode: 141,
    });
    expect(parsed.findings.steinsprang.in_utlosningsomrade).toBe(true);
    expect(parsed.findings.snoskred.in_aktsomhetsomrade).toBe(true);
  });

  it("reports not-in-zone for all three when no hits", async () => {
    const fetchImpl = routingFetch([]);
    const raw = await nveCheck(
      { matrikkel_id: "0301-207-80", topic: "skred" },
      { fetchImpl, cache: primedCache() },
    );
    const parsed = JSON.parse(raw);
    expect(parsed.findings.kvikkleire.in_aktsomhetsomrade).toBe(false);
    expect(parsed.findings.steinsprang.in_utlosningsomrade).toBe(false);
    expect(parsed.findings.snoskred.in_aktsomhetsomrade).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/agents/norwegian-registers/nve.test.ts`
Expected: FAIL — skred path throws "not implemented".

- [ ] **Step 3: Implement `checkSkred` in `nve.ts`**

Add to `lib/agents/norwegian-registers/nve.ts` (replace the `topic === "skred"` branch and add function):

```ts
async function checkSkred(
  east: number,
  north: number,
  fetchImpl?: Fetcher,
): Promise<unknown> {
  const [kvikkleireRes, steinRes, snoRes] = await Promise.all([
    queryLayer("KvikkleireskredAktsomhet", 0, east, north, fetchImpl),
    queryLayer("SkredSteinAktR", 1, east, north, fetchImpl),
    queryLayer("SnoskredAktsomhet", 1, east, north, fetchImpl),
  ]);

  const kvikkleireHit = kvikkleireRes.features[0];
  const kvikkleireProps = kvikkleireHit?.properties ?? {};
  const kvikkleire = kvikkleireHit
    ? {
        in_aktsomhetsomrade: true,
        skredtype_kode: (kvikkleireProps.skredType as number | undefined) ?? null,
      }
    : { in_aktsomhetsomrade: false };

  const steinHit = steinRes.features[0];
  const steinProps = steinHit?.properties ?? {};
  const steinsprang = steinHit
    ? {
        in_utlosningsomrade: true,
        skredtype: (steinProps.skredtype as string | undefined) ?? null,
      }
    : { in_utlosningsomrade: false };

  const snoHit = snoRes.features[0];
  const snoProps = snoHit?.properties ?? {};
  const snoskred = snoHit
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
```

And replace the `throw new Error("skred not implemented in this task")` line with:

```ts
if (input.topic === "skred") {
  return JSON.stringify(await checkSkred(east, north, deps.fetchImpl));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/agents/norwegian-registers/nve.test.ts`
Expected: PASS (all flom + skred tests).

- [ ] **Step 5: Commit**

```bash
git add lib/agents/norwegian-registers/nve.ts lib/agents/norwegian-registers/nve.test.ts
git commit -m "feat: extend nve_check with topic=skred (kvikkleire, steinsprang, snøskred)"
```

---

## Task 6: Module barrel + display names

**Files:**
- Create: `lib/agents/norwegian-registers/display-names.ts`
- Create: `lib/agents/norwegian-registers/index.ts`
- Create: `lib/agents/norwegian-registers/index.test.ts`

- [ ] **Step 1: Create `display-names.ts`**

```ts
// lib/agents/norwegian-registers/display-names.ts
const displayNames: Record<string, string> = {
  resolve_property: "Slår opp eiendom",
  nve_check: "Sjekker NVE-registre",
};

export function getDisplayName(
  toolName: string,
  input?: Record<string, unknown>,
): string | null {
  const base = displayNames[toolName];
  if (!base) return null;
  if (!input) return base;
  switch (toolName) {
    case "resolve_property":
      if (input.address) return `${base}: ${input.address}`;
      if (input.knr && input.gnr && input.bnr) {
        return `${base}: ${input.knr}-${input.gnr}-${input.bnr}`;
      }
      return base;
    case "nve_check":
      return input.topic ? `${base} (${input.topic})` : base;
    default:
      return base;
  }
}
```

- [ ] **Step 2: Write failing tests for `index.ts`**

Create `lib/agents/norwegian-registers/index.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import {
  toolDefinitions,
  ownsTool,
  handleToolCall,
  getDisplayName,
} from "./index";

describe("norwegian-registers module entry", () => {
  it("exports both tool definitions", () => {
    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain("resolve_property");
    expect(names).toContain("nve_check");
  });

  it("ownsTool identifies registered tools", () => {
    expect(ownsTool("resolve_property")).toBe(true);
    expect(ownsTool("nve_check")).toBe(true);
    expect(ownsTool("get_checkpoints")).toBe(false);
  });

  it("handleToolCall dispatches nve_check with graceful cache-miss", async () => {
    const raw = await handleToolCall("nve_check", {
      matrikkel_id: "nonexistent",
      topic: "flom",
    });
    const parsed = JSON.parse(raw);
    expect(parsed.findings).toBeNull();
  });

  it("handleToolCall throws for unknown tool names", async () => {
    await expect(handleToolCall("not_a_tool", {})).rejects.toThrow(/unknown tool/i);
  });

  it("getDisplayName returns null for unknown tools", () => {
    expect(getDisplayName("not_a_tool")).toBeNull();
    expect(getDisplayName("resolve_property")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test lib/agents/norwegian-registers/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create `index.ts`**

```ts
// lib/agents/norwegian-registers/index.ts
import type { CustomToolDefinition } from "@/lib/agents/types";
import { resolvePropertyToolDefinition, resolveProperty } from "./resolve";
import { nveCheckToolDefinition, nveCheck } from "./nve";

export const toolDefinitions: CustomToolDefinition[] = [
  resolvePropertyToolDefinition,
  nveCheckToolDefinition,
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
      return JSON.stringify(
        await resolveProperty({
          address: input.address as string | undefined,
          knr: input.knr as string | undefined,
          gnr: input.gnr as number | undefined,
          bnr: input.bnr as number | undefined,
          festenummer: input.festenummer as number | undefined,
          seksjonsnummer: input.seksjonsnummer as number | undefined,
        }),
      );
    case "nve_check":
      return nveCheck({
        matrikkel_id: input.matrikkel_id as string,
        topic: input.topic as "flom" | "skred",
      });
    default:
      throw new Error(`Unknown tool in norwegian-registers: ${name}`);
  }
}

export { getDisplayName } from "./display-names";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test lib/agents/norwegian-registers/index.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/agents/norwegian-registers/index.ts lib/agents/norwegian-registers/index.test.ts lib/agents/norwegian-registers/display-names.ts
git commit -m "feat: export norwegian-registers module barrel with dispatch + display names"
```

---

## Task 7: Wire `norwegian-registers` into the byggesak agent

**Files:**
- Modify: `lib/agents/byggesak/agent.ts`

- [ ] **Step 1: Add imports**

In `lib/agents/byggesak/agent.ts`, add near the other imports:

```ts
import * as registers from "@/lib/agents/norwegian-registers";
```

- [ ] **Step 2: Extend the tools list in `createAgentConfig`**

Change the `tools` array to:

```ts
tools: [
  { type: "agent_toolset_20260401" as const },
  ...registers.toolDefinitions,
  ...byggesakToolDefinitions,
],
```

- [ ] **Step 3: Update `handleToolCall` to dispatch to registers first**

Replace the current `handleToolCall` body with:

```ts
async handleToolCall(name: string, input: Record<string, unknown>): Promise<string> {
  if (registers.ownsTool(name)) return registers.handleToolCall(name, input);
  return byggesakHandleToolCall(name, input);
},
```

- [ ] **Step 4: Update `getDisplayName` to fall back to registers**

Replace with:

```ts
getDisplayName(toolName: string, input?: Record<string, unknown>): string | null {
  return registers.getDisplayName(toolName, input) ?? getDisplayName(toolName, input);
},
```

- [ ] **Step 5: Append the new system-prompt section**

In the same file, modify `SYSTEM_PROMPT` to insert a new section **immediately before** the `## Sjekkpunktindeks\n\n` line (keep the trailing blank line plus `{index}` interpolation intact):

```
## Oppslag i offentlige registre

Før du ber saksbehandleren om faktaopplysninger om eiendommen,
sjekk om svaret finnes i registrene:

1. Identifiser eiendommen. Les adresse eller gnr/bnr fra søknaden.
   Hvis uklart, kall resolve_property først.
2. For spørsmål om flom- eller skredfare, kall nve_check med matrikkel_id
   fra resolve_property og topic "flom" eller "skred".
3. Alle funn fra registrene MÅ presenteres med kilde som markdown-lenke:
   "[NVE Atlas](URL)". Ikke oppgi funn uten kilde.
4. Registrene er INDIKASJON, ikke avgjørelse. Avslutt slike funn med
   "– bør bekreftes i kommunens fagsystem".
5. Hvis et oppslag returnerer error eller findings: null, fall tilbake til
   å spørre saksbehandleren (som før).
6. area_mapped: false på flom betyr "ikke kartlagt", ikke "ikke i sone".
   Rapporter dette presist.

```

- [ ] **Step 6: Verify typecheck and existing tests**

```bash
bun test lib/
bun run lint
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/agents/byggesak/agent.ts
git commit -m "feat: wire norwegian-registers tools + prompt section into byggesak agent"
```

---

## Task 8: Live integration tests (env-gated)

**Why last:** Confirms the parsers and URL construction work against real Kartverket + NVE services. Gated so CI without network doesn't flake.

**Files:**
- Create: `lib/agents/norwegian-registers/integration.test.ts`

- [ ] **Step 1: Write the gated integration test**

Create `lib/agents/norwegian-registers/integration.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { resolveProperty } from "./resolve";
import { nveCheck } from "./nve";
import { CoordCache } from "./cache";

const LIVE = process.env.RUN_LIVE_REGISTERS_TESTS === "1";
const d = LIVE ? describe : describe.skip;

d("live: Kartverket + NVE (gated by RUN_LIVE_REGISTERS_TESTS=1)", () => {
  const cache = new CoordCache(10);
  let matrikkelId = "";

  it("resolveProperty resolves a known address", async () => {
    const result = await resolveProperty(
      { address: "Karl Johans gate 1, 0154 Oslo" },
      { cache },
    );
    expect(result.matrikkel_id).toMatch(/^\d{4}-\d+-\d+/);
    expect(result.coords_utm33[0]).toBeGreaterThan(0);
    matrikkelId = result.matrikkel_id;
  }, 15000);

  it("nveCheck topic=flom returns a structured result for the same property", async () => {
    expect(matrikkelId).not.toBe("");
    const raw = await nveCheck({ matrikkel_id: matrikkelId, topic: "flom" }, { cache });
    const parsed = JSON.parse(raw);
    expect(parsed.topic).toBe("flom");
    expect(typeof parsed.findings.area_mapped).toBe("boolean");
  }, 15000);

  it("nveCheck topic=skred returns a structured result", async () => {
    expect(matrikkelId).not.toBe("");
    const raw = await nveCheck({ matrikkel_id: matrikkelId, topic: "skred" }, { cache });
    const parsed = JSON.parse(raw);
    expect(parsed.topic).toBe("skred");
    expect(parsed.findings.kvikkleire).toBeDefined();
    expect(parsed.findings.steinsprang).toBeDefined();
    expect(parsed.findings.snoskred).toBeDefined();
  }, 15000);
});
```

- [ ] **Step 2: Run the gated tests manually**

```bash
RUN_LIVE_REGISTERS_TESTS=1 bun test lib/agents/norwegian-registers/integration.test.ts
```

Expected: all three tests PASS against live APIs. If any fail, the fixtures or URL construction need adjustment.

- [ ] **Step 3: Run the unset-case to confirm skip behaviour**

```bash
bun test lib/agents/norwegian-registers/integration.test.ts
```

Expected: tests report as skipped, not run.

- [ ] **Step 4: Commit**

```bash
git add lib/agents/norwegian-registers/integration.test.ts
git commit -m "test: add env-gated live integration tests for norwegian-registers"
```

---

## Post-plan checks

After all tasks complete:

- [ ] `bun test lib/` — full suite green
- [ ] `bun run lint`
- [ ] `npx tsc --noEmit`
- [ ] Manual smoke: `bun dev`, upload a test byggesøknad, confirm the agent calls `resolve_property` then `nve_check` and surfaces findings with markdown links to NVE Atlas.
- [ ] No lingering references to `search_lovdata` or `shared-tools` in the codebase:

```bash
grep -r "search_lovdata\|shared-tools" --include="*.ts" --include="*.md" .
```

(Spec file references are expected; code references are not.)
