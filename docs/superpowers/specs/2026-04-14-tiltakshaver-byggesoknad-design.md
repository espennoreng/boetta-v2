# Tiltakshaver Byggesøknad Agent — Pre-Submission Validator

## Goal

Replace the stub `tiltakshaver-byggesoknad` agent with a real pre-submission validator for ansvarlig søkere. Given a draft søknad (PDF or conversational description), the agent walks the submitter through the same DIBK sjekklister the kommune will use after submission, and produces a gap report so the ansvarlig søker can fix issues *before* filing and avoid mangelbrev/avviksvarsler.

The strategic value: the kommune agent and the tiltakshaver agent use the **same DIBK dataset from opposite sides**. A kommune saksbehandler reviewing a søknad and an ansvarlig søker preparing one should reach the same verdict on any given checkpoint — divergence would undermine trust in both agents. Sharing the data asset enforces that symmetry.

## Decisions

- **Audience:** ansvarlig søker (professional — "B" in the brainstorm). Private tiltakshaver (audience "A") and entreprenør (audience "C") are explicitly out of scope; each would be its own agent with its own persona and (for C) its own dataset.
- **v1 job-to-be-done:** pre-submission checkpoint walkthrough. Søknadstype classification, dokumentasjonsliste lookup, and dispensasjon drafting are *features of this agent*, not separate agents — see [Future catalog](../backlog/tiltakshaver-agent-catalog.md).
- **Input:** hybrid — user uploads a draft PDF *or* describes the project conversationally. Same shape as the kommune agent.
- **Output:** markdown findings table with color-coded status per checkpoint (🟢 Dekket / 🟡 Uklart / 🔴 Mangler), same shape as the kommune agent's output.
- **Tools:** reuse the kommune agent's DIBK tool bundle (promoted to a shared module in this spec) + `norwegianRegisters`. No new applier-specific tools in v1.
- **Module architecture:** promote `kommune-byggesak-saksbehandler/tool-bundle.ts` + `data.ts` + `display-names.ts` + `tools.test.ts` to a shared location `lib/agents/shared/dibk-checklists/`. Rename the bundle from `byggesakToolBundle` to `dibkChecklistsToolBundle`. Rename the data folder from `data/kommune-byggesak-saksbehandler/` to `data/dibk-checklists/`. Both agents import from the shared location.
- **UI labels:** keep the stub's current labels (`newSessionLabel: "Ny søknad"`, `sessionGroupLabel: "Mine søknader"`) — generic enough to cover v1's narrow job and future feature additions without re-labeling.
- **Anthropic-side:** continue with the per-slug managed-agent pattern. Both agents end up registered with the same DIBK tools under the hood, which is fine — session-level tool isolation still holds (a `kommune-...` session can't be tricked into calling a bundle the `tiltakshaver-...` session owns, or vice versa, because each session is bound to its own Anthropic agent ID).

## Architecture

```
Browser
  /agent/tiltakshaver-byggesoknad           → new session (as today)
  /agent/tiltakshaver-byggesoknad/[id]      → existing session view (as today)

Agent module
  lib/agents/tiltakshaver-byggesoknad/
    persona.ts     → full ansvarlig-søker persona (replaces stub)
    workflow.ts    → full 10-step pre-submission workflow (replaces stub)
    agent.ts       → uses composer + bundles [dibkChecklistsToolBundle, norwegianRegisters]

Shared data module (NEW — promoted from kommune module)
  lib/agents/shared/dibk-checklists/
    data.ts                 → JSON loader + query functions
    display-names.ts        → Norwegian display names for tool calls
    tool-bundle.ts          → exports dibkChecklistsToolBundle
    tools.test.ts           → existing test suite for the tools
  data/dibk-checklists/     → JSON files for RS, ET, IG, FA, ES, MB, NV, TA (renamed)

Kommune module (UPDATED — imports from new shared location)
  lib/agents/kommune-byggesak-saksbehandler/
    agent.ts       → imports dibkChecklistsToolBundle from shared location
    persona.ts     → unchanged
    workflow.ts    → unchanged
    (tool-bundle.ts, data.ts, display-names.ts, tools.test.ts all moved to shared)
```

### Tool bundle in practice

`dibkChecklistsToolBundle` is the existing `byggesakToolBundle` renamed and moved. Its `id` becomes `"dibk-checklists"`. Its `promptFragment` — the `## Verktøybruk` section — stays with the bundle; it's tool-usage guidance that applies regardless of perspective (`use get_checkpoints with filters`, `use search_checkpoints only when …`, etc.).

Both agents assemble their `bundles` array the same way:

```ts
// kommune-byggesak-saksbehandler/agent.ts
const bundles = [dibkChecklistsToolBundle, norwegianRegisters];

// tiltakshaver-byggesoknad/agent.ts
const bundles = [dibkChecklistsToolBundle, norwegianRegisters];
```

The `dispatch` pattern (`bundles.find(b => b.ownsTool(name))`) already handles this shape from the multi-agent refactor.

### Persona

```
Du er en assistent for ansvarlig søker som forbereder byggesøknad til norske
kommuner. Målet er at søknaden blir godkjent første gang — uten mangelbrev,
uten avvik, uten tilleggsopplysninger. Du er grundig, praktisk, og sparer
ansvarlig søker for tid ved å peke på problemer før kommunen gjør det.

Du snakker norsk (bokmål). Du er grundig og systematisk — et oversett
sjekkpunkt kan bety at søknaden må sendes på nytt.
```

Two explicit invariants the persona enforces:

1. **Mirror the kommune agent's standards exactly.** The DIBK sjekklister are the same data from both sides; if the kommune agent would flag X as missing, this agent must flag it as "add X before you submit". Divergence would undermine trust in both agents. The shared data asset enforces this structurally — there is no second copy of the checkpoints to drift.
2. **Act proactively, not reactively.** The kommune agent reviews a submitted thing. This agent helps produce a submittable thing. Same finding, different framing: "legg til X" instead of "X mangler".

### Workflow

```
Når ansvarlig søker starter en økt:
1. Les den vedlagte PDF-en (om lastet opp) eller be om en kort beskrivelse av prosjektet.
2. Identifiser søknadstypen (RS, ET, IG, FA, ES, MB, NV, TA) og tiltakstypen.
   Hvis uklart, spør ansvarlig søker.
3. Kall get_checklist_overview for å bekrefte omfanget.
4. Kall get_checkpoints filtrert på type og tiltakstype for å hente relevante
   sjekkpunkter.
5. Gå gjennom sjekkpunktene tema for tema, start med Generelt.
6. For hvert sjekkpunkt, vurder status FØR innsending:
   - 🟢 Dekket: søknaden har det kommunen vil se etter.
   - 🟡 Uklart: delvis dekket, trenger presisering eller bedre dokumentasjon.
   - 🔴 Mangler: må legges til før innsending.
7. Kall get_checkpoint_detail når du trenger undersjekkpunkter, utfall eller lovhjemler.
8. Kall evaluate_rules når sjekkpunkter har betingede avhengigheter.
9. **VIKTIG: Når du ikke kan avgjøre noe fra PDF-en eller samtalen, STOPP og
   spør ansvarlig søker umiddelbart.** Still ett spørsmål om gangen (bruk
   [svar: …]-formatet), vent på svar, fortsett deretter.
10. Presenter funn per tema i markdown-tabell (samme struktur som kommunen bruker)
    med "før innsending"-perspektiv. Etter tabellen, gi en kort oppsummering
    av hva som gjenstår før søknaden er klar.
```

### Shared fragments reused verbatim

All three reused:

- `answerChipsFragment` — [svar: …] UI contract is identical.
- `findingsTableFragment` — the 🟢🟡🔴 markdown-table format. Column header "Funn" is neutral enough to work from both sides (interpretation is "what you found when checking this").
- `lawCitationsFragment` — ansvarlig søker cites pbl/SAK10/TEK17 exactly like saksbehandler does.

### Dynamic sections

The kommune agent appends a `## Sjekkpunktindeks` dynamic section (`generateCompactIndex()`) to anchor the LLM in the available checkpoint IDs. The tiltakshaver agent uses the same dynamic section — same data, same anchor, same benefit. This is a trivial import of `generateCompactIndex` from the shared module.

### Tool guidance fragment

`dibkChecklistsToolBundle.promptFragment` (the `## Verktøybruk` section) is tool-usage, not perspective-specific. Works for both agents verbatim.

`norwegianRegisters.promptFragment` is `## Oppslag i offentlige registre`. The kommune version says "spør saksbehandleren" as a fallback; the tiltakshaver version should say "spør ansvarlig søker" instead. Two options:

- **A) Reuse as-is.** The word "saksbehandler" appears only once in the fragment's fallback clause ("fall tilbake til å spørre saksbehandleren (som før)"). The LLM will understand the fallback means "the human user" regardless of label — it's not acting on this word directly. Accept the minor friction.
- **B) Make the fragment perspective-aware** — accept a `humanLabel` parameter when consuming it. Parameterizes one shared fragment across both agents.

Recommendation: **A for v1**. The friction is negligible, and adding parameterization to a shared fragment now is premature. If we discover during real use that the LLM actually parrots "saksbehandleren" back to an ansvarlig søker in a user-visible way, override with a tiltakshaver-specific variant of the fragment.

## Migration plan (order matters)

1. **Promote DIBK module to shared location.**
   - `git mv` `lib/agents/kommune-byggesak-saksbehandler/data.ts` → `lib/agents/shared/dibk-checklists/data.ts` (this creates the shared directory).
   - `git mv` `lib/agents/kommune-byggesak-saksbehandler/display-names.ts` → `lib/agents/shared/dibk-checklists/display-names.ts`.
   - `git mv` `lib/agents/kommune-byggesak-saksbehandler/tool-bundle.ts` → `lib/agents/shared/dibk-checklists/tool-bundle.ts`.
   - `git mv` `lib/agents/kommune-byggesak-saksbehandler/tools.ts` → `lib/agents/shared/dibk-checklists/tools.ts`.
   - `git mv` `lib/agents/kommune-byggesak-saksbehandler/tools.test.ts` → `lib/agents/shared/dibk-checklists/tools.test.ts`.
   - `git mv` `data/kommune-byggesak-saksbehandler/` → `data/dibk-checklists/`.
   - Update the data path constant in `data.ts`.
2. **Rename the bundle export.**
   - In `lib/agents/shared/dibk-checklists/tool-bundle.ts`: rename `byggesakToolBundle` → `dibkChecklistsToolBundle`, bundle `id` from `"byggesak-checklists"` to `"dibk-checklists"`.
3. **Update the kommune agent's imports.**
   - `lib/agents/kommune-byggesak-saksbehandler/agent.ts`: update imports to pull `dibkChecklistsToolBundle` and `generateCompactIndex` from the shared location.
4. **Write the tiltakshaver v1 files.**
   - Replace `lib/agents/tiltakshaver-byggesoknad/persona.ts` with the full persona.
   - Replace `lib/agents/tiltakshaver-byggesoknad/workflow.ts` with the full 10-step workflow.
   - Replace `lib/agents/tiltakshaver-byggesoknad/agent.ts` — same shape as kommune's agent, but persona/workflow from the tiltakshaver module, `bundles = [dibkChecklistsToolBundle, norwegianRegisters]`, `dynamicSections: [{ heading: "Sjekkpunktindeks", body: generateCompactIndex() }]`.
5. **Sync the Anthropic managed agent.**
   - Run `bun run sync-agent` to update the `tiltakshaver-byggesoknad` agent's registered system prompt and tool set on Anthropic's side.
6. **Verify the composed prompt.**
   - Diff the composed system prompt against the kommune agent's — both should have identical `## Verktøybruk`, `## Oppslag i offentlige registre`, `## Spørsmål til saksbehandler`, `## Lovhenvisninger`, `## Presentasjon av funn`, `## Sjekkpunktindeks` sections. Differences: persona opener + workflow body + agent name.

## Testing strategy

- **Tests move with the files.** `tools.test.ts` moves into `lib/agents/shared/dibk-checklists/`; nothing in it changes. Test count stays at 110/4/0.
- **No new unit tests needed.** The agent module's logic is pure composition of existing pieces (composer, bundles, shared fragments). Unit testing the string output of `createAgentConfig().system` would just re-test the composer, which already has 9 tests.
- **Manual verification checklist** (for the PR):
  - `/agent/tiltakshaver-byggesoknad` loads; new session prompts for PDF or description.
  - Upload a real draft søknad PDF; agent identifies type and walks checkpoints.
  - Start with conversational input only ("jeg skal rive en garasje i Drammen"); agent asks clarifying questions and proceeds.
  - Agent calls `resolve_property` when an address is mentioned.
  - Agent's findings table uses 🟢🟡🔴 with "før innsending" framing.
  - Agent's tool set on Anthropic includes the six DIBK tools + three register tools (10 total incl. managed toolset).
  - Agent does NOT answer as if it were a saksbehandler ("jeg skal gjennomgå denne søknaden") — the persona enforcement from v1 should prevent this.

## Risks and mitigations

- **Persona drift between kommune and tiltakshaver agents.** The two agents share the same DIBK data but can interpret checkpoints differently under prompt pressure. Mitigation: shared `dibkChecklistsToolBundle.promptFragment` (tool usage rules) + shared `findingsTableFragment` (output format). Divergence should only appear in persona + workflow, both of which explicitly reference "the kommune's standards" as authoritative.
- **"Saksbehandler" language leaking from shared fragments.** The `norwegianRegisters.promptFragment` has one "spør saksbehandleren" fallback clause. If real use shows this leaks into user-visible output, override with a tiltakshaver-specific variant (Option B from the Tool guidance section). Not fixing upfront; YAGNI.
- **Prompt length.** Both agents now include the `## Sjekkpunktindeks` dynamic block, which is the largest dynamic section. Byggesak's composed prompt was ~24k chars; tiltakshaver's will be similar. Well within Anthropic's system-prompt limits.
- **Anthropic agent re-registration.** Updating the tiltakshaver agent's tool list via `sync-agent` is an idempotent update (existing env var `ANTHROPIC_AGENT_ID_TILTAKSHAVER_BYGGESOKNAD` is reused). The existing stub ID stays; only its registered config changes.

## Out of scope for v1

These are future work, captured in the backlog file `docs/superpowers/backlog/tiltakshaver-agent-catalog.md`:

- Søknadstype classifier (will be folded into this agent's workflow, not a separate agent).
- Dokumentasjonsliste lookup (may be a tool or even a static UI page).
- Dispensasjon helper (may be a shared tool between kommune + tiltakshaver agents).
- Private tiltakshaver agent (audience A — its own module, different persona).
- Entreprenør gjennomføring agent (audience C — its own module, needs new regulatory data).
- Nabovarsel flow, ByggSøk integration, multi-søknad project tracking.
