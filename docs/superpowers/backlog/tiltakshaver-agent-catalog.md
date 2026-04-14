# Tiltakshaver / Applier Agent Catalog — Backlog

This file tracks planned extensions to the applier-side and related agent catalog after the v1 `tiltakshaver-byggesoknad` agent ships. Each entry is classified as either a new agent (separate module, separate Anthropic registration) or a feature/tool inside an existing agent.

## Classification criterion

**Separate agent** when it has EITHER:
- A materially different primary audience (private person vs. professional vs. contractor), OR
- A materially different primary data/tool surface (needs regulatory data the existing agents don't have)

**Feature / tool inside an existing agent** when it's just a new workflow step or a new lookup for the same audience + dataset. Default to this classification. Adding a new agent for every workflow creates sidebar clutter, deployment overhead, and context-switching for users.

---

## Future agents (new modules)

### `private-tiltakshaver`
- **Audience:** private person building/renovating their own property (homeowner first-timer).
- **Why separate:** very different persona and vocabulary level. Needs plain Norwegian, jargon translation, patient hand-holding on søknadstype decisions. A professional-tier persona would overwhelm them; a private-tier persona would frustrate a professional.
- **Typical scenarios:** small tilbygg, garasje, platting, bruksendring av kjeller, fasadeendring. Often "do I even need a søknad?" questions.
- **Shared data:** yes — same DIBK sjekklister, just framed as plain-language guidance.
- **Effort:** medium. New persona + workflow; reuse the DIBK tool bundle.

### `entreprenor-gjennomforing`
- **Audience:** entreprenør / utførende (construction firm executing an approved project).
- **Why separate:** execution-phase work with a different regulatory surface — IG (igangsettingstillatelse), KS-dokumentasjon, ansvarsretter, samsvarserklæring, tilsynsplan, sluttkontroll, midlertidig brukstillatelse, ferdigattest. None of this lives in DIBK's søknad-sjekklister.
- **Data dependency:** needs curated content from SAK10 kapittel 10-14, TEK17 § 2-2, and the ansvarsretts-regelverk. This is a significant data-sourcing effort — brainstorm separately before building.
- **Effort:** high (data sourcing dominates). Plan at least two brainstorming sessions — one for data strategy, one for agent design.

### `kommune-tilsyn` (possibly — TBD)
- **Audience:** kommune inspectors running tilsyn on ongoing or completed projects.
- **Why possibly separate:** different workflow (inspection vs. review), different regulatory surface (tilsynsplikt, pbl kapittel 25). Might also be a feature of `kommune-byggesak-saksbehandler` depending on how tilsyn integrates with saksbehandling in practice. Decide at the time — not urgent.
- **Data dependency:** needs tilsyn-specific rules and procedures.

---

## Future features / tools inside existing agents

### Søknadstype classification (inside `tiltakshaver-byggesoknad`)
- **What:** given a project description, determine whether the user needs RS, ET, no søknad at all, or which søknadstype applies.
- **Why a feature, not an agent:** this is literally step 2 of the v1 workflow ("identify søknadstype og tiltakstype"). Making it a separate agent means users context-switch to find out "is this an RS or ET?" and then switch back. It belongs *inside* the main workflow.
- **Possible shape:** either deeper prompt instructions in the existing workflow, or a dedicated custom tool `classify_soknad_type(description)` that returns candidate types with confidence + reasoning.

### Dokumentasjonsliste lookup (inside `tiltakshaver-byggesoknad`, or static UI)
- **What:** given søknadstype + tiltakstype, list all required vedlegg with brief descriptions.
- **Why a feature, not an agent:** deterministic lookup. Might not even need LLM involvement — a static table / UI page could do it.
- **Possible shape:** custom tool `get_required_attachments(søknadstype, tiltakstype)` that the main agent calls mid-workflow. OR a non-LLM page in the app (`/docs/dokumentasjon/<type>`).

### Dispensasjon helper (inside `kommune-byggesak-saksbehandler` AND `tiltakshaver-byggesoknad`)
- **What:** when a checkpoint fails because the project violates a specific pbl/TEK17/SAK10 rule, help the user understand dispensasjon options and draft a begrunnelse (applier side) or evaluate one (kommune side).
- **Why a feature, not an agent:** the dispensasjon workflow is triggered mid-saksbehandling or mid-preparation; it shouldn't be a separate chat. Needs content curation though — dispensasjon practice has patterns that DIBK sjekklister don't encode.
- **Possible shape:** a shared custom tool (in a new `lib/agents/shared/dispensasjon/` bundle) with `find_dispensasjon_precedents(pbl_section, tiltakstype)` and `draft_dispensasjon_begrunnelse(context)`. Both `kommune-byggesak-saksbehandler` and `tiltakshaver-byggesoknad` include it in their bundles.

### Nabovarsel flow (inside `tiltakshaver-byggesoknad`)
- **What:** guide ansvarlig søker through sending nabovarsel correctly — who to notify, what to send, how to handle merknader.
- **Why a feature, not an agent:** nabovarsel is a step in preparing a søknad, not its own end-to-end job.
- **Possible shape:** workflow branch in the main agent when søknadstype requires nabovarsel (ikke alle tiltak gjør det).

### ByggSøk integration
- **What:** read/write from/to ByggSøk (the official Norwegian byggesak portal).
- **Why not yet:** ByggSøk doesn't currently have a public API Boetta can integrate against, last I checked. Blocked on external work. Track for awareness.

### Multi-søknad project tracking
- **What:** treat a building project as an umbrella containing multiple related søknader (RS → ET → IG → endringssøknad → FA) and help the user see status across them.
- **Why not yet:** requires more persistent data model than the current single-session chat architecture. Revisit after the single-session agents are mature.

---

## Decision log

- **2026-04-14:** Chose to ship `tiltakshaver-byggesoknad` v1 as pre-submission checkpoint validator (audience B: ansvarlig søker). Private tiltakshaver (A) and entreprenør (C) deferred.
- **2026-04-14:** Rejected catalog-padding — reclassified "søknadstype classifier", "dokumentasjonsliste", and "dispensasjon helper" from "future agents" to "features/tools inside existing agents" because they don't meet the separate-agent criterion.
