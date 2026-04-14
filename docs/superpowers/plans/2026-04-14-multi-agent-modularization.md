# Multi-Agent Modularization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the hardcoded single-agent architecture into a modular multi-agent catalog, rename the existing byggesak agent to the descriptive slug `kommune-byggesak-saksbehandler`, and ship a stub `tiltakshaver-byggesoknad` applier agent to prove the multi-agent path end-to-end.

**Architecture:** Shared prompt fragments + `composeSystemPrompt` composer + formalized `ToolBundle` interface, all consumed by self-contained agent modules in `lib/agents/<slug>/`. Per-call agent resolution in the session/chat routes, driven by a new `agentType` column on `sessionOwnership`. One Anthropic managed agent per slug, addressed via indexed env vars.

**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM (Postgres via Neon), `@anthropic-ai/sdk` 0.88, Clerk for auth/org metadata, bun (test runner + scripts), shadcn/ui.

---

## File Structure

### New files
- `lib/agents/compose-system-prompt.ts` — the composer function
- `lib/agents/compose-system-prompt.test.ts` — composer tests
- `lib/agents/shared/prompt-fragments/answer-chips.ts`
- `lib/agents/shared/prompt-fragments/findings-table.ts`
- `lib/agents/shared/prompt-fragments/law-citations.ts`
- `lib/agents/registry.test.ts`
- `lib/agents/kommune-byggesak-saksbehandler/persona.ts` (extracted from old agent.ts)
- `lib/agents/kommune-byggesak-saksbehandler/workflow.ts` (extracted from old agent.ts)
- `lib/agents/kommune-byggesak-saksbehandler/tool-bundle.ts` (extracted from tools.ts, ToolBundle wrapper)
- `lib/agents/tiltakshaver-byggesoknad/agent.ts`
- `lib/agents/tiltakshaver-byggesoknad/persona.ts`
- `lib/agents/tiltakshaver-byggesoknad/workflow.ts`
- `app/agent/[slug]/page.tsx` — new-session page, slug-scoped
- `app/agent/[slug]/[sessionId]/page.tsx` — session view, slug-scoped
- `scripts/migrate-org-type-business-to-tiltakshaver.ts` — idempotent Clerk metadata migration
- `drizzle/0002_session_ownership_agent_type.sql` — Drizzle-generated migration for the new column

### Renamed
- `lib/agents/byggesak/` → `lib/agents/kommune-byggesak-saksbehandler/`
  - All files move with the folder. The existing `tools.ts` is refactored and re-exposed as a `ToolBundle` in Task 6; the old default exports stay until Task 6 flips them.

### Modified
- `lib/agents/types.ts` — add `ToolBundle` interface; extend `AgentModule` with optional `ui` field
- `lib/agents/registry.ts` — rename key, add org-to-agent map and helpers
- `lib/agents/norwegian-registers/index.ts` — add `norwegianRegisters` ToolBundle export + `promptFragment`
- `lib/agents/kommune-byggesak-saksbehandler/agent.ts` — switch to composer + bundles; shrink persona/workflow into dedicated files
- `lib/agents/kommune-byggesak-saksbehandler/tools.ts` — will re-export `byggesakToolBundle` from `tool-bundle.ts` for backwards compatibility; or be deleted once callers are migrated
- `lib/agent-manager.ts` — remove module-level `AGENT_TYPE`/`agentModule`, accept `agentType` per call
- `lib/db/schema.ts` — add `agentType` column to `sessionOwnership`
- `lib/db/queries.ts` — `recordSessionOwnership` gets `agentType`; new `getAgentTypeBySessionId`; `listSessionsForOrg` returns `agentType`
- `app/api/session/route.ts` — accept `agentType` in body, validate, pass through
- `app/api/session/[sessionId]/route.ts` — remove `getAgent("byggesak")`; resolve per session
- `app/api/chat/route.ts` — look up `agentType` from ownership, pass to `createSession`/`streamWithToolHandling`
- `app/agent/page.tsx` — convert to server-component redirect (most-recent-agent or picker)
- `app/agent/[sessionId]/page.tsx` — convert to 301 redirect handler
- `app/agent/_components/agent-sidebar.tsx` — group by agentType, active state, empty-state hints
- `app/admin/page.tsx` — dropdown values: `municipality | tiltakshaver`
- `app/admin/actions.ts` — validator accepts `municipality | tiltakshaver`
- `scripts/sync-agent.ts` — loop over the registry

---

## Task 1: Add `ToolBundle` interface and extend `AgentModule`

**Files:**
- Modify: `lib/agents/types.ts`

- [ ] **Step 1: Extend the type definitions**

Open `lib/agents/types.ts`. At the bottom of the file (after the existing `AgentModule` interface), add:

```ts
export interface ToolBundle {
  id: string;
  definitions: CustomToolDefinition[];
  ownsTool(name: string): boolean;
  handleToolCall(name: string, input: Record<string, unknown>): Promise<string>;
  getDisplayName(toolName: string, input?: Record<string, unknown>): string | null;
  /**
   * Optional usage guidance that will be composed into an agent's system prompt
   * when the bundle is registered with the agent. Must own its own `## Heading`
   * — the composer does NOT inject a wrapper header.
   */
  promptFragment?: string;
}
```

Then modify the existing `AgentModule` interface to add an optional `ui` field:

```ts
export interface AgentModule {
  id: string;

  createAgentConfig(): {
    name: string;
    model: string;
    system: string;
    tools: (CustomToolDefinition | { type: "agent_toolset_20260401" })[];
  };

  handleToolCall(name: string, input: Record<string, unknown>): Promise<string>;

  getDisplayName(toolName: string, input?: Record<string, unknown>): string | null;

  /**
   * Optional UI metadata used by the sidebar and session-creation pages.
   * Each string is a user-facing Norwegian label.
   */
  ui?: {
    newSessionLabel: string;   // e.g. "Ny byggesak"
    sessionGroupLabel: string; // e.g. "Byggesaker"
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `bun run build 2>&1 | head -50`
Expected: build progresses past type-check without errors on `types.ts`. Build may still fail elsewhere if concurrent work is in-flight — look only for errors originating in `types.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/agents/types.ts
git commit -m "feat(agents): add ToolBundle interface and AgentModule.ui"
```

---

## Task 2: Write shared prompt fragments

**Files:**
- Create: `lib/agents/shared/prompt-fragments/answer-chips.ts`
- Create: `lib/agents/shared/prompt-fragments/findings-table.ts`
- Create: `lib/agents/shared/prompt-fragments/law-citations.ts`

These extract the reusable house-style sections from the current byggesak system prompt (`lib/agents/byggesak/agent.ts:29–72`). Content is copied verbatim except for the heading line, which is already there. **Do not paraphrase** — byte-for-byte extraction keeps the renamed kommune agent's behavior unchanged.

- [ ] **Step 1: Create `answer-chips.ts`**

```ts
// lib/agents/shared/prompt-fragments/answer-chips.ts

export const answerChipsFragment = `## Spørsmål til saksbehandler

Still alltid ETT spørsmål om gangen. Ikke list opp flere spørsmål i samme melding. Vent på svar før du går videre til neste spørsmål.

Avslutt ALLTID meldingen med svaralternativer i dette formatet:

[svar: Ja]
[svar: Nei]
[svar: Vet ikke]

Dette er påkrevd — svaralternativene vises som klikkbare knapper i brukergrensesnittet. Tilpass alternativene til spørsmålet:
- Ja/Nei-spørsmål: [svar: Ja] [svar: Nei] [svar: Vet ikke]
- Valg mellom alternativer: [svar: Rammetillatelse] [svar: Ettrinnssøknad] [svar: Annet]
- Når du har flere ting å avklare: still det viktigste spørsmålet først, ta resten etterpå`;
```

- [ ] **Step 2: Create `findings-table.ts`**

```ts
// lib/agents/shared/prompt-fragments/findings-table.ts

export const findingsTableFragment = `## Presentasjon av funn

Når du har gjennomgått sjekkpunkter for et tema, presenter funnene i en markdown-tabell. Bruk denne strukturen:

| Sjekkpunkt | Beskrivelse | Funn |
|---|---|---|
| 1.1 | Dokumentasjon på norsk | 🟢 OK |
| 1.79 | Plantegninger | 🟡 Vedlagt, men dårlig skannet |
| 1.80 | Snittegninger | 🔴 Mangler |

Fargekoder:
- 🟢 = Oppfylt / OK
- 🟡 = Delvis oppfylt / trenger avklaring
- 🔴 = Mangler / ikke oppfylt

Bruk ALLTID tabell når du lister opp funn for sjekkpunkter. Ikke bruk nummererte lister eller punktlister for dette. Etter tabellen kan du gi en kort oppsummering og stille spørsmål.`;
```

- [ ] **Step 3: Create `law-citations.ts`**

```ts
// lib/agents/shared/prompt-fragments/law-citations.ts

export const lawCitationsFragment = `## Lovhenvisninger

Når du omtaler lovkrav, oppgi alltid den eksakte lovhjemmelen slik den står i sjekkpunktdataene. Brukergrensesnittet gjenkjenner lovhenvisninger automatisk og viser dem som klikkbare lenker til Lovdata.

Skriv lovhenvisninger på denne måten:
- pbl. § 21-2 (ikke "plan- og bygningsloven paragraf 21-2" eller bare "§ 21-2")
- SAK10 § 5-4 (ikke "byggesaksforskriften § 5-4" eller bare "forskriften")
- TEK17 § 11-2 (ikke "byggteknisk forskrift" uten paragrafnummer)

Eksempel på god bruk:
"Søknaden må inneholde dokumentasjon på norsk, jf. pbl. § 21-2. Ansvarlig søker må oppfylle kravene i SAK10 § 5-4 for den aktuelle tiltaksklassen."

Eksempel på dårlig bruk:
"I henhold til plan- og bygningsloven må søknaden være på norsk. Forskriften stiller krav til ansvarlig søker."

Bruk alltid det korte lovnavnet (pbl, SAK10, TEK17) etterfulgt av § og paragrafnummeret. Inkluder leddhenvisning kun når det er nødvendig for presisjon (f.eks. "pbl. § 21-2 syvende ledd").`;
```

- [ ] **Step 4: Verify the fragments match the existing prompt text**

Cross-check each fragment against the original `lib/agents/byggesak/agent.ts` lines:
- `answerChipsFragment` = lines 25–38
- `findingsTableFragment` = lines 40–55
- `lawCitationsFragment` = lines 57–72

Run: `diff <(echo "$fragment_text") <(sed -n '25,38p' lib/agents/byggesak/agent.ts)` — if you prefer visual confirmation, open both side-by-side. The text should match character-for-character after the heading line.

- [ ] **Step 5: Commit**

```bash
git add lib/agents/shared/prompt-fragments/
git commit -m "feat(agents): extract shared prompt fragments (answer-chips, findings-table, law-citations)"
```

---

## Task 3: Write `composeSystemPrompt` with TDD

**Files:**
- Create: `lib/agents/compose-system-prompt.ts`
- Create: `lib/agents/compose-system-prompt.test.ts`

The composer's contract (from spec): `persona` required; `workflow` optional (wraps in `## Arbeidsflyt`); `conventions[]` and `toolGuidance[]` opt-in, fragments own their headings; `dynamicSections[]` takes `{ heading, body }`.

- [ ] **Step 1: Write failing tests**

Create `lib/agents/compose-system-prompt.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { composeSystemPrompt } from "./compose-system-prompt";

describe("composeSystemPrompt", () => {
  test("persona-only: returns just the persona text", () => {
    const result = composeSystemPrompt({
      persona: "Du er en assistent.",
    });
    expect(result).toBe("Du er en assistent.");
  });

  test("persona + workflow: wraps workflow in ## Arbeidsflyt", () => {
    const result = composeSystemPrompt({
      persona: "Du er en assistent.",
      workflow: "1. Gjør noe.\n2. Gjør noe annet.",
    });
    expect(result).toBe(
      "Du er en assistent.\n\n## Arbeidsflyt\n\n1. Gjør noe.\n2. Gjør noe annet."
    );
  });

  test("empty workflow string skips the workflow section", () => {
    const result = composeSystemPrompt({
      persona: "Du er en assistent.",
      workflow: "",
    });
    expect(result).toBe("Du er en assistent.");
  });

  test("conventions render in order, each with its own heading", () => {
    const result = composeSystemPrompt({
      persona: "P.",
      conventions: [
        "## First\n\nFirst body.",
        "## Second\n\nSecond body.",
      ],
    });
    expect(result).toBe(
      "P.\n\n## First\n\nFirst body.\n\n## Second\n\nSecond body."
    );
  });

  test("toolGuidance renders like conventions — no auto-wrapper", () => {
    const result = composeSystemPrompt({
      persona: "P.",
      toolGuidance: ["## Tool A\n\nUse A.", "## Tool B\n\nUse B."],
    });
    // Critically: no `## Verktøybruk` header wrapping them.
    expect(result).toContain("## Tool A");
    expect(result).toContain("## Tool B");
    expect(result).not.toContain("## Verktøybruk");
  });

  test("dynamicSections take { heading, body } and render as ## heading + body", () => {
    const result = composeSystemPrompt({
      persona: "P.",
      dynamicSections: [
        { heading: "Sjekkpunktindeks", body: "1.1 Ok\n1.2 Also ok" },
      ],
    });
    expect(result).toBe(
      "P.\n\n## Sjekkpunktindeks\n\n1.1 Ok\n1.2 Also ok"
    );
  });

  test("full composition: persona → workflow → conventions → toolGuidance → dynamicSections", () => {
    const result = composeSystemPrompt({
      persona: "P.",
      workflow: "W.",
      conventions: ["## C1\n\nC1b."],
      toolGuidance: ["## T1\n\nT1b."],
      dynamicSections: [{ heading: "D1", body: "D1b." }],
    });
    expect(result).toBe(
      [
        "P.",
        "## Arbeidsflyt\n\nW.",
        "## C1\n\nC1b.",
        "## T1\n\nT1b.",
        "## D1\n\nD1b.",
      ].join("\n\n")
    );
  });

  test("empty arrays skip their slot entirely", () => {
    const result = composeSystemPrompt({
      persona: "P.",
      conventions: [],
      toolGuidance: [],
      dynamicSections: [],
    });
    expect(result).toBe("P.");
  });

  test("undefined promptFragment entries in toolGuidance are ignored gracefully", () => {
    // In practice bundles may have promptFragment = undefined; the agent
    // filters via .filter(Boolean), but we defend against nullish entries here.
    const result = composeSystemPrompt({
      persona: "P.",
      toolGuidance: ["## A\n\nAbody.", undefined, "## B\n\nBbody."].filter(
        (s): s is string => Boolean(s),
      ),
    });
    expect(result).toContain("## A");
    expect(result).toContain("## B");
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `bun test lib/agents/compose-system-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the composer**

Create `lib/agents/compose-system-prompt.ts`:

```ts
export interface DynamicSection {
  heading: string;
  body: string;
}

export interface ComposeSystemPromptParams {
  persona: string;
  workflow?: string;
  conventions?: string[];
  toolGuidance?: string[];
  dynamicSections?: DynamicSection[];
}

/**
 * Assembles an agent's system prompt from shared + per-agent fragments.
 *
 * Fixed section order (non-configurable):
 *   1. persona (no heading, required)
 *   2. ## Arbeidsflyt + workflow (optional; skipped if empty/absent)
 *   3. conventions[] (each fragment owns its own ## heading)
 *   4. toolGuidance[] (each fragment owns its own ## heading; no auto-wrapper)
 *   5. dynamicSections[] (rendered as "## <heading>\n\n<body>")
 *
 * Empty arrays/strings skip their section entirely.
 */
export function composeSystemPrompt(
  params: ComposeSystemPromptParams,
): string {
  const parts: string[] = [params.persona];

  if (params.workflow && params.workflow.length > 0) {
    parts.push(`## Arbeidsflyt\n\n${params.workflow}`);
  }

  for (const fragment of params.conventions ?? []) {
    parts.push(fragment);
  }

  for (const fragment of params.toolGuidance ?? []) {
    parts.push(fragment);
  }

  for (const { heading, body } of params.dynamicSections ?? []) {
    parts.push(`## ${heading}\n\n${body}`);
  }

  return parts.join("\n\n");
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `bun test lib/agents/compose-system-prompt.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/agents/compose-system-prompt.ts lib/agents/compose-system-prompt.test.ts
git commit -m "feat(agents): add composeSystemPrompt with TDD"
```

---

## Task 4: Adopt `ToolBundle` interface for `norwegian-registers`

**Files:**
- Modify: `lib/agents/norwegian-registers/index.ts`

The existing module already exports `toolDefinitions`, `ownsTool`, `handleToolCall`, `getDisplayName`. This task wraps them into a `ToolBundle`-shaped object and adds the `promptFragment` extracted from byggesak's current system prompt (lines 82–106).

- [ ] **Step 1: Add the promptFragment constant and the bundle export**

Open `lib/agents/norwegian-registers/index.ts`. Add the following to the **top** of the file (after the existing imports) or the bottom — just before the final `export { getDisplayName }` line is a good spot. Also add the `norwegianRegisters` bundle wrapper.

Final shape of the file:

```ts
// lib/agents/norwegian-registers/index.ts
import type { CustomToolDefinition, ToolBundle } from "@/lib/agents/types";
import { resolvePropertyToolDefinition, resolveProperty } from "./resolve";
import { nveCheckToolDefinition, nveCheck } from "./nve";
import { riksantikvarenCheckToolDefinition, riksantikvarenCheck } from "./riksantikvaren";
import { getDisplayName } from "./display-names";

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

const promptFragment = `## Oppslag i offentlige registre

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
7. For spørsmål om kulturminner, fredning, SEFRAK eller
   kulturmiljø, kall riksantikvaren_check. Registrer hvert
   funn med sin egen link_askeladden i stedet for én samlet
   kilde — saksbehandler vil klikke seg videre til det
   aktuelle kulturminnet.
8. has_any: false betyr ingen registrerte kulturminner på
   eiendommen. Dette utelukker IKKE uregistrerte funn —
   fysisk inspeksjon kan fortsatt avdekke nye kulturminner.`;

export const norwegianRegisters: ToolBundle = {
  id: "norwegian-registers",
  definitions: toolDefinitions,
  ownsTool,
  handleToolCall,
  getDisplayName,
  promptFragment,
};

export { getDisplayName };
```

Note the text in `promptFragment` is copied verbatim from `lib/agents/byggesak/agent.ts:82–106` (the `## Oppslag i offentlige registre` section). Do not paraphrase.

- [ ] **Step 2: Verify existing register tests still pass**

Run: `bun test lib/agents/norwegian-registers/`
Expected: all existing tests pass (nothing should break — we only added exports).

- [ ] **Step 3: Commit**

```bash
git add lib/agents/norwegian-registers/index.ts
git commit -m "feat(agents): expose norwegian-registers as a ToolBundle with promptFragment"
```

---

## Task 5: Rename `byggesak` → `kommune-byggesak-saksbehandler` (file move, lockstep)

**Files:**
- Rename: `lib/agents/byggesak/` → `lib/agents/kommune-byggesak-saksbehandler/`
- Modify: `lib/agents/registry.ts`
- Modify: `lib/agent-manager.ts`
- Modify: `app/api/session/[sessionId]/route.ts`
- Modify: `scripts/sync-agent.ts`

This is a mechanical rename. Runtime behavior is unchanged at the end of this task. We do **not** introduce `agentType` through the DB yet — that comes in Task 8, where the rename's downstream column-value becomes relevant.

- [ ] **Step 1: Rename the folder**

```bash
git mv lib/agents/byggesak lib/agents/kommune-byggesak-saksbehandler
```

- [ ] **Step 2: Update the export name inside the module's `agent.ts`**

Open `lib/agents/kommune-byggesak-saksbehandler/agent.ts`. Change:

```ts
export const byggesakAgent: AgentModule = {
  id: "byggesak",
  // ...
```

to:

```ts
export const kommuneByggesakSaksbehandlerAgent: AgentModule = {
  id: "kommune-byggesak-saksbehandler",
  // ...
```

Also update the `name:` field inside `createAgentConfig` from `"Byggesak Assistant"` to `"Kommune Byggesak Saksbehandler"`.

- [ ] **Step 3: Update the registry key and import**

Open `lib/agents/registry.ts`. Replace:

```ts
import type { AgentModule } from "./types";
import { byggesakAgent } from "./byggesak/agent";

const agents: Record<string, AgentModule> = {
  byggesak: byggesakAgent,
};
```

with:

```ts
import type { AgentModule } from "./types";
import { kommuneByggesakSaksbehandlerAgent } from "./kommune-byggesak-saksbehandler/agent";

const agents: Record<string, AgentModule> = {
  "kommune-byggesak-saksbehandler": kommuneByggesakSaksbehandlerAgent,
};

export function getAgent(type: string): AgentModule {
  const agent = agents[type];
  if (!agent) throw new Error(`Unknown agent type: ${type}`);
  return agent;
}

export function listAgentTypes(): string[] {
  return Object.keys(agents);
}
```

- [ ] **Step 4: Update `agent-manager.ts` hardcoded slug**

Open `lib/agent-manager.ts`. Change line 17:

```ts
const AGENT_TYPE = "byggesak";
```

to:

```ts
const AGENT_TYPE = "kommune-byggesak-saksbehandler";
```

(This constant is still at module scope — it will be removed in Task 9.)

- [ ] **Step 5: Update `app/api/session/[sessionId]/route.ts` hardcoded slug**

Open `app/api/session/[sessionId]/route.ts`. Change line 9:

```ts
const agentModule = getAgent("byggesak");
```

to:

```ts
const agentModule = getAgent("kommune-byggesak-saksbehandler");
```

(Still module-scoped — removed in Task 10.)

- [ ] **Step 6: Update `scripts/sync-agent.ts` hardcoded slug**

Open `scripts/sync-agent.ts`. Change line 12:

```ts
const AGENT_TYPE = "byggesak";
```

to:

```ts
const AGENT_TYPE = "kommune-byggesak-saksbehandler";
```

- [ ] **Step 7: Check for any remaining references to the old slug**

Run: Grep for `"byggesak"` (the literal string) across the codebase, excluding prose-only mentions in docs:

Use the Grep tool with pattern `"byggesak"` and glob `!docs/**`.
Expected: the only remaining matches should be file paths in `drizzle/` migrations (unrelated) and any doc files. If code matches remain, update them.

- [ ] **Step 8: Run the existing tests to verify the rename**

Run: `bun test lib/agents/kommune-byggesak-saksbehandler/`
Expected: all existing `tools.test.ts` tests pass from the new location.

Run: `bun run build 2>&1 | tail -30`
Expected: clean build.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(agents): rename byggesak to kommune-byggesak-saksbehandler"
```

---

## Task 6: Refactor `kommune-byggesak-saksbehandler` to composer + bundles

**Files:**
- Create: `lib/agents/kommune-byggesak-saksbehandler/persona.ts`
- Create: `lib/agents/kommune-byggesak-saksbehandler/workflow.ts`
- Create: `lib/agents/kommune-byggesak-saksbehandler/tool-bundle.ts`
- Modify: `lib/agents/kommune-byggesak-saksbehandler/agent.ts`
- Modify: `lib/agents/kommune-byggesak-saksbehandler/tools.ts` (optional — can be kept as a thin re-export or deleted)

Behavior goal: the composed system prompt should be **byte-equivalent** to the current inline prompt (modulo whitespace), and tool dispatch must continue to work.

- [ ] **Step 1: Extract persona into its own file**

Create `lib/agents/kommune-byggesak-saksbehandler/persona.ts`. Copy the opener of the current system prompt (lines 7–9 of the existing `agent.ts`):

```ts
export const PERSONA = `Du er en assistent for byggesaksbehandling i norske kommuner. Du hjelper saksbehandlere med å gjennomgå innkomne byggesøknader mot DIBKs nasjonale sjekklister.

Du snakker norsk (bokmål). Du er grundig og systematisk — et oversett sjekkpunkt er verre enn en langsom gjennomgang.`;
```

- [ ] **Step 2: Extract workflow into its own file**

Create `lib/agents/kommune-byggesak-saksbehandler/workflow.ts`. Copy the body of the current `## Arbeidsflyt` section (lines 13–23 of the existing `agent.ts`, without the heading since the composer adds it):

```ts
export const WORKFLOW = `Når saksbehandleren laster opp en søknad:
1. Les PDF-en. Identifiser søknadstypen (RS, ET, IG, FA, ES, MB, NV, TA) og tiltakstypen.
2. Hvis du er usikker på noen av disse, spør saksbehandleren.
3. Kall get_checklist_overview for å bekrefte omfanget.
4. Kall get_checkpoints filtrert på type og tiltakstype for å hente relevante sjekkpunkter.
5. Gå gjennom sjekkpunktene tema for tema, start med Generelt.
6. For hvert sjekkpunkt, sjekk om søknaden oppfyller kravet.
7. Kall get_checkpoint_detail når du trenger undersjekkpunkter, utfall eller lovhjemler.
8. Kall evaluate_rules når sjekkpunkter har betingede avhengigheter.
9. **VIKTIG: Når du ikke kan avgjøre noe fra PDF-en, STOPP og spør saksbehandleren umiddelbart.** Ikke samle opp spørsmål til slutten. Still ett spørsmål om gangen, vent på svar, og fortsett deretter. Ikke lag en fullstendig rapport med spørsmål på slutten.
10. Diskuter funnene i samtalen — hva som er ok, hva som mangler, hva som trenger avklaring.`;
```

- [ ] **Step 3: Create `tool-bundle.ts` wrapping the existing `byggesakToolDefinitions` + `handleToolCall` + display-names into a `ToolBundle`**

Create `lib/agents/kommune-byggesak-saksbehandler/tool-bundle.ts`:

```ts
import type { ToolBundle } from "@/lib/agents/types";
import {
  byggesakToolDefinitions,
  handleToolCall as byggesakHandleToolCall,
} from "./tools";
import { getDisplayName as byggesakGetDisplayName } from "./display-names";

const toolNames = new Set(byggesakToolDefinitions.map((t) => t.name));

const promptFragment = `## Verktøybruk

- Bruk get_checkpoints med filtre for å holde resultatene små. Filtrer alltid på tiltakstype. Legg til tema for å snevre inn ytterligere.
- Bruk get_checkpoint_detail ett sjekkpunkt om gangen, ikke i bulk.
- Bruk search_checkpoints bare når du ikke kjenner sjekkpunkt-ID eller tema.
- Bruk evaluate_rules etter å ha samlet svar for sjekkpunkter med betingede regler.
- Bruk find_checkpoints_by_law for å finne sjekkpunkter som siterer en bestemt lovhjemmel.`;

export const byggesakToolBundle: ToolBundle = {
  id: "byggesak-checklists",
  definitions: byggesakToolDefinitions,
  ownsTool: (name) => toolNames.has(name),
  handleToolCall: byggesakHandleToolCall,
  getDisplayName: byggesakGetDisplayName,
  promptFragment,
};
```

The text of `promptFragment` is copied verbatim from `lib/agents/kommune-byggesak-saksbehandler/agent.ts:74–80` (the current `## Verktøybruk` section).

- [ ] **Step 4: Rewrite `agent.ts` to use the composer and bundles**

Open `lib/agents/kommune-byggesak-saksbehandler/agent.ts` and replace the entire file with:

```ts
import type { AgentModule } from "@/lib/agents/types";
import { composeSystemPrompt } from "@/lib/agents/compose-system-prompt";
import { answerChipsFragment } from "@/lib/agents/shared/prompt-fragments/answer-chips";
import { findingsTableFragment } from "@/lib/agents/shared/prompt-fragments/findings-table";
import { lawCitationsFragment } from "@/lib/agents/shared/prompt-fragments/law-citations";
import { norwegianRegisters } from "@/lib/agents/norwegian-registers";
import { byggesakToolBundle } from "./tool-bundle";
import { generateCompactIndex } from "./data";
import { PERSONA } from "./persona";
import { WORKFLOW } from "./workflow";

const bundles = [byggesakToolBundle, norwegianRegisters];

export const kommuneByggesakSaksbehandlerAgent: AgentModule = {
  id: "kommune-byggesak-saksbehandler",

  createAgentConfig() {
    return {
      name: "Kommune Byggesak Saksbehandler",
      model: "claude-sonnet-4-6",
      system: composeSystemPrompt({
        persona: PERSONA,
        workflow: WORKFLOW,
        conventions: [
          answerChipsFragment,
          findingsTableFragment,
          lawCitationsFragment,
        ],
        toolGuidance: bundles
          .map((b) => b.promptFragment)
          .filter((s): s is string => Boolean(s)),
        dynamicSections: [
          { heading: "Sjekkpunktindeks", body: generateCompactIndex() },
        ],
      }),
      tools: [
        { type: "agent_toolset_20260401" as const },
        ...bundles.flatMap((b) => b.definitions),
      ],
    };
  },

  async handleToolCall(name, input) {
    const bundle = bundles.find((b) => b.ownsTool(name));
    if (!bundle) throw new Error(`No bundle owns tool ${name}`);
    return bundle.handleToolCall(name, input);
  },

  getDisplayName(name, input) {
    for (const b of bundles) {
      const n = b.getDisplayName(name, input);
      if (n) return n;
    }
    return null;
  },

  ui: {
    newSessionLabel: "Ny byggesak",
    sessionGroupLabel: "Byggesaker",
  },
};
```

Note: `bundles` order is `[byggesakToolBundle, norwegianRegisters]` so that byggesak's `## Verktøybruk` section comes before `## Oppslag i offentlige registre`, matching the original prompt's order.

- [ ] **Step 5: Verify the composed prompt is functionally equivalent to the original**

Create a one-shot verification script (you can delete it after). Open a REPL with `bun repl` or write a tiny script at `scripts/verify-kommune-prompt.ts`:

```ts
import { kommuneByggesakSaksbehandlerAgent } from "@/lib/agents/kommune-byggesak-saksbehandler/agent";

const config = kommuneByggesakSaksbehandlerAgent.createAgentConfig();
console.log("--- COMPOSED PROMPT ---");
console.log(config.system);
console.log("--- END ---");
console.log(`Length: ${config.system.length} chars`);
console.log(`Tools: ${config.tools.length}`);
```

Run: `bun run scripts/verify-kommune-prompt.ts` (or read the output via a one-liner).
Expected: the output contains all seven section headings (`## Arbeidsflyt`, `## Spørsmål til saksbehandler`, `## Presentasjon av funn`, `## Lovhenvisninger`, `## Verktøybruk`, `## Oppslag i offentlige registre`, `## Sjekkpunktindeks`) in that order, plus the opening persona and the full checkpoint index at the end.

Delete `scripts/verify-kommune-prompt.ts` after you've confirmed the output.

- [ ] **Step 6: Run existing tool tests from the new module**

Run: `bun test lib/agents/kommune-byggesak-saksbehandler/`
Expected: `tools.test.ts` passes.

- [ ] **Step 7: Run build**

Run: `bun run build 2>&1 | tail -30`
Expected: clean build.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(agents): kommune-byggesak-saksbehandler uses composer + bundles"
```

---

## Task 7: Extend registry with org-to-agent mapping and env var helper

**Files:**
- Modify: `lib/agents/registry.ts`
- Create: `lib/agents/registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/agents/registry.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  agentEnvVarFor,
  allowedAgentsFor,
  getAgent,
  listAgentTypes,
  ORG_TYPE_TO_AGENT_SLUGS,
  type OrgType,
} from "./registry";

describe("registry", () => {
  test("getAgent returns the kommune agent by slug", () => {
    const agent = getAgent("kommune-byggesak-saksbehandler");
    expect(agent.id).toBe("kommune-byggesak-saksbehandler");
  });

  test("getAgent throws on unknown slug", () => {
    expect(() => getAgent("does-not-exist")).toThrow(
      "Unknown agent type: does-not-exist",
    );
  });

  test("listAgentTypes includes all registered slugs", () => {
    const types = listAgentTypes();
    expect(types).toContain("kommune-byggesak-saksbehandler");
  });

  test("allowedAgentsFor('municipality') returns the kommune slug", () => {
    expect(allowedAgentsFor("municipality")).toEqual([
      "kommune-byggesak-saksbehandler",
    ]);
  });

  test("allowedAgentsFor('tiltakshaver') returns the applier slug", () => {
    expect(allowedAgentsFor("tiltakshaver")).toEqual([
      "tiltakshaver-byggesoknad",
    ]);
  });

  test("allowedAgentsFor for unknown type returns empty array", () => {
    expect(allowedAgentsFor("unknown" as OrgType)).toEqual([]);
  });

  test("allowedAgentsFor for null/undefined returns empty array", () => {
    expect(allowedAgentsFor(null as unknown as OrgType)).toEqual([]);
    expect(allowedAgentsFor(undefined as unknown as OrgType)).toEqual([]);
  });

  test("agentEnvVarFor converts slug to UPPER_SNAKE env var", () => {
    expect(agentEnvVarFor("kommune-byggesak-saksbehandler")).toBe(
      "ANTHROPIC_AGENT_ID_KOMMUNE_BYGGESAK_SAKSBEHANDLER",
    );
    expect(agentEnvVarFor("tiltakshaver-byggesoknad")).toBe(
      "ANTHROPIC_AGENT_ID_TILTAKSHAVER_BYGGESOKNAD",
    );
  });

  test("ORG_TYPE_TO_AGENT_SLUGS has entries for both known types", () => {
    expect(ORG_TYPE_TO_AGENT_SLUGS.municipality).toBeDefined();
    expect(ORG_TYPE_TO_AGENT_SLUGS.tiltakshaver).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `bun test lib/agents/registry.test.ts`
Expected: FAIL — `allowedAgentsFor`, `agentEnvVarFor`, `ORG_TYPE_TO_AGENT_SLUGS`, `OrgType` not exported.

Note: the test for `tiltakshaver-byggesoknad` also fails because that slug isn't registered yet. We'll register it in Task 11. To unblock Task 7, comment out the `allowedAgentsFor('tiltakshaver')` test and the `tiltakshaver` bullet in the `agentEnvVarFor` test with a `// TODO: re-enable in Task 11` marker, and restore them in Task 11.

- [ ] **Step 3: Update `registry.ts`**

Replace `lib/agents/registry.ts` with:

```ts
import type { AgentModule } from "./types";
import { kommuneByggesakSaksbehandlerAgent } from "./kommune-byggesak-saksbehandler/agent";

const agents: Record<string, AgentModule> = {
  "kommune-byggesak-saksbehandler": kommuneByggesakSaksbehandlerAgent,
  // "tiltakshaver-byggesoknad": ...   // registered in Task 11
};

export type OrgType = "municipality" | "tiltakshaver";

/**
 * Static mapping from Clerk org type to the set of agent slugs that type
 * unlocks. Each slug listed here must also be present in `agents` above.
 *
 * Adding a new agent: register in `agents`, then add the slug to the
 * appropriate org type's array.
 */
export const ORG_TYPE_TO_AGENT_SLUGS: Record<OrgType, string[]> = {
  municipality: ["kommune-byggesak-saksbehandler"],
  tiltakshaver: ["tiltakshaver-byggesoknad"],
};

export function getAgent(type: string): AgentModule {
  const agent = agents[type];
  if (!agent) throw new Error(`Unknown agent type: ${type}`);
  return agent;
}

export function listAgentTypes(): string[] {
  return Object.keys(agents);
}

/**
 * Returns the list of agent slugs allowed for the given org type.
 * Returns [] for unknown, null, or undefined org types.
 */
export function allowedAgentsFor(orgType: OrgType | null | undefined): string[] {
  if (!orgType) return [];
  return ORG_TYPE_TO_AGENT_SLUGS[orgType] ?? [];
}

/**
 * Translates a slug (e.g. "kommune-byggesak-saksbehandler") to the env var
 * name that holds its Anthropic managed agent ID (e.g.
 * "ANTHROPIC_AGENT_ID_KOMMUNE_BYGGESAK_SAKSBEHANDLER").
 */
export function agentEnvVarFor(slug: string): string {
  return `ANTHROPIC_AGENT_ID_${slug.toUpperCase().replace(/-/g, "_")}`;
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `bun test lib/agents/registry.test.ts`
Expected: all non-commented tests pass. (Re-enable the tiltakshaver tests in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add lib/agents/registry.ts lib/agents/registry.test.ts
git commit -m "feat(agents): add org-to-agent mapping and agentEnvVarFor helper"
```

---

## Task 8: Add `agentType` column to `sessionOwnership`

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/queries.ts`
- Create: `drizzle/0002_session_ownership_agent_type.sql` (auto-generated, then hand-edited)

- [ ] **Step 1: Update the Drizzle schema**

Open `lib/db/schema.ts`. In the `sessionOwnership` definition, add `agentType` after `title`:

```ts
export const sessionOwnership = pgTable(
  "session_ownership",
  {
    anthropicSessionId: text("anthropic_session_id").primaryKey(),
    clerkOrgId: text("clerk_org_id").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    title: text("title"),
    agentType: text("agent_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  },
  // ... indexes unchanged
);
```

- [ ] **Step 2: Generate the migration SQL**

Run: `bun run db:generate`
Expected: a new file appears in `drizzle/` named `0002_*.sql` (the adjective is random; rename if desired).

- [ ] **Step 3: Hand-edit the migration for safe backfill**

Drizzle's default generation will produce `ALTER TABLE ... ADD COLUMN agent_type TEXT NOT NULL;` which **fails** on a non-empty table. Edit the migration file to use a three-step sequence:

Open the generated `drizzle/0002_*.sql` and replace its contents with:

```sql
-- Add the column nullable first
ALTER TABLE "session_ownership" ADD COLUMN "agent_type" text;

-- Backfill all existing rows. Every existing session is a kommune session
-- because we only had one agent before this migration.
UPDATE "session_ownership"
SET "agent_type" = 'kommune-byggesak-saksbehandler'
WHERE "agent_type" IS NULL;

-- Enforce NOT NULL now that every row has a value
ALTER TABLE "session_ownership" ALTER COLUMN "agent_type" SET NOT NULL;
```

- [ ] **Step 4: Apply the migration**

Run: `bun run db:migrate`
Expected: migration applies successfully; Drizzle prints confirmation.

- [ ] **Step 5: Update `recordSessionOwnership` to accept `agentType`**

Open `lib/db/queries.ts`. Modify `recordSessionOwnership`:

```ts
async recordSessionOwnership(params: {
  anthropicSessionId: string;
  clerkOrgId: string;
  clerkUserId: string;
  agentType: string;
  title?: string;
}) {
  await db.insert(sessionOwnership).values({
    anthropicSessionId: params.anthropicSessionId,
    clerkOrgId: params.clerkOrgId,
    clerkUserId: params.clerkUserId,
    agentType: params.agentType,
    title: params.title ?? null,
  });
},
```

- [ ] **Step 6: Update `listSessionsForOrg` to return `agentType`**

In the same file, modify `listSessionsForOrg` to include `agentType` in the selection:

```ts
async listSessionsForOrg(clerkOrgId: string) {
  return db
    .select({
      anthropicSessionId: sessionOwnership.anthropicSessionId,
      title: sessionOwnership.title,
      agentType: sessionOwnership.agentType,
      createdAt: sessionOwnership.createdAt,
    })
    .from(sessionOwnership)
    .where(
      and(
        eq(sessionOwnership.clerkOrgId, clerkOrgId),
        isNull(sessionOwnership.archivedAt),
      ),
    )
    .orderBy(desc(sessionOwnership.createdAt));
},
```

- [ ] **Step 7: Add `getAgentTypeBySessionId` convenience query**

In the same file, add a new query after `getSessionOwnership`:

```ts
async getAgentTypeBySessionId(anthropicSessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ agentType: sessionOwnership.agentType })
    .from(sessionOwnership)
    .where(eq(sessionOwnership.anthropicSessionId, anthropicSessionId))
    .limit(1);
  return row?.agentType ?? null;
},
```

- [ ] **Step 8: Verify the build and types**

Run: `bun run build 2>&1 | tail -30`
Expected: build fails inside `lib/agent-manager.ts` because `recordSessionOwnership` now requires `agentType`. That's correct — we fix it in Task 9.

- [ ] **Step 9: Commit**

```bash
git add lib/db/schema.ts lib/db/queries.ts drizzle/0002_*.sql
git commit -m "feat(db): add agentType column to session_ownership"
```

---

## Task 9: Per-call agent resolution in `agent-manager.ts`

**Files:**
- Modify: `lib/agent-manager.ts`

- [ ] **Step 1: Remove the module-level `AGENT_TYPE` / `agentModule` constants**

Open `lib/agent-manager.ts`. Delete lines 17–19:

```ts
const AGENT_TYPE = "kommune-byggesak-saksbehandler";

const agentModule = getAgent(AGENT_TYPE);
```

The `getAgent` import stays — we'll use it per call.

Also add the `agentEnvVarFor` import:

```ts
import { getAgent, agentEnvVarFor } from "@/lib/agents/registry";
```

- [ ] **Step 2: Update `createSession` to take `agentType` and use `agentEnvVarFor`**

Replace the existing `createSession` function:

```ts
export async function createSession(params: {
  agentType: string;
  clerkOrgId: string;
  clerkUserId: string;
  title?: string;
}): Promise<string> {
  const session = await client.beta.sessions.create({
    agent: requireEnv(agentEnvVarFor(params.agentType)),
    environment_id: requireEnv("ANTHROPIC_ENVIRONMENT_ID"),
    metadata: {
      clerkOrgId: params.clerkOrgId,
      clerkUserId: params.clerkUserId,
    },
    ...(params.title ? { title: params.title } : {}),
  });

  await ownershipQueries.recordSessionOwnership({
    anthropicSessionId: session.id,
    clerkOrgId: params.clerkOrgId,
    clerkUserId: params.clerkUserId,
    agentType: params.agentType,
    title: params.title,
  });

  return session.id;
}
```

- [ ] **Step 3: Update `streamWithToolHandling` to take `agentType` and resolve per call**

Change the function signature:

```ts
export async function* streamWithToolHandling(
  sessionId: string,
  agentType: string,
  text: string,
  attachments: AttachmentForChat[] = [],
): AsyncGenerator<StreamEvent> {
  const agentModule = getAgent(agentType);
  // ... rest of function uses `agentModule` as before
}
```

Also update `resolvePendingToolCalls` — it references `agentModule` at module scope. Pass it in as a parameter:

```ts
async function* resolvePendingToolCalls(
  sessionId: string,
  agentModule: ReturnType<typeof getAgent>,
): AsyncGenerator<StreamEvent> {
  // ... body unchanged, but the `agentModule.*` calls now use the parameter
}
```

And the single call site inside `streamWithToolHandling` changes from `yield* resolvePendingToolCalls(sessionId);` to:

```ts
yield* resolvePendingToolCalls(sessionId, agentModule);
```

- [ ] **Step 4: Build and check errors**

Run: `bun run build 2>&1 | tail -30`
Expected: new errors in `app/api/chat/route.ts` and `app/api/session/route.ts` because callers haven't been updated yet. Those are fixed in Task 12.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-manager.ts
git commit -m "refactor(agent-manager): resolve agent per call instead of at module load"
```

---

## Task 10: Resolve agent per session in `/api/session/[sessionId]/route.ts`

**Files:**
- Modify: `app/api/session/[sessionId]/route.ts`

- [ ] **Step 1: Remove the module-level `agentModule` constant**

Open `app/api/session/[sessionId]/route.ts`. Delete line 9:

```ts
const agentModule = getAgent("kommune-byggesak-saksbehandler");
```

- [ ] **Step 2: Resolve the agent per request from the ownership row**

In the `GET` handler, after the existing `ownership` lookup (around line 44), add the agent resolution:

```ts
const ownership = await queries.getSessionOwnership(sessionId);
if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

const agentModule = getAgent(ownership.agentType);
```

The rest of the handler continues using `agentModule` unchanged (it's referenced around line 162 when rehydrating tool display names).

- [ ] **Step 3: Build and verify**

Run: `bun run build 2>&1 | tail -30`
Expected: the file builds. Other errors may persist in `/api/chat` — fixed in Task 12.

- [ ] **Step 4: Commit**

```bash
git add app/api/session/[sessionId]/route.ts
git commit -m "refactor(api): resolve agent from sessionOwnership.agentType"
```

---

## Task 11: Build the stub `tiltakshaver-byggesoknad` module

**Files:**
- Create: `lib/agents/tiltakshaver-byggesoknad/persona.ts`
- Create: `lib/agents/tiltakshaver-byggesoknad/workflow.ts`
- Create: `lib/agents/tiltakshaver-byggesoknad/agent.ts`
- Modify: `lib/agents/registry.ts` (register the slug)
- Modify: `lib/agents/registry.test.ts` (re-enable the tiltakshaver assertions commented out in Task 7)

- [ ] **Step 1: Write the stub persona**

Create `lib/agents/tiltakshaver-byggesoknad/persona.ts`:

```ts
export const PERSONA = `Du er en assistent som hjelper tiltakshavere med å forberede byggesøknader til norske kommuner. [STUB — Denne agenten er en plassholder som brukes til å verifisere multi-agent-infrastrukturen. Full applier-design kommer i en senere spec.]

Du snakker norsk (bokmål). Du er konsis og praktisk.`;
```

- [ ] **Step 2: Write the stub workflow**

Create `lib/agents/tiltakshaver-byggesoknad/workflow.ts`:

```ts
export const WORKFLOW = `Når tiltakshaveren stiller et spørsmål:
1. Forsøk å identifisere hvilken eiendom spørsmålet gjelder. Bruk resolve_property hvis adresse eller gnr/bnr er nevnt.
2. Hvis spørsmålet gjelder flom, skred eller kulturminner på eiendommen, bruk de relevante registeroppslagene (nve_check, riksantikvaren_check).
3. Svar kort og henvis alltid til kilde når registerdata brukes. Hvis du ikke har data, si tydelig at dette er en stub-agent uten byggesak-spesifikke verktøy enda.`;
```

- [ ] **Step 3: Write the agent module**

Create `lib/agents/tiltakshaver-byggesoknad/agent.ts`:

```ts
import type { AgentModule } from "@/lib/agents/types";
import { composeSystemPrompt } from "@/lib/agents/compose-system-prompt";
import { answerChipsFragment } from "@/lib/agents/shared/prompt-fragments/answer-chips";
import { norwegianRegisters } from "@/lib/agents/norwegian-registers";
import { PERSONA } from "./persona";
import { WORKFLOW } from "./workflow";

const bundles = [norwegianRegisters];

export const tiltakshaverByggesoknadAgent: AgentModule = {
  id: "tiltakshaver-byggesoknad",

  createAgentConfig() {
    return {
      name: "Tiltakshaver Byggesøknad (Stub)",
      model: "claude-haiku-4-5-20251001",
      system: composeSystemPrompt({
        persona: PERSONA,
        workflow: WORKFLOW,
        conventions: [answerChipsFragment],
        toolGuidance: bundles
          .map((b) => b.promptFragment)
          .filter((s): s is string => Boolean(s)),
      }),
      tools: [
        { type: "agent_toolset_20260401" as const },
        ...bundles.flatMap((b) => b.definitions),
      ],
    };
  },

  async handleToolCall(name, input) {
    const bundle = bundles.find((b) => b.ownsTool(name));
    if (!bundle) throw new Error(`No bundle owns tool ${name}`);
    return bundle.handleToolCall(name, input);
  },

  getDisplayName(name, input) {
    for (const b of bundles) {
      const n = b.getDisplayName(name, input);
      if (n) return n;
    }
    return null;
  },

  ui: {
    newSessionLabel: "Ny søknad",
    sessionGroupLabel: "Mine søknader",
  },
};
```

Using Haiku is deliberate — a stub agent doesn't need Sonnet-level reasoning, and calling a cheaper model during infra testing saves cost.

- [ ] **Step 4: Register the stub in the registry**

Open `lib/agents/registry.ts`. Update the imports and the `agents` map:

```ts
import type { AgentModule } from "./types";
import { kommuneByggesakSaksbehandlerAgent } from "./kommune-byggesak-saksbehandler/agent";
import { tiltakshaverByggesoknadAgent } from "./tiltakshaver-byggesoknad/agent";

const agents: Record<string, AgentModule> = {
  "kommune-byggesak-saksbehandler": kommuneByggesakSaksbehandlerAgent,
  "tiltakshaver-byggesoknad": tiltakshaverByggesoknadAgent,
};

// ... rest unchanged
```

- [ ] **Step 5: Re-enable tiltakshaver tests in `registry.test.ts`**

Uncomment the two test assertions that were commented out in Task 7 Step 2. Run:

Run: `bun test lib/agents/registry.test.ts`
Expected: all tests pass, including the tiltakshaver ones.

- [ ] **Step 6: Register the Anthropic-side agent via `sync-agent`**

This step depends on the `sync-agent` script being updated (Task 13), but we can verify the agent module is loadable:

Run: `bun -e "import('@/lib/agents/registry').then(m => console.log(m.listAgentTypes()))"` (or `bun -e` equivalent)
Expected: output includes both slugs.

Actual Anthropic registration happens in Task 13.

- [ ] **Step 7: Commit**

```bash
git add lib/agents/tiltakshaver-byggesoknad/ lib/agents/registry.ts lib/agents/registry.test.ts
git commit -m "feat(agents): add stub tiltakshaver-byggesoknad module"
```

---

## Task 12: Wire `agentType` through `/api/session` and `/api/chat`

**Files:**
- Modify: `app/api/session/route.ts`
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Update `/api/session` POST to accept and validate `agentType`**

Replace `app/api/session/route.ts` with:

```ts
import { createSession } from "@/lib/agent-manager";
import { requireActive, type CurrentContext } from "@/lib/auth";
import { makeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { clerkClient } from "@clerk/nextjs/server";
import { allowedAgentsFor, type OrgType } from "@/lib/agents/registry";

const audit = makeAudit(db);

export async function POST(request: Request) {
  let ctx: CurrentContext;
  try {
    ctx = await requireActive();
  } catch (err) {
    const status = err instanceof Error && err.name === "NotActiveError" ? 403 : 401;
    return Response.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status },
    );
  }

  let body: { agentType?: string; title?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const agentType = body.agentType;
  if (typeof agentType !== "string" || agentType.length === 0) {
    return Response.json({ error: "agentType required" }, { status: 400 });
  }

  // Look up org type from Clerk and check the requested agent is allowed
  const client = await clerkClient();
  const org = await client.organizations.getOrganization({
    organizationId: ctx.orgId,
  });
  const orgType = org.publicMetadata?.orgType as OrgType | undefined;
  const allowed = allowedAgentsFor(orgType);
  if (!allowed.includes(agentType)) {
    return Response.json(
      { error: `Agent ${agentType} not allowed for this org` },
      { status: 400 },
    );
  }

  const sessionId = await createSession({
    agentType,
    clerkOrgId: ctx.orgId,
    clerkUserId: ctx.userId,
    title: body.title,
  });

  await audit.logEvent({
    actorUserId: ctx.userId,
    actorOrgId: ctx.orgId,
    event: "session.created",
    subjectType: "session",
    subjectId: sessionId,
  });

  return Response.json({ sessionId });
}
```

- [ ] **Step 2: Update `/api/chat` to resolve `agentType` from ownership**

Open `app/api/chat/route.ts`. The file has a `createSession` call and multiple `streamWithToolHandling` calls. Update them to include `agentType`.

First, around lines 50–56 where the no-sessionId path creates a new session:

```ts
if (!sessionId) {
  // agentType must be supplied by the client when creating a session via /api/chat
  const agentType = parsedBody.agentType;
  if (typeof agentType !== "string" || agentType.length === 0) {
    return new Response(
      JSON.stringify({ error: "agentType required for new session" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Validate against org type, same as /api/session POST
  const clerk = await clerkClient();
  const org = await clerk.organizations.getOrganization({
    organizationId: ctx.orgId,
  });
  const orgType = org.publicMetadata?.orgType as OrgType | undefined;
  if (!allowedAgentsFor(orgType).includes(agentType)) {
    return new Response(
      JSON.stringify({ error: `Agent ${agentType} not allowed for this org` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  sessionId = await createSession({
    agentType,
    clerkOrgId: ctx.orgId,
    clerkUserId: ctx.userId,
  });
  eventForAudit = "session.created";
  needsTitle = true;
}
```

Add the imports at the top of the file:

```ts
import { clerkClient } from "@clerk/nextjs/server";
import { allowedAgentsFor, type OrgType } from "@/lib/agents/registry";
```

And extend the `parsedBody` type:

```ts
let parsedBody: {
  message: string;
  sessionId?: string;
  attachmentIds?: string[];
  agentType?: string;
};
```

Next, the existing-session path (around lines 57–66) already loads ownership. Just extract `agentType` from it:

```ts
} else {
  const ownership = await queries.getSessionOwnership(sessionId);
  if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  needsTitle = !ownership.title || ownership.title.trim().length === 0;
}
```

Then, before the stream runs, we need the `agentType` for `streamWithToolHandling`. Consolidate so `agentType` is always set:

After the `if (!sessionId)` / `else` block, add:

```ts
// We now always have a sessionId. Resolve the agentType for the stream.
const agentType = await queries.getAgentTypeBySessionId(sessionId!);
if (!agentType) {
  return new Response(
    JSON.stringify({ error: "Session ownership missing agentType" }),
    { status: 500, headers: { "Content-Type": "application/json" } },
  );
}
```

Then update the two `streamWithToolHandling` call sites (around lines 94 and 109):

```ts
yield* streamWithToolHandling(sessionId!, agentType, message, resolved);
// ...
yield* streamWithToolHandling(sessionId!, agentType, message, reResolved);
```

- [ ] **Step 3: Build and verify**

Run: `bun run build 2>&1 | tail -30`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add app/api/session/route.ts app/api/chat/route.ts
git commit -m "feat(api): wire agentType through session creation and chat routes"
```

---

## Task 13: Update `sync-agent` script to register both agents

**Files:**
- Modify: `scripts/sync-agent.ts`

- [ ] **Step 1: Replace `sync-agent.ts` with a registry-driven loop**

Replace the contents of `scripts/sync-agent.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { getAgent, listAgentTypes, agentEnvVarFor } from "@/lib/agents/registry";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}

const client = new Anthropic();

async function syncAgent(slug: string): Promise<{ envVar: string; id: string }> {
  const envVar = agentEnvVarFor(slug);
  const config = getAgent(slug).createAgentConfig();
  const tools = config.tools as Parameters<
    typeof client.beta.agents.create
  >[0]["tools"];
  const existingId = process.env[envVar];

  if (!existingId) {
    const agent = await client.beta.agents.create({
      name: config.name,
      model: config.model,
      system: config.system,
      tools,
    });
    console.log(`✓ Created agent ${slug}: ${agent.id} (v${agent.version})`);
    return { envVar, id: agent.id };
  }

  const current = await client.beta.agents.retrieve(existingId);
  const updated = await client.beta.agents.update(existingId, {
    version: current.version,
    name: config.name,
    model: config.model,
    system: config.system,
    tools,
  });
  console.log(
    `✓ Updated agent ${slug}: ${updated.id} (v${current.version} → v${updated.version})`,
  );
  return { envVar, id: updated.id };
}

async function syncEnvironment(): Promise<string> {
  const existingId = process.env.ANTHROPIC_ENVIRONMENT_ID;
  if (existingId) {
    await client.beta.environments.retrieve(existingId);
    console.log(`✓ Environment ${existingId} exists`);
    return existingId;
  }
  const environment = await client.beta.environments.create({
    name: "boetta-shared-env",
    config: { type: "cloud", networking: { type: "unrestricted" } },
  });
  console.log(`✓ Created environment ${environment.id}`);
  console.log(`  Add to .env.local: ANTHROPIC_ENVIRONMENT_ID=${environment.id}`);
  return environment.id;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  await syncEnvironment();

  const results: Array<{ envVar: string; id: string }> = [];
  for (const slug of listAgentTypes()) {
    results.push(await syncAgent(slug));
  }

  console.log("\n# Copy into .env.local\n");
  for (const { envVar, id } of results) {
    console.log(`${envVar}=${id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Update `.env.local` — rename the existing env var**

Manually rename `ANTHROPIC_AGENT_ID=...` in `.env.local` to `ANTHROPIC_AGENT_ID_KOMMUNE_BYGGESAK_SAKSBEHANDLER=...`. Do not commit `.env.local`.

- [ ] **Step 3: Run `sync-agent` to register the second agent**

Run: `bun run sync-agent`
Expected: two lines printed. The first line (kommune) should be an UPDATE (existing ID). The second (tiltakshaver) should be a CREATE with a new ID. Copy the new line for `ANTHROPIC_AGENT_ID_TILTAKSHAVER_BYGGESOKNAD` into `.env.local`.

- [ ] **Step 4: Verify tool isolation by inspecting the registered tiltakshaver agent**

Run (replace `ag_...` with the new ID from Step 3):

```bash
bun -e "
import Anthropic from '@anthropic-ai/sdk';
const c = new Anthropic();
const a = await c.beta.agents.retrieve('ag_REPLACE_ME');
const toolNames = a.tools.map(t => t.type === 'custom' ? t.name : t.type);
console.log('tiltakshaver tools:', toolNames);
"
```

Expected: the list contains `agent_toolset_20260401`, `resolve_property`, `nve_check`, `riksantikvaren_check`. It **must NOT contain** `get_checkpoints`, `get_checkpoint_detail`, `search_checkpoints`, `evaluate_rules`, `get_checklist_overview`, `find_checkpoints_by_law` — those are kommune-only.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-agent.ts
git commit -m "feat(sync-agent): iterate registry; register one Anthropic agent per slug"
```

---

## Task 14: Admin UI — rename `business` → `tiltakshaver`

**Files:**
- Modify: `app/admin/page.tsx`
- Modify: `app/admin/actions.ts`
- Create: `scripts/migrate-org-type-business-to-tiltakshaver.ts`

- [ ] **Step 1: Update the admin dropdown**

Open `app/admin/page.tsx`. Around lines 92–105, the dropdown currently has options `municipality | business`. Update:

```tsx
<Select
  name="orgType"
  defaultValue={
    o.orgType === "municipality" || o.orgType === "tiltakshaver"
      ? o.orgType
      : "tiltakshaver"
  }
>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="municipality">Kommune</SelectItem>
    <SelectItem value="tiltakshaver">Tiltakshaver</SelectItem>
  </SelectContent>
</Select>
```

- [ ] **Step 2: Update the validator in `actions.ts`**

Open `app/admin/actions.ts`. Change line 20 from:

```ts
if (orgType !== "municipality" && orgType !== "business") {
```

to:

```ts
if (orgType !== "municipality" && orgType !== "tiltakshaver") {
```

- [ ] **Step 3: Create the Clerk migration script**

The project uses `@clerk/nextjs/server`'s `clerkClient()` everywhere (see `lib/auth.ts:1`, `app/admin/actions.ts:3`). It works in plain Node scripts provided `CLERK_SECRET_KEY` is set in the env.

Create `scripts/migrate-org-type-business-to-tiltakshaver.ts`:

```ts
import { clerkClient } from "@clerk/nextjs/server";
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY not set");
  }

  const client = await clerkClient();

  let updated = 0;
  let scanned = 0;
  let offset = 0;
  const limit = 100;

  while (true) {
    const { data: orgs } = await client.organizations.getOrganizationList({
      limit,
      offset,
    });
    if (orgs.length === 0) break;

    for (const org of orgs) {
      scanned++;
      const orgType = (org.publicMetadata as Record<string, unknown>)?.orgType;
      if (orgType === "business") {
        await client.organizations.updateOrganization(org.id, {
          publicMetadata: {
            ...(org.publicMetadata ?? {}),
            orgType: "tiltakshaver",
          },
        });
        console.log(`  migrated: ${org.id} (${org.name})`);
        updated++;
      }
    }
    offset += orgs.length;
  }

  console.log(`\nScanned ${scanned} orgs; migrated ${updated} business → tiltakshaver.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the migration (no-op expected)**

Run: `bun run scripts/migrate-org-type-business-to-tiltakshaver.ts`
Expected: `Scanned N orgs; migrated 0 business → tiltakshaver.` (zero because there are no `business`-type orgs as confirmed during spec review).

- [ ] **Step 5: Commit**

```bash
git add app/admin/page.tsx app/admin/actions.ts scripts/migrate-org-type-business-to-tiltakshaver.ts
git commit -m "feat(admin): rename orgType business -> tiltakshaver"
```

---

## Task 15: Create slug-scoped routes `/agent/[slug]` and `/agent/[slug]/[sessionId]`

**Files:**
- Create: `app/agent/[slug]/page.tsx`
- Create: `app/agent/[slug]/[sessionId]/page.tsx`

These two routes replace `app/agent/page.tsx` (new-session) and `app/agent/[sessionId]/page.tsx` (session view) for the slug-scoped path. The existing `app/agent/page.tsx` becomes a landing/redirect page (Task 16), and `app/agent/[sessionId]/page.tsx` becomes a 301 handler (Task 17).

- [ ] **Step 1: Teach `ChatPage` to accept and forward `agentType`**

The current `app/agent/page.tsx` is a trivial wrapper: `<ChatPage />` (from `@/components/chat-page`). The same `ChatPage` also hosts session view (via `app/agent/[sessionId]/page.tsx`, which passes `initialSessionId` and `initialMessages`). To slug-scope both paths cleanly, `ChatPage` needs an optional `agentType` prop that it forwards into the `/api/chat` POST body when creating a new session.

Open `components/chat-page.tsx`. The current `ChatPageProps` is around line 276 as `{ initialSessionId, initialMessages }`. Extend it:

```ts
interface ChatPageProps {
  initialSessionId?: string;
  initialMessages?: ChatMessage[];
  agentType?: string;  // new — forwarded to /api/chat when sessionId is absent
}
```

Find the `fetch("/api/chat", ...)` call site inside `ChatPage` (or the `useAgentChat` hook it consumes — grep for `/api/chat` under `components/` and `hooks/`). Include `agentType` in the JSON body when creating a new session:

```ts
body: JSON.stringify({
  message,
  sessionId: currentSessionId,  // may be undefined
  attachmentIds,
  ...(agentType && !currentSessionId ? { agentType } : {}),
}),
```

This matches the server-side expectation set in Task 12.

- [ ] **Step 2: Create `app/agent/[slug]/page.tsx`**

```tsx
import { clerkClient } from "@clerk/nextjs/server";
import { forbidden } from "next/navigation";
import { requireActive } from "@/lib/auth";
import { allowedAgentsFor, type OrgType } from "@/lib/agents/registry";
import ChatPage from "@/components/chat-page";

export default async function NewSessionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await requireActive();

  const client = await clerkClient();
  const org = await client.organizations.getOrganization({
    organizationId: ctx.orgId,
  });
  const orgType = org.publicMetadata?.orgType as OrgType | undefined;

  if (!allowedAgentsFor(orgType).includes(slug)) {
    forbidden();
  }

  return <ChatPage agentType={slug} />;
}
```

- [ ] **Step 3: Create `app/agent/[slug]/[sessionId]/page.tsx`**

The current `app/agent/[sessionId]/page.tsx` is a client component that fetches session messages via `/api/session/[sessionId]` and passes them to `ChatPage`. Copy that logic verbatim into the slug-scoped route, wrapping it with a server-side validation step that verifies the slug matches `sessionOwnership.agentType` and redirects on mismatch.

To keep the page a client component (since it uses `useEffect` + `fetch`), split into a server wrapper and a client inner:

```tsx
// app/agent/[slug]/[sessionId]/page.tsx
import { redirect } from "next/navigation";
import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import SessionClient from "./session-client";

const queries = makeQueries(db);

export default async function SlugScopedSessionPage({
  params,
}: {
  params: Promise<{ slug: string; sessionId: string }>;
}) {
  const { slug, sessionId } = await params;
  const ctx = await requireActive();

  const ownership = await queries.getSessionOwnership(sessionId);
  if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
    redirect("/agent");
  }

  if (ownership.agentType !== slug) {
    redirect(`/agent/${ownership.agentType}/${sessionId}`);
  }

  return <SessionClient sessionId={sessionId} agentType={slug} />;
}
```

Create `app/agent/[slug]/[sessionId]/session-client.tsx` by copying the body of today's `app/agent/[sessionId]/page.tsx` (the `"use client"` component with `useEffect` + `fetch('/api/session/...')`), changing the component name, and adding an `agentType` prop that it forwards to `ChatPage`:

```tsx
"use client";

import { useEffect, useState } from "react";
import ChatPage from "@/components/chat-page";
import type { ChatMessage } from "@/hooks/use-agent-chat";
import { Shimmer } from "@/components/ai-elements/shimmer";

export default function SessionClient({
  sessionId,
  agentType,
}: {
  sessionId: string;
  agentType: string;
}) {
  const [initialMessages, setInitialMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch(`/api/session/${sessionId}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "Failed to load session");
          return;
        }
        const data = await res.json();
        setInitialMessages(data.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load session");
      }
    }
    loadSession();
  }, [sessionId]);

  if (error) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="space-y-2 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <a href="/agent" className="text-sm underline">Start en ny samtale</a>
        </div>
      </div>
    );
  }

  if (initialMessages === null) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Shimmer as="p" className="text-sm">Laster samtale...</Shimmer>
      </div>
    );
  }

  return (
    <ChatPage
      initialSessionId={sessionId}
      initialMessages={initialMessages}
      agentType={agentType}
    />
  );
}
```

- [ ] **Step 4: Dev smoke test**

Run: `bun run dev` (in another terminal)

Visit `http://localhost:3000/agent/kommune-byggesak-saksbehandler` while signed in as a municipality org. Expected: new-session UI loads. Submitting creates a session whose URL becomes `/agent/kommune-byggesak-saksbehandler/<sessionId>` (this transition might still go via the legacy path until Task 17 — verify the sidebar link target uses the new URL shape once Task 18 lands).

- [ ] **Step 5: Commit**

```bash
git add app/agent/[slug]/
git commit -m "feat(agent): slug-scoped new-session and session-view routes"
```

---

## Task 16: Convert `/agent` into a landing redirect

**Files:**
- Modify: `app/agent/page.tsx`

- [ ] **Step 1: Replace `app/agent/page.tsx` with a server-side redirect**

Replace the contents with the spec's landing logic: read `orgType`, compute `allowedAgents`, inspect the user's most recent session, and redirect to the appropriate slug-scoped page, or render a picker if the user has multiple agents but no history.

```tsx
import { clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { allowedAgentsFor, getAgent, type OrgType } from "@/lib/agents/registry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

const queries = makeQueries(db);

export default async function AgentLanding() {
  const ctx = await requireActive();

  const client = await clerkClient();
  const org = await client.organizations.getOrganization({
    organizationId: ctx.orgId,
  });
  const orgType = org.publicMetadata?.orgType as OrgType | undefined;
  const allowed = allowedAgentsFor(orgType);

  if (allowed.length === 0) {
    // No entitlement path — preserve existing behavior.
    // If the existing landing had specific handling (e.g., show a message),
    // preserve that here. Otherwise 403.
    redirect("/"); // Adjust to match existing pattern.
  }

  if (allowed.length === 1) {
    redirect(`/agent/${allowed[0]}`);
  }

  // Multiple agents: prefer the user's most recent session's agent.
  const recent = await queries.listSessionsForOrg(ctx.orgId);
  const recentAgent = recent[0]?.agentType;
  if (recentAgent && allowed.includes(recentAgent)) {
    redirect(`/agent/${recentAgent}`);
  }

  // Multiple agents, no history — render picker.
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold mb-6">Velg agent</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {allowed.map((slug) => {
          const agent = getAgent(slug);
          const label = agent.ui?.newSessionLabel ?? slug;
          return (
            <Link key={slug} href={`/agent/${slug}`}>
              <Card className="hover:border-foreground transition-colors">
                <CardHeader>
                  <CardTitle>{label}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {agent.ui?.sessionGroupLabel ?? ""}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

Adjust the "no entitlement" branch to match the project's existing behavior — check what `app/agent/page.tsx` used to do in that case (maybe it relied on `requireActive()` throwing, which is then handled by an error boundary).

- [ ] **Step 2: Dev smoke test**

Run: `bun run dev`. Visit `/agent` as a municipality user. Expected: redirect to `/agent/kommune-byggesak-saksbehandler`.

- [ ] **Step 3: Commit**

```bash
git add app/agent/page.tsx
git commit -m "feat(agent): landing redirects to most-recent-agent or picker"
```

---

## Task 17: Convert legacy `/agent/[sessionId]` to a 301 redirect

**Files:**
- Modify: `app/agent/[sessionId]/page.tsx`

- [ ] **Step 1: Replace the page with a server-side redirect**

```tsx
import { redirect } from "next/navigation";
import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const queries = makeQueries(db);

export default async function LegacySessionRedirect({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const ctx = await requireActive();

  const ownership = await queries.getSessionOwnership(sessionId);
  if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
    redirect("/agent");
  }

  redirect(`/agent/${ownership.agentType}/${sessionId}`);
}
```

Note: `redirect()` from `next/navigation` is a 307/302 by default in server components. That's fine for this purpose — the URL is rewritten and the browser follows. If true 301 semantics matter (e.g., for external crawler reputation), use `permanentRedirect` instead:

```tsx
import { permanentRedirect } from "next/navigation";
// ...
permanentRedirect(`/agent/${ownership.agentType}/${sessionId}`);
```

- [ ] **Step 2: Dev smoke test**

Run: `bun run dev`. Visit `http://localhost:3000/agent/<any-existing-session-id>` with a signed-in municipality user. Expected: URL bar updates to `/agent/kommune-byggesak-saksbehandler/<id>` and the session view renders.

- [ ] **Step 3: Commit**

```bash
git add app/agent/[sessionId]/page.tsx
git commit -m "feat(agent): legacy /agent/[sessionId] redirects to slug-scoped URL"
```

---

## Task 18: Sidebar multi-agent behavior

**Files:**
- Modify: `app/agent/_components/agent-sidebar.tsx`
- Possibly modify: the server component that loads sessions and renders the sidebar (trace from `agent-sidebar.tsx` to its caller).

- [ ] **Step 1: Read the current sidebar to understand its structure**

Read `app/agent/_components/agent-sidebar.tsx` end-to-end. Identify:
- How it receives the session list (prop shape).
- Where the "Ny samtale" button is rendered.
- Where the session list is rendered.
- What the current active-state signal looks like (probably `href === usePathname()`).

- [ ] **Step 2: Pass `allowedAgents` into the sidebar**

In the server component that hosts the sidebar, compute `allowedAgents` once using `allowedAgentsFor(orgType)` and pass it down. Each agent's `ui.newSessionLabel` and `ui.sessionGroupLabel` should be resolved server-side (via `getAgent(slug).ui`) and passed as serializable strings.

Expose a prop like:

```tsx
type SidebarAgentInfo = {
  slug: string;
  newSessionLabel: string;
  sessionGroupLabel: string;
};

type SessionInfo = {
  anthropicSessionId: string;
  title: string | null;
  agentType: string;
  createdAt: Date;
};

export function AgentSidebar(props: {
  agents: SidebarAgentInfo[];
  sessions: SessionInfo[];
  activeAgent?: string;       // current slug from URL
  activeSessionId?: string;   // current sessionId from URL
}) { /* ... */ }
```

- [ ] **Step 3: Implement single-agent path (N=1)**

When `props.agents.length === 1`:

```tsx
const only = props.agents[0];
return (
  <div className="...">
    <Button asChild variant="default">
      <Link href={`/agent/${only.slug}`}>{only.newSessionLabel}</Link>
    </Button>
    <SidebarGroupHeading>{only.sessionGroupLabel}</SidebarGroupHeading>
    <SessionList sessions={props.sessions} activeSessionId={props.activeSessionId} />
  </div>
);
```

- [ ] **Step 4: Implement multi-agent path (N>1)**

When `props.agents.length > 1`:

```tsx
return (
  <div className="...">
    <div className="flex flex-col gap-2">
      {props.agents.map((a) => {
        const isActive = a.slug === props.activeAgent;
        return (
          <Button
            key={a.slug}
            asChild
            variant={isActive ? "default" : "outline"}
          >
            <Link href={`/agent/${a.slug}`}>{a.newSessionLabel}</Link>
          </Button>
        );
      })}
    </div>

    {props.agents.map((a) => {
      const isActive = a.slug === props.activeAgent;
      const agentSessions = props.sessions.filter((s) => s.agentType === a.slug);
      return (
        <section key={a.slug}>
          <SidebarGroupHeading
            className={isActive ? "text-foreground" : "text-muted-foreground"}
          >
            {a.sessionGroupLabel}
          </SidebarGroupHeading>
          {agentSessions.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Ingen {a.sessionGroupLabel.toLowerCase()} ennå
            </p>
          ) : (
            <SessionList
              sessions={agentSessions}
              activeSessionId={props.activeSessionId}
              slug={a.slug}
            />
          )}
        </section>
      );
    })}
  </div>
);
```

`SessionList` links must construct URLs as `/agent/${slug}/${session.anthropicSessionId}` (not the legacy shape).

- [ ] **Step 5: Wire `activeAgent` from the current URL**

The sidebar's host page (a layout or server component) reads the current URL segment. Next's `usePathname()` is a client hook; alternatively, read params from the route segment and pass `activeAgent` down.

Simplest: make the sidebar itself a client component that uses `usePathname()` to derive `activeAgent` from the `/agent/<slug>/...` path match. That keeps the server component simple and avoids passing route params through props.

```tsx
"use client";
import { usePathname } from "next/navigation";
// ...
const pathname = usePathname();
const activeAgent = pathname.match(/^\/agent\/([^/]+)/)?.[1];
```

- [ ] **Step 6: Dev smoke test**

Run: `bun run dev`. Sign in as an org whose type grants multiple agents (you may need to temporarily assign `municipality` and also add a second agent to `ORG_TYPE_TO_AGENT_SLUGS['municipality']` for local testing — revert before committing).

Verify:
- Two "New session" buttons render, one per agent.
- Active agent's button has `variant="default"`; other has `outline`.
- Group headings both render; active group's heading is fully opaque, inactive is muted.
- Empty agent group shows the "Ingen ... ennå" hint.

Revert any local `ORG_TYPE_TO_AGENT_SLUGS` hacks.

- [ ] **Step 7: Commit**

```bash
git add app/agent/_components/agent-sidebar.tsx
git commit -m "feat(sidebar): group by agent, active-state styling, empty-state hints"
```

---

## Task 19: End-to-end manual verification

**No files changed — this is the pre-merge checklist.**

- [ ] **Step 1: Kommune path**

1. Sign in as a user whose org has `orgType: "municipality"`.
2. Visit `/agent` → expect redirect to `/agent/kommune-byggesak-saksbehandler`.
3. Create a new session with a test byggesak PDF. Verify the agent responds, tool calls fire, `resolve_property` and `get_checkpoints` both work.
4. Refresh the session page — reconstruction should display tool calls with the correct Norwegian display names.

- [ ] **Step 2: Tiltakshaver path (stub)**

1. In the admin UI, create (or update) a test org with `orgType: "tiltakshaver"`.
2. Sign in as a member of that org.
3. Visit `/agent` → expect redirect to `/agent/tiltakshaver-byggesoknad`.
4. Create a new session. Ask "Hva vet du om eiendommen Storgata 1 i Oslo?". Expect the stub to call `resolve_property` and respond with the address's matrikkel info, noting it's a stub agent.
5. Confirm the stub **cannot** call any kommune-only tool (it shouldn't try, but even if it did, dispatch would throw — check the server logs if in doubt).

- [ ] **Step 3: Legacy URL redirect**

1. Grab a pre-existing session ID from the DB (`SELECT anthropic_session_id FROM session_ownership LIMIT 1;`).
2. Visit `/agent/<that-id>` in the browser. Expect URL bar to rewrite to `/agent/kommune-byggesak-saksbehandler/<that-id>` and the session to load.

- [ ] **Step 4: Admin rename**

1. In `/admin`, verify the org-type dropdown shows only `Kommune` and `Tiltakshaver`.
2. Flip a test org from `municipality` to `tiltakshaver`. Confirm both the DB entitlement row and the Clerk public metadata update.

- [ ] **Step 5: Tool isolation**

Re-run Task 13 Step 4 (inspecting the `tiltakshaver-byggesoknad` Anthropic agent's tool list) if anything has changed since. Confirm byggesak-only tools are absent.

- [ ] **Step 6: Sidebar active state (multi-agent)**

Local-only check. Temporarily add `"tiltakshaver-byggesoknad"` to `ORG_TYPE_TO_AGENT_SLUGS.municipality` in `lib/agents/registry.ts`, sign in as a municipality user, and verify:
- Both "New session" buttons appear.
- Active agent's button is `variant="default"`; other is `outline`.
- Both group headings render; empty one shows "Ingen ... ennå".

Revert the registry change before committing or merging.

- [ ] **Step 7: Full build + tests**

Run:

```bash
bun test
bun run build
bun run lint
```

Expected: all green.

- [ ] **Step 8: Final commit (if any small fixes surfaced)**

If any issue was caught and fixed during verification, commit those fixes now. Otherwise, this task produces no commit.

---

## Post-implementation notes

- `.env.local` rename (`ANTHROPIC_AGENT_ID` → `ANTHROPIC_AGENT_ID_KOMMUNE_BYGGESAK_SAKSBEHANDLER`) is a manual step; document in the PR description so other developers update their local envs after pulling.
- Production secrets (Vercel/wherever) need the same rename plus the new `ANTHROPIC_AGENT_ID_TILTAKSHAVER_BYGGESOKNAD` entry before deploy.
- The stub `tiltakshaver-byggesoknad` agent is intentionally not production-quality. The real design lives in the follow-up spec.
