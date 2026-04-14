# Tiltakshaver Byggesøknad v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub `tiltakshaver-byggesoknad` agent with a real pre-submission validator for ansvarlig søkere by promoting the DIBK tool bundle to a shared location and reusing it from both the kommune and tiltakshaver modules.

**Architecture:** Two phases — (1) mechanical refactor that moves `lib/agents/kommune-byggesak-saksbehandler/{data,display-names,tool-bundle,tools,tools.test}.ts` and `data/kommune-byggesak-saksbehandler/` to a shared location and renames the bundle export, with zero behavior change; (2) replace the stub's persona/workflow/agent.ts with full content using the shared bundle.

**Tech Stack:** Next.js 16, TypeScript, Drizzle, `@anthropic-ai/sdk` 0.88, Clerk, bun (test runner + scripts).

---

## File Structure

### New files
- `lib/agents/shared/dibk-checklists/` — new directory containing moved files (created via `git mv`)
- `data/dibk-checklists/` — new data directory (created via `git mv`)

### Renamed (via `git mv`)
- `lib/agents/kommune-byggesak-saksbehandler/data.ts` → `lib/agents/shared/dibk-checklists/data.ts`
- `lib/agents/kommune-byggesak-saksbehandler/display-names.ts` → `lib/agents/shared/dibk-checklists/display-names.ts`
- `lib/agents/kommune-byggesak-saksbehandler/tool-bundle.ts` → `lib/agents/shared/dibk-checklists/tool-bundle.ts`
- `lib/agents/kommune-byggesak-saksbehandler/tools.ts` → `lib/agents/shared/dibk-checklists/tools.ts`
- `lib/agents/kommune-byggesak-saksbehandler/tools.test.ts` → `lib/agents/shared/dibk-checklists/tools.test.ts`
- `data/kommune-byggesak-saksbehandler/` → `data/dibk-checklists/`

### Modified
- `lib/agents/shared/dibk-checklists/data.ts` — update the data folder path constant
- `lib/agents/shared/dibk-checklists/tool-bundle.ts` — rename the export `byggesakToolBundle` → `dibkChecklistsToolBundle`, bundle `id` `"byggesak-checklists"` → `"dibk-checklists"`
- `lib/agents/kommune-byggesak-saksbehandler/agent.ts` — update imports to pull from the shared location; switch to `dibkChecklistsToolBundle`
- `lib/agents/tiltakshaver-byggesoknad/persona.ts` — replace stub with full persona
- `lib/agents/tiltakshaver-byggesoknad/workflow.ts` — replace stub with full 10-step workflow
- `lib/agents/tiltakshaver-byggesoknad/agent.ts` — rewrite using composer + bundles `[dibkChecklistsToolBundle, norwegianRegisters]`

---

## Task 1: Promote DIBK module to shared location and rename bundle

**Files:**
- Move: 5 files from `lib/agents/kommune-byggesak-saksbehandler/` to `lib/agents/shared/dibk-checklists/`
- Move: `data/kommune-byggesak-saksbehandler/` → `data/dibk-checklists/`
- Modify: `lib/agents/shared/dibk-checklists/data.ts` (data path)
- Modify: `lib/agents/shared/dibk-checklists/tool-bundle.ts` (rename export + id)
- Modify: `lib/agents/kommune-byggesak-saksbehandler/agent.ts` (import paths + bundle name)

This is a pure refactor: runtime behavior is unchanged, tests stay green with identical count.

- [ ] **Step 1: Git-move the 5 code files to the shared location**

Run these six commands in order from the repo root:

```bash
git mv lib/agents/kommune-byggesak-saksbehandler/data.ts lib/agents/shared/dibk-checklists/data.ts
git mv lib/agents/kommune-byggesak-saksbehandler/display-names.ts lib/agents/shared/dibk-checklists/display-names.ts
git mv lib/agents/kommune-byggesak-saksbehandler/tool-bundle.ts lib/agents/shared/dibk-checklists/tool-bundle.ts
git mv lib/agents/kommune-byggesak-saksbehandler/tools.ts lib/agents/shared/dibk-checklists/tools.ts
git mv lib/agents/kommune-byggesak-saksbehandler/tools.test.ts lib/agents/shared/dibk-checklists/tools.test.ts
git mv data/kommune-byggesak-saksbehandler data/dibk-checklists
```

`git mv` will create the `lib/agents/shared/` and `lib/agents/shared/dibk-checklists/` directories automatically.

- [ ] **Step 2: Update the data folder path in `data.ts`**

Open `lib/agents/shared/dibk-checklists/data.ts`. Find the string that points at `data/kommune-byggesak-saksbehandler/` (it should be a constant near the top — likely something like `const DATA_DIR = "data/kommune-byggesak-saksbehandler"` or an inline path inside a `path.join(...)` call). Change it to `data/dibk-checklists/` (or equivalent). There should be only ONE path reference to update.

Use Grep to confirm: search for `kommune-byggesak-saksbehandler` inside `lib/agents/shared/dibk-checklists/` — after this step there should be zero matches.

- [ ] **Step 3: Rename the bundle export and id**

Open `lib/agents/shared/dibk-checklists/tool-bundle.ts`. Two renames:

- `export const byggesakToolBundle: ToolBundle = {` → `export const dibkChecklistsToolBundle: ToolBundle = {`
- Inside the object literal: `id: "byggesak-checklists",` → `id: "dibk-checklists",`

Everything else in the file stays unchanged. The `promptFragment` string, the `definitions`/`ownsTool`/`handleToolCall`/`getDisplayName` fields, all unchanged.

- [ ] **Step 4: Update internal imports inside the shared module**

If `tool-bundle.ts` currently imports from `./tools` and `./display-names` (relative paths), those still work because we moved `tools.ts` and `display-names.ts` alongside it. Verify by reading `tool-bundle.ts` — the import lines should be:

```ts
import {
  byggesakToolDefinitions,
  handleToolCall as byggesakHandleToolCall,
} from "./tools";
import { getDisplayName as byggesakGetDisplayName } from "./display-names";
```

These should still resolve correctly. No edits needed unless a file referenced an absolute `@/lib/agents/kommune-byggesak-saksbehandler/...` path — in which case, update those absolute paths. Use Grep on the shared directory for `kommune-byggesak-saksbehandler` to catch any.

- [ ] **Step 5: Update the kommune agent's imports**

Open `lib/agents/kommune-byggesak-saksbehandler/agent.ts`. Two import lines need updating:

Before:
```ts
import { norwegianRegisters } from "@/lib/agents/norwegian-registers";
import { byggesakToolBundle } from "./tool-bundle";
import { generateCompactIndex } from "./data";
```

After:
```ts
import { norwegianRegisters } from "@/lib/agents/norwegian-registers";
import { dibkChecklistsToolBundle } from "@/lib/agents/shared/dibk-checklists/tool-bundle";
import { generateCompactIndex } from "@/lib/agents/shared/dibk-checklists/data";
```

Then find where `byggesakToolBundle` is used (there are two references — in the `bundles` array and nowhere else):

Before:
```ts
const bundles = [byggesakToolBundle, norwegianRegisters];
```

After:
```ts
const bundles = [dibkChecklistsToolBundle, norwegianRegisters];
```

No other changes in this file.

- [ ] **Step 6: Check for any other lingering references**

Run Grep with pattern `byggesakToolBundle` across the codebase (excluding `docs/` and `.worktrees/` and `node_modules/`). Expected: zero matches — all usages renamed.

Run Grep with pattern `data/kommune-byggesak-saksbehandler` similarly. Expected: zero matches — the data folder name is no longer referenced anywhere.

If either grep returns matches, update them to the new names.

- [ ] **Step 7: Run tests**

```bash
cd /Users/espennoreng/repo/boetta-v2  # or the worktree root
bun test
```

Expected: 110 pass / 4 skip / 0 fail (same as pre-refactor).

- [ ] **Step 8: Run type check**

```bash
bun run build 2>&1 | tail -30
```

Expected: no TypeScript errors. The pre-existing `/admin` page pre-render runtime error (due to DB connection during build) is acceptable and unrelated.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(agents): promote DIBK checklist bundle to shared location"
```

---

## Task 2: Write the tiltakshaver persona and workflow

**Files:**
- Modify: `lib/agents/tiltakshaver-byggesoknad/persona.ts` (replace stub)
- Modify: `lib/agents/tiltakshaver-byggesoknad/workflow.ts` (replace stub)

These are pure content changes. No code logic, no tests to write.

- [ ] **Step 1: Replace `persona.ts`**

Replace the entire contents of `lib/agents/tiltakshaver-byggesoknad/persona.ts` with:

```ts
export const PERSONA = `Du er en assistent for ansvarlig søker som forbereder byggesøknad til norske kommuner. Målet er at søknaden blir godkjent første gang — uten mangelbrev, uten avvik, uten tilleggsopplysninger. Du er grundig, praktisk, og sparer ansvarlig søker for tid ved å peke på problemer før kommunen gjør det.

Du snakker norsk (bokmål). Du er grundig og systematisk — et oversett sjekkpunkt kan bety at søknaden må sendes på nytt.`;
```

Note: two paragraphs, separated by a blank line inside the template literal. The closing backtick immediately follows "på nytt." — no trailing newline (matches the convention established in the multi-agent modularization).

- [ ] **Step 2: Replace `workflow.ts`**

Replace the entire contents of `lib/agents/tiltakshaver-byggesoknad/workflow.ts` with:

```ts
export const WORKFLOW = `Når ansvarlig søker starter en økt:
1. Les den vedlagte PDF-en (om lastet opp) eller be om en kort beskrivelse av prosjektet.
2. Identifiser søknadstypen (RS, ET, IG, FA, ES, MB, NV, TA) og tiltakstypen. Hvis uklart, spør ansvarlig søker.
3. Kall get_checklist_overview for å bekrefte omfanget.
4. Kall get_checkpoints filtrert på type og tiltakstype for å hente relevante sjekkpunkter.
5. Gå gjennom sjekkpunktene tema for tema, start med Generelt.
6. For hvert sjekkpunkt, vurder status FØR innsending:
   - 🟢 Dekket: søknaden har det kommunen vil se etter.
   - 🟡 Uklart: delvis dekket, trenger presisering eller bedre dokumentasjon.
   - 🔴 Mangler: må legges til før innsending.
7. Kall get_checkpoint_detail når du trenger undersjekkpunkter, utfall eller lovhjemler.
8. Kall evaluate_rules når sjekkpunkter har betingede avhengigheter.
9. **VIKTIG: Når du ikke kan avgjøre noe fra PDF-en eller samtalen, STOPP og spør ansvarlig søker umiddelbart.** Still ett spørsmål om gangen (bruk [svar: …]-formatet), vent på svar, fortsett deretter.
10. Presenter funn per tema i markdown-tabell (samme struktur som kommunen bruker) med "før innsending"-perspektiv. Etter tabellen, gi en kort oppsummering av hva som gjenstår før søknaden er klar.`;
```

Same convention: no trailing newline; composer will add `\n\n` between sections.

- [ ] **Step 3: Run tests**

```bash
bun test
```

Expected: 110 pass / 4 skip / 0 fail. These are pure string changes; tests don't depend on them.

- [ ] **Step 4: Commit**

```bash
git add lib/agents/tiltakshaver-byggesoknad/persona.ts lib/agents/tiltakshaver-byggesoknad/workflow.ts
git commit -m "feat(tiltakshaver-byggesoknad): write full persona and workflow"
```

---

## Task 3: Rewrite the tiltakshaver agent module

**Files:**
- Modify: `lib/agents/tiltakshaver-byggesoknad/agent.ts` (replace stub)

The stub currently imports only `norwegianRegisters`. The v1 agent uses the full bundle list `[dibkChecklistsToolBundle, norwegianRegisters]`, all three shared prompt fragments, and the `## Sjekkpunktindeks` dynamic section.

- [ ] **Step 1: Replace `agent.ts`**

Replace the entire contents of `lib/agents/tiltakshaver-byggesoknad/agent.ts` with:

```ts
import type { AgentModule } from "@/lib/agents/types";
import { composeSystemPrompt } from "@/lib/agents/compose-system-prompt";
import { answerChipsFragment } from "@/lib/agents/shared/prompt-fragments/answer-chips";
import { findingsTableFragment } from "@/lib/agents/shared/prompt-fragments/findings-table";
import { lawCitationsFragment } from "@/lib/agents/shared/prompt-fragments/law-citations";
import { dibkChecklistsToolBundle } from "@/lib/agents/shared/dibk-checklists/tool-bundle";
import { generateCompactIndex } from "@/lib/agents/shared/dibk-checklists/data";
import { norwegianRegisters } from "@/lib/agents/norwegian-registers";
import { PERSONA } from "./persona";
import { WORKFLOW } from "./workflow";

const bundles = [dibkChecklistsToolBundle, norwegianRegisters];

export const tiltakshaverByggesoknadAgent: AgentModule = {
  id: "tiltakshaver-byggesoknad",

  createAgentConfig() {
    return {
      name: "Tiltakshaver Byggesøknad",
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
    newSessionLabel: "Ny søknad",
    sessionGroupLabel: "Mine søknader",
  },
};
```

Key details:
- `name` (Anthropic display name) changed from `"Tiltakshaver Byggesøknad (Stub)"` to `"Tiltakshaver Byggesøknad"` — the `(Stub)` suffix is removed because this is the real v1 now.
- Model upgraded from `"claude-haiku-4-5-20251001"` (stub) to `"claude-sonnet-4-6"` — same model the kommune agent uses. The stub was on Haiku to save cost during infra testing; v1 needs Sonnet-grade reasoning for checkpoint walkthroughs.
- `bundles` order is `[dibkChecklistsToolBundle, norwegianRegisters]` so `## Verktøybruk` comes before `## Oppslag i offentlige registre` in the composed prompt (matches the kommune agent).
- `ui` labels unchanged from the stub — generic enough for v1 and future feature additions.
- Conventions in order: answer chips, findings table, law citations (same as kommune).
- Dynamic section: the DIBK checkpoint index, imported from the shared `data.ts`.

- [ ] **Step 2: Verify the composed prompt has all expected sections**

Create a one-shot verification script at `scripts/verify-tiltakshaver-prompt.ts`:

```ts
import { tiltakshaverByggesoknadAgent } from "@/lib/agents/tiltakshaver-byggesoknad/agent";

const config = tiltakshaverByggesoknadAgent.createAgentConfig();
console.log("--- COMPOSED PROMPT ---");
console.log(config.system);
console.log("--- END ---");
console.log(`\nLength: ${config.system.length} chars`);
console.log(`Model: ${config.model}`);
console.log(`Name: ${config.name}`);
console.log(`Tool count: ${config.tools.length}`);
```

Run:
```bash
bun run scripts/verify-tiltakshaver-prompt.ts
```

Verify the output contains these section headings in this exact order:
1. (persona — starts with "Du er en assistent for ansvarlig søker…", no heading)
2. `## Arbeidsflyt`
3. `## Spørsmål til saksbehandler`
4. `## Presentasjon av funn`
5. `## Lovhenvisninger`
6. `## Verktøybruk`
7. `## Oppslag i offentlige registre`
8. `## Sjekkpunktindeks`

Verify numeric details:
- Tool count: **10** (1 managed toolset + 6 DIBK tools + 3 register tools). Same tool count as the kommune agent.
- Model: `claude-sonnet-4-6`.
- Name: `Tiltakshaver Byggesøknad` (no "(Stub)").
- Length: approximately the same as the kommune agent's composed prompt — both include the Sjekkpunktindeks dynamic block which dominates the length.

Delete the script after verifying:
```bash
rm scripts/verify-tiltakshaver-prompt.ts
```

- [ ] **Step 3: Compare against the kommune agent's composed prompt**

This is a sanity check for structural symmetry. Create a temporary diff script at `scripts/diff-agent-prompts.ts`:

```ts
import { kommuneByggesakSaksbehandlerAgent } from "@/lib/agents/kommune-byggesak-saksbehandler/agent";
import { tiltakshaverByggesoknadAgent } from "@/lib/agents/tiltakshaver-byggesoknad/agent";

const k = kommuneByggesakSaksbehandlerAgent.createAgentConfig().system;
const t = tiltakshaverByggesoknadAgent.createAgentConfig().system;

function headings(s: string) {
  return s.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.trim());
}

console.log("KOMMUNE headings:");
headings(k).forEach((h) => console.log("  " + h));
console.log("\nTILTAKSHAVER headings:");
headings(t).forEach((h) => console.log("  " + h));
```

Run:
```bash
bun run scripts/diff-agent-prompts.ts
```

Expected output:
```
KOMMUNE headings:
  ## Arbeidsflyt
  ## Spørsmål til saksbehandler
  ## Presentasjon av funn
  ## Lovhenvisninger
  ## Verktøybruk
  ## Oppslag i offentlige registre
  ## Sjekkpunktindeks

TILTAKSHAVER headings:
  ## Arbeidsflyt
  ## Spørsmål til saksbehandler
  ## Presentasjon av funn
  ## Lovhenvisninger
  ## Verktøybruk
  ## Oppslag i offentlige registre
  ## Sjekkpunktindeks
```

Identical heading structure. The only difference between the two prompts should be:
- The persona opener (kommune's "Du er en assistent for byggesaksbehandling…" vs tiltakshaver's "Du er en assistent for ansvarlig søker…")
- The workflow body (kommune's 10-step review flow vs tiltakshaver's 10-step pre-submission flow)

Delete the script after verifying:
```bash
rm scripts/diff-agent-prompts.ts
```

- [ ] **Step 4: Run tests and build**

```bash
bun test
bun run build 2>&1 | tail -20
```

Expected:
- `bun test`: 110 pass / 4 skip / 0 fail
- `bun run build`: TypeScript clean. The pre-existing `/admin` page pre-render runtime error is acceptable.

- [ ] **Step 5: Commit**

```bash
git add lib/agents/tiltakshaver-byggesoknad/agent.ts
git commit -m "feat(tiltakshaver-byggesoknad): replace stub with full composer+bundles agent"
```

---

## Task 4: Sync the Anthropic-side managed agent

**Files:** None (manual script invocation + `.env.local` update).

This updates the `tiltakshaver-byggesoknad` managed agent on Anthropic's side so its registered system prompt and tool list match the v1 code. The agent ID stays the same (existing env var `ANTHROPIC_AGENT_ID_TILTAKSHAVER_BYGGESOKNAD` is reused); only the registered config changes.

- [ ] **Step 1: Run `sync-agent`**

From the repo root (or the worktree root — whichever has the updated code):

```bash
bun run sync-agent
```

Expected output (approximate):
```
✓ Environment env_... exists
✓ Updated agent kommune-byggesak-saksbehandler: ag_... (vN → vN+1)
✓ Updated agent tiltakshaver-byggesoknad: ag_... (vM → vM+1)

# Copy into .env.local

ANTHROPIC_AGENT_ID_KOMMUNE_BYGGESAK_SAKSBEHANDLER=ag_...
ANTHROPIC_AGENT_ID_TILTAKSHAVER_BYGGESOKNAD=ag_...
```

Both agents are UPDATED (not created) because both env vars should already exist from the multi-agent modularization work. If `sync-agent` reports "Created" for either, that means the corresponding env var was missing — check `.env.local` and re-run.

- [ ] **Step 2: Verify the tiltakshaver agent's registered tool set**

Run the inspection script (ad-hoc — do NOT commit it):

```bash
bun -e '
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, existsSync } from "node:fs";
if (existsSync(".env.local")) for (const l of readFileSync(".env.local","utf8").split("\n")) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) process.env[m[1]] ??= m[2].replace(/^["\x27]|["\x27]$/g,""); }
const c = new Anthropic();
const id = process.env.ANTHROPIC_AGENT_ID_TILTAKSHAVER_BYGGESOKNAD;
const a = await c.beta.agents.retrieve(id);
const tools = a.tools.map(t => t.type === "custom" ? t.name : t.type);
console.log("Name:", a.name);
console.log("Model:", a.model);
console.log("Version:", a.version);
console.log("Tools:", tools);
'
```

Expected:
- Name: `Tiltakshaver Byggesøknad` (no "(Stub)" suffix)
- Model: `claude-sonnet-4-6`
- Tools: `agent_toolset_20260401`, plus all six DIBK tools (`get_checklist_overview`, `get_checkpoints`, `get_checkpoint_detail`, `evaluate_rules`, `search_checkpoints`, `find_checkpoints_by_law`), plus all three register tools (`resolve_property`, `nve_check`, `riksantikvaren_check`). Ten entries total.

If the tool list is still the stub's (only `agent_toolset_20260401` + three register tools), `sync-agent` didn't pick up the new code — re-run it from the correct directory.

- [ ] **Step 3: No commit for this task**

`sync-agent` doesn't produce source-code changes. `.env.local` values may change (agent version) but `.env.local` is gitignored. Proceed to Task 5.

---

## Task 5: End-to-end manual verification

**No file changes.** This is the pre-merge checklist — exercised in a browser against `bun run dev`.

Prerequisite: `.env.local` has both `ANTHROPIC_AGENT_ID_KOMMUNE_BYGGESAK_SAKSBEHANDLER` and `ANTHROPIC_AGENT_ID_TILTAKSHAVER_BYGGESOKNAD` set. A test org with `orgType: "tiltakshaver"` exists in Clerk (flipped via `/admin`).

- [ ] **Step 1: Start dev server**

```bash
bun run dev
```

- [ ] **Step 2: Kommune regression check**

Sign in as a user in a municipality org.

1. Visit `/agent` → redirects to `/agent/kommune-byggesak-saksbehandler`.
2. Start a new session with a test byggesak PDF.
3. Confirm the agent still behaves identically to before the shared-module refactor: identifies søknadstype, calls `get_checkpoints`, walks checkpoints tema for tema, presents findings in the 🟢🟡🔴 markdown table.
4. Reload the session mid-conversation; tool call display names should rehydrate correctly (this verifies `display-names.ts` still resolves through the shared module).

- [ ] **Step 3: Tiltakshaver pre-submission walkthrough**

Sign in as a user in the tiltakshaver test org.

1. Visit `/agent` → redirects to `/agent/tiltakshaver-byggesoknad`.
2. Start a new session. Either:
   - Upload a real draft søknad PDF, OR
   - Describe the project conversationally: "Jeg skal sende inn ettrinnssøknad for et tilbygg på 30 m² på gnr/bnr 123/45 i Drammen."
3. Confirm the agent:
   - Identifies søknadstype + tiltakstype (asks if ambiguous, using `[svar: …]` chips).
   - Calls `get_checklist_overview` and `get_checkpoints`.
   - Walks checkpoints tema for tema.
   - For each checkpoint, uses the 🟢 Dekket / 🟡 Uklart / 🔴 Mangler framing (not 🟢 OK / 🟡 Delvis / 🔴 Mangler which is the kommune agent's exact wording — the findings-table fragment is shared, so the status column might use the shared labels; as long as the three colors map semantically to "covered / unclear / missing" for the submitter, that's correct).
   - Presents a markdown table of findings at the end of each tema with a "before submission" framing.
4. Call `resolve_property` should fire when an address is mentioned.
5. If the project mentions a flood-prone area, `nve_check` should fire automatically.

- [ ] **Step 4: Persona enforcement check**

In the tiltakshaver session, verify the agent's replies feel submitter-facing, not kommune-facing:

- Agent says things like "du bør legge ved X", "søknaden din trenger Y", "før du sender inn bør du…".
- Agent does NOT say things like "saksbehandler bør sjekke X", "denne søknaden mangler Y" (reviewer phrasing).
- Agent is proactive about finding gaps, not reactive about flagging errors.

If the agent consistently slips into reviewer phrasing, that's a persona tuning issue — revisit the persona wording before shipping. Ideally this won't happen; the persona explicitly frames the agent as submitter-side.

- [ ] **Step 5: Tool isolation check** (defense-in-depth)

Run the ad-hoc inspection from Task 4 Step 2 for BOTH agents. Expected: both should have the same 10-tool list (1 managed toolset + 6 DIBK + 3 registers). That's correct — the two agents are structurally symmetric consumers of the same data.

This check isn't about different tool sets (they're the same); it's about confirming that the agents are distinct on Anthropic's side (different `ag_...` IDs, different system prompts). Run:

```bash
bun -e '
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, existsSync } from "node:fs";
if (existsSync(".env.local")) for (const l of readFileSync(".env.local","utf8").split("\n")) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) process.env[m[1]] ??= m[2].replace(/^["\x27]|["\x27]$/g,""); }
const c = new Anthropic();
for (const slug of ["kommune-byggesak-saksbehandler","tiltakshaver-byggesoknad"]) {
  const id = process.env[`ANTHROPIC_AGENT_ID_${slug.toUpperCase().replace(/-/g,"_")}`];
  const a = await c.beta.agents.retrieve(id);
  console.log(slug, "→", a.id, "(" + a.name + ")");
  const personaPreview = a.system.split("\n")[0].slice(0, 80);
  console.log("  system opener:", personaPreview);
}
'
```

Expected:
- Two distinct `ag_...` IDs.
- Kommune system opens with "Du er en assistent for byggesaksbehandling i norske kommuner…"
- Tiltakshaver system opens with "Du er en assistent for ansvarlig søker som forbereder byggesøknad…"

- [ ] **Step 6: Full test + lint + build sanity**

```bash
bun test
bun run build 2>&1 | tail -10
```

Expected:
- Tests: 110 pass / 4 skip / 0 fail (unchanged by this feature work).
- Build: TypeScript clean; pre-existing `/admin` DB pre-render error acceptable.

- [ ] **Step 7: No commit for this task**

Manual verification produces no code changes. If you caught an issue during verification, fix it in a follow-up commit scoped narrowly to that issue.

---

## Post-implementation notes

- The `.env.local` entry for the tiltakshaver agent keeps the same `ag_...` ID across this change — no one needs to update their local env. Production secrets are unaffected for the same reason.
- Existing tiltakshaver sessions created against the stub will continue to work; they're just bound to a managed agent ID whose registered config has been updated. The old sessions' earlier events stay in Anthropic's event log and are still retrievable — the agent upgrade doesn't rewrite history.
- If you ever need to roll back (e.g., if the v1 persona turns out to cause regressions in production), the rollback is: revert the last two or three commits (Tasks 2, 3, and optionally 1) and re-run `sync-agent`. The stub state is easily recoverable.
