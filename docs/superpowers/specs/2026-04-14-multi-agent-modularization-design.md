# Multi-Agent Modularization

## Goal

Refactor the single-agent architecture into a modular multi-agent catalog, and ship the infrastructure end-to-end with a second stub agent as proof. Today the system is hardcoded to one agent (`byggesak`) serving municipality case workers. We need to cleanly support parallel agents serving different organization types (starting with an applier-side agent, `tiltakshaver-byggesoknad`), and keep the cost of adding each *next* agent low — most of a new agent should be a folder of persona + workflow text, composed with shared prompt fragments and tool bundles.

This spec covers the infrastructure work only. The real `tiltakshaver-byggesoknad` agent (persona, workflow, applier-specific tools, UX details) is a separate follow-up spec. The stub module shipped here exists to prove the multi-agent path runs end-to-end.

## Decisions

- **Slug naming:** Descriptive, domain-prefixed slugs. Folder name = registry key = `sessionOwnership.agentType` value. Current `byggesak` renames to `kommune-byggesak-saksbehandler`; new stub is `tiltakshaver-byggesoknad`. Future agents follow the same convention (`<orgtype>-<workflow>-<role>`).
- **Org-to-agent mapping:** Each Clerk org has a type (`municipality | tiltakshaver`); type unlocks a fixed set of agents (static code map, not a DB table). One org → one type → N agents.
- **`orgType` storage:** Stays in Clerk public metadata (status quo). Rename existing `business` enum value to `tiltakshaver`. Existing `business` org count is zero, so the data migration is a no-op but still ships as an idempotent script.
- **`agentType` storage:** New `TEXT NOT NULL` column on `sessionOwnership`. Backfilled to `kommune-byggesak-saksbehandler` for all pre-existing sessions.
- **Prompt composition:** Function composer `composeSystemPrompt({ persona, workflow, conventions, toolGuidance, dynamicSections })` with fixed section order. Shared fragments live in `lib/agents/shared/prompt-fragments/` and are opt-in per agent.
- **Tool bundles:** The existing `norwegian-registers` module already conforms to the shape we want. Formalize it as a `ToolBundle` interface and adopt it for `byggesak`'s tools too. Each agent composes a list of bundles; dispatch is `bundles.find(b => b.ownsTool(name))`.
- **Anthropic managed agents:** One managed agent per slug. Env var convention `ANTHROPIC_AGENT_ID_<UPPER_SNAKE_SLUG>`. `bun run sync-agent` iterates the registry.
- **URL structure:** `/agent/[slug]/[sessionId]`. Legacy `/agent/[sessionId]` becomes a server-side 301 that looks up the slug from `sessionOwnership`. Bare `/agent` redirects to the user's most-recent-agent; picker fallback if no history and >1 agent allowed.
- **Per-call agent resolution:** `lib/agent-manager.ts` loses its module-level `AGENT_TYPE` / `agentModule` constants. Both `createSession` and `streamWithToolHandling` take an `agentType` parameter and call `getAgent(agentType)` per invocation.
- **Scope:** Infrastructure + a stub `tiltakshaver-byggesoknad` module. Stub has placeholder persona, minimal workflow, and only the shared `norwegian-registers` bundle. Not production-quality. Gated by assigning `tiltakshaver` orgType only to test orgs for now.

## Architecture

```
Browser
  /agent                                → redirect to most-recent agent (or picker)
  /agent/[slug]                         → new-session page (slug-scoped)
  /agent/[slug]/[sessionId]             → session view (slug-scoped)
  /agent/[sessionId]                    → 301 to /agent/<looked-up-slug>/[sessionId]

Next.js API
  POST /api/session    body: { agentType, title? }
    validates agentType is in ORG_TYPE_TO_AGENT_SLUGS[caller.orgType]
    → agent-manager.createSession(agentType, clerkOrgId, clerkUserId, title?)

  POST /api/chat       body: { sessionId, message, attachments? }
    loads sessionOwnership row → agentType
    → agent-manager.streamWithToolHandling(sessionId, agentType, message, attachments)

  GET /api/session/[sessionId]
    loads sessionOwnership row → agentType
    → getAgent(agentType).getDisplayName(...) to rehydrate tool display names

lib/agent-manager.ts
  createSession(agentType, ...)
    → getAgent(agentType).createAgentConfig()
    → client.beta.sessions.create({ agent: agentEnvVarFor(agentType), ... })
    → insert sessionOwnership row with agentType
  streamWithToolHandling(sessionId, agentType, ...)
    → const agent = getAgent(agentType)   // resolved per call
    → dispatch agent.handleToolCall / agent.getDisplayName

lib/agents/registry.ts
  getAgent(slug) → AgentModule
  listAgentTypes() → string[]
  ORG_TYPE_TO_AGENT_SLUGS = {
    municipality: ['kommune-byggesak-saksbehandler'],
    tiltakshaver: ['tiltakshaver-byggesoknad'],
  }
  agentEnvVarFor(slug): string   // e.g. 'ANTHROPIC_AGENT_ID_KOMMUNE_BYGGESAK_SAKSBEHANDLER'
  allowedAgentsFor(orgType): string[]

lib/agents/compose-system-prompt.ts
  composeSystemPrompt({ persona, workflow, conventions, toolGuidance, dynamicSections })
    → single string with fixed section order and Markdown headings

lib/agents/shared/prompt-fragments/
  answer-chips.ts         → exports answerChipsFragment (the [svar: …] contract)
  findings-table.ts       → exports findingsTableFragment (🟢🟡🔴 markdown table)
  law-citations.ts        → exports lawCitationsFragment (pbl / SAK10 / TEK17 style)

lib/agents/norwegian-registers/
  index.ts                → exports ToolBundle (existing shape, formalized)
                             + promptFragment (the register-usage rules, extracted
                             from byggesak's current system prompt)

lib/agents/types.ts
  interface AgentModule   (existing, extended with optional ui metadata)
  interface ToolBundle {
    id: string
    definitions: ToolDefinition[]
    ownsTool(name: string): boolean
    handleToolCall(name, input): Promise<string>
    getDisplayName(name, input?): string | null
    promptFragment?: string
  }

lib/agents/kommune-byggesak-saksbehandler/   (renamed from byggesak/)
  agent.ts        → AgentModule
  data.ts         → DIBK data loader (unchanged)
  tools.ts        → ToolBundle (refactored from current tools.ts)
  display-names.ts (unchanged)
  persona.ts      → PERSONA constant
  workflow.ts     → WORKFLOW constant

lib/agents/tiltakshaver-byggesoknad/         (new stub)
  agent.ts        → AgentModule using shared fragments only
  persona.ts      → placeholder persona ("Du er en assistent som hjelper
                     tiltakshavere med å fylle ut byggesøknad. [STUB]")
  workflow.ts     → minimal 3-step placeholder workflow
```

### Prompt composition in practice

Every agent's `createAgentConfig` becomes short and similar in shape:

```ts
// lib/agents/kommune-byggesak-saksbehandler/agent.ts
import { composeSystemPrompt } from "@/lib/agents/compose-system-prompt";
import { answerChipsFragment } from "@/lib/agents/shared/prompt-fragments/answer-chips";
import { findingsTableFragment } from "@/lib/agents/shared/prompt-fragments/findings-table";
import { lawCitationsFragment } from "@/lib/agents/shared/prompt-fragments/law-citations";
import { norwegianRegisters } from "@/lib/agents/norwegian-registers";
import { byggesakToolBundle } from "./tools";
import { generateCompactIndex } from "./data";
import { PERSONA } from "./persona";
import { WORKFLOW } from "./workflow";

const bundles = [norwegianRegisters, byggesakToolBundle];

export const kommuneByggesakSaksbehandlerAgent: AgentModule = {
  id: "kommune-byggesak-saksbehandler",

  createAgentConfig() {
    return {
      name: "Kommune Byggesak Saksbehandler",
      model: "claude-sonnet-4-6",
      system: composeSystemPrompt({
        persona: PERSONA,
        workflow: WORKFLOW,
        conventions: [answerChipsFragment, findingsTableFragment, lawCitationsFragment],
        toolGuidance: bundles.map(b => b.promptFragment).filter(Boolean),
        dynamicSections: [{ heading: "Sjekkpunktindeks", body: generateCompactIndex() }],
      }),
      tools: [
        { type: "agent_toolset_20260401" as const },
        ...bundles.flatMap(b => b.definitions),
      ],
    };
  },

  handleToolCall(name, input) {
    const bundle = bundles.find(b => b.ownsTool(name));
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

The stub applier agent is the same shape with `bundles = [norwegianRegisters]`, a stub persona, a placeholder workflow, no dynamic sections, and `ui: { newSessionLabel: "Ny søknad", sessionGroupLabel: "Mine søknader" }`.

### `composeSystemPrompt` section order

Fixed, opinionated, non-configurable. In rendering order:

1. `persona` — required string, raw text, no heading (it's the opener).
2. `workflow` — **optional** string; when present, wrapped in `## Arbeidsflyt`. When absent or empty, slot is skipped entirely. Covers future pure-Q&A agents that have a persona but no step-by-step workflow.
3. Each fragment in `conventions[]`, rendered in order, each responsible for its own `## Heading`.
4. Each fragment in `toolGuidance[]`, rendered in order, each responsible for its own `## Heading`. **No auto-injected wrapper header.** This lets tool bundles pick semantically appropriate headings (`## Oppslag i offentlige registre` for registers, `## Verktøybruk` for byggesak checklist tools) rather than being forced under a single generic "tool usage" roof.
5. Each `dynamicSections[]` entry as `## <heading>` + `<body>`.

Invariants:
- Empty arrays are legal and skip their section entirely.
- `persona` is the only required slot. Every other slot is opt-in.
- Every fragment (both `conventions[]` and `toolGuidance[]`) owns its own `## ...` heading text — keeps headings consistent when the same fragment shows up in multiple agents, and avoids the composer making domain-semantic decisions about how to group tools.
- `conventions[]` and `toolGuidance[]` differ only semantically (conventions = shared house-style fragments, toolGuidance = fragments shipped by tool bundles). Structurally they're identical slots, rendered in order.
- `dynamicSections[]` is the only slot that takes a `{ heading, body }` pair, because its heading is typically agent-specific (e.g., "Sjekkpunktindeks" only makes sense for byggesak).
- Hardcoded `## Arbeidsflyt` heading assumes Norwegian; documented latent assumption, revisit if multilingual agents ever ship.

## UI surface changes

### Landing at `/agent`

Server component. Logic:

1. Read `userId`, `orgId`, and `org.publicMetadata.orgType` from Clerk.
2. Call `allowedAgentsFor(orgType)` → list of slugs.
3. If list is empty → existing "not entitled" path (reuse current behavior).
4. If list has one slug → redirect to `/agent/<slug>`.
5. If list has multiple → query `sessionOwnership` for the user's most recent session in this org; if found, redirect to `/agent/<that.agentType>`.
6. If multiple and no history → render a picker (simple card-per-agent using `agent.ui.newSessionLabel`).

Picker can be minimal — two `shadcn` cards linking to `/agent/<slug>`. Polish is follow-up work.

### New session at `/agent/[slug]`

Server-validates the slug is in `allowedAgentsFor(caller.orgType)`; 403 otherwise. Otherwise reuses the existing `/agent` new-session UI virtually unchanged — title defaulting, new-chat submit flow, first-attachment flow. The only new behavior is that the `POST /api/session` call now includes `agentType: slug`.

### Session view at `/agent/[slug]/[sessionId]`

Server-validates (a) the caller owns this session via `sessionOwnership` and (b) the URL's `[slug]` matches `sessionOwnership.agentType`. On mismatch → 301 to the canonical URL with the correct slug (protects against stale bookmarks if an agent is ever renamed).

### Legacy `/agent/[sessionId]` redirect

New route handler: look up `sessionOwnership.agentType`, 301 to `/agent/<agentType>/<sessionId>`. If the row doesn't exist or the caller isn't the owner, fall through to the existing 404/403 path.

### Sidebar

`agent-sidebar.tsx` changes:

1. Compute `allowedAgents = allowedAgentsFor(orgType)` in the server component that hosts the sidebar.
2. If `allowedAgents.length === 1`: render current behavior unchanged; use `agent.ui.sessionGroupLabel` for the group heading and `agent.ui.newSessionLabel` for the "Ny samtale" button.
3. If `allowedAgents.length > 1`:
   - Group sessions by `agentType` using `agent.ui.sessionGroupLabel` per group.
   - "New session" button becomes per-agent — one button per allowed agent, stacked at the top. Each button's label comes from that agent's `ui.newSessionLabel`.
   - **Active-agent visual state.** The agent whose slug matches the current URL (`/agent/[slug]/...`) gets visual emphasis in two places: its group heading is rendered with an accent (e.g. `text-foreground` vs `text-muted-foreground` for the inactive group), and its "New session" button uses `variant="default"` while the others use `variant="outline"`. This gives "I am currently in Byggesaker" signal without an explicit switcher component.
   - **Empty agent groups still render.** If the user has access to an agent but has never used it, the group heading still appears with an empty-state hint (e.g., `"Ingen dispensasjoner ennå"`). This advertises the agent's existence and reinforces that its "New session" button has somewhere to put sessions. Without this, users with access to a rarely-used agent might not realize it exists.
   - No explicit switcher component (tabs, dropdown) in v1. Revisit if the catalog grows to 4+ agents within one org type, at which point per-agent stacked buttons become visual clutter and a scoped-sidebar-with-tabs design becomes worth the complexity.

### Admin page

`app/admin/page.tsx` and `app/admin/actions.ts`:

- Dropdown options change from `municipality | business` to `municipality | tiltakshaver`. Labels stay bilingual (`Kommune` / `Tiltakshaver`).
- `actions.ts` validator (line 20): `if (orgType !== "municipality" && orgType !== "tiltakshaver")`.
- No other admin surface changes — agent assignment is derived from org type, not a separate field.

## Data model changes

### `sessionOwnership` (Drizzle schema, `lib/db/schema.ts`)

Add one column:

```ts
agentType: text("agent_type").notNull(),
```

Migration steps (one SQL migration file, generated via drizzle-kit):

1. `ALTER TABLE session_ownership ADD COLUMN agent_type TEXT;` (nullable).
2. `UPDATE session_ownership SET agent_type = 'kommune-byggesak-saksbehandler' WHERE agent_type IS NULL;`.
3. `ALTER TABLE session_ownership ALTER COLUMN agent_type SET NOT NULL;`.

Drizzle handles this cleanly via a two-step migration if needed, or a single migration with a `sql` raw block — implementation detail for the plan.

### Clerk metadata

Idempotent one-shot script `scripts/migrate-org-type-business-to-tiltakshaver.ts`:

- List all Clerk organizations.
- For each org where `publicMetadata.orgType === "business"`, update to `"tiltakshaver"`.
- Log count updated (expected: 0, per confirmed current state).
- Safe to re-run.

Runs manually, one time. Not part of the automated migration flow.

## API contracts

### `POST /api/session`

Request body:
```ts
{ agentType: string; title?: string }
```

Validation:
- `agentType` must be in `allowedAgentsFor(caller.orgType)`. 400 otherwise.
- Existing entitlement check (`requireActive()`) unchanged.

Response: unchanged shape (`{ sessionId: string }`).

### `POST /api/chat`

Request body unchanged (`{ sessionId, message, attachments? }`). Server looks up `sessionOwnership.agentType` and passes it into `streamWithToolHandling`. A missing ownership row → 404 (existing behavior).

### `GET /api/session/[sessionId]`

Unchanged request shape. Server looks up `sessionOwnership.agentType` and uses `getAgent(agentType).getDisplayName(...)` to rehydrate tool display names during session reconstruction (replaces hardcoded `getAgent("byggesak")` at line 9).

## Environment variables and `sync-agent`

Current:
```
ANTHROPIC_AGENT_ID=ag_...
ANTHROPIC_ENVIRONMENT_ID=env_...
```

After:
```
ANTHROPIC_AGENT_ID_KOMMUNE_BYGGESAK_SAKSBEHANDLER=ag_...
ANTHROPIC_AGENT_ID_TILTAKSHAVER_BYGGESOKNAD=ag_...
ANTHROPIC_ENVIRONMENT_ID=env_...                              (shared, unchanged)
```

`scripts/sync-agent.ts` changes:
- Loop over `listAgentTypes()`.
- For each slug, call `getAgent(slug).createAgentConfig()` and register via Anthropic SDK.
- Print a block at the end:
  ```
  # Copy into .env.local
  ANTHROPIC_AGENT_ID_KOMMUNE_BYGGESAK_SAKSBEHANDLER=ag_abc...
  ANTHROPIC_AGENT_ID_TILTAKSHAVER_BYGGESOKNAD=ag_def...
  ```

Helper in `lib/agents/registry.ts`:
```ts
export function agentEnvVarFor(slug: string): string {
  return `ANTHROPIC_AGENT_ID_${slug.toUpperCase().replace(/-/g, "_")}`;
}
```

`createSession` in `agent-manager.ts` uses `requireEnv(agentEnvVarFor(agentType))` in place of today's `requireEnv("ANTHROPIC_AGENT_ID")`.

## File-level summary of changes

**New files**
- `lib/agents/compose-system-prompt.ts`
- `lib/agents/shared/prompt-fragments/answer-chips.ts`
- `lib/agents/shared/prompt-fragments/findings-table.ts`
- `lib/agents/shared/prompt-fragments/law-citations.ts`

**Extended files (existing, add new exports)**
- `lib/agents/norwegian-registers/index.ts` — add a `ToolBundle` export that wraps the existing `toolDefinitions` / `handleToolCall` / `getDisplayName` / `ownsTool` surface, plus a new `promptFragment` string containing the register-usage rules currently inline in byggesak's system prompt (lines 83–106 of `lib/agents/byggesak/agent.ts`)
- `lib/agents/kommune-byggesak-saksbehandler/persona.ts`
- `lib/agents/kommune-byggesak-saksbehandler/workflow.ts`
- `lib/agents/tiltakshaver-byggesoknad/agent.ts`
- `lib/agents/tiltakshaver-byggesoknad/persona.ts`
- `lib/agents/tiltakshaver-byggesoknad/workflow.ts`
- `app/agent/[slug]/page.tsx`
- `app/agent/[slug]/[sessionId]/page.tsx`
- `scripts/migrate-org-type-business-to-tiltakshaver.ts`
- Drizzle migration file for `sessionOwnership.agentType`

**Renamed files**
- `lib/agents/byggesak/*` → `lib/agents/kommune-byggesak-saksbehandler/*`

**Modified files**
- `lib/agents/types.ts` — add `ToolBundle` interface; extend `AgentModule` with optional `ui: { newSessionLabel, sessionGroupLabel }`
- `lib/agents/registry.ts` — update map to new slug; add `ORG_TYPE_TO_AGENT_SLUGS`, `allowedAgentsFor`, `agentEnvVarFor`
- `lib/agents/kommune-byggesak-saksbehandler/agent.ts` — switch to composer + bundles; strip shared fragments out of the inline prompt
- `lib/agents/kommune-byggesak-saksbehandler/tools.ts` — conform to `ToolBundle`
- `lib/agent-manager.ts` — remove module-level `AGENT_TYPE` / `agentModule`; take `agentType` param in `createSession` and `streamWithToolHandling`; use `agentEnvVarFor` for agent ID lookup; pass `agentType` through to `sessionOwnership` insert
- `lib/db/schema.ts` — add `agentType` to `sessionOwnership`
- `lib/db/queries.ts` — update `recordSessionOwnership` signature to include `agentType`; add helper `getAgentTypeBySessionId`
- `app/api/session/route.ts` — accept and validate `agentType`; pass to `createSession`
- `app/api/session/[sessionId]/route.ts` — replace hardcoded `getAgent("byggesak")` with lookup from `sessionOwnership.agentType`
- `app/api/chat/route.ts` — look up `agentType` from `sessionOwnership`; pass to `streamWithToolHandling`
- `app/agent/page.tsx` — convert to server component that redirects to most-recent-agent / picker
- `app/agent/[sessionId]/page.tsx` — convert to a 301 redirect handler (looks up slug, redirects to `/agent/[slug]/[sessionId]`)
- `app/agent/_components/agent-sidebar.tsx` — group by `agentType` when >1 allowed; per-agent "new session" buttons; use `agent.ui` labels
- `app/admin/page.tsx` — dropdown options `municipality | tiltakshaver`
- `app/admin/actions.ts` — validator accepts `municipality | tiltakshaver`
- `scripts/sync-agent.ts` — loop over all registered agents

## Testing strategy

Existing tests should be updated in place, not duplicated:

- `lib/agents/byggesak/tools.test.ts` moves with the folder and continues to validate tool behavior.
- Auth tests (`lib/auth.test.ts`) pick up the new `orgType` values via fixture updates.
- New test `lib/agents/compose-system-prompt.test.ts` covering: empty arrays skip sections, section order, heading injection for dynamic sections, tool guidance header only appears when present.
- New test `lib/agents/registry.test.ts` covering: `allowedAgentsFor` returns correct slugs for each org type, unknown org type returns empty list, `agentEnvVarFor` produces expected env var names.
- Manual verification checklist (for the PR description):
  - Create a municipality-type org's new session → routed through `/agent/kommune-byggesak-saksbehandler/...`, tool calls work as before.
  - Create a tiltakshaver-type test org's new session → routed through `/agent/tiltakshaver-byggesoknad/...`, stub agent responds, `resolve_property` tool works via the shared Norwegian registers bundle.
  - **Per-agent tool isolation.** Inspect the registered Anthropic agent config for `tiltakshaver-byggesoknad` (via the SDK after `sync-agent`) and confirm the byggesak-specific tools (`get_checkpoints`, `get_checkpoint_detail`, `search_checkpoints`, etc.) are *not* present in its tool list. Reciprocally, confirm the kommune agent's tool list is unchanged from today.
  - Hit a legacy `/agent/[sessionId]` URL from an existing bookmark → 301s cleanly to `/agent/kommune-byggesak-saksbehandler/[sessionId]`.
  - Admin page renames work; selecting `tiltakshaver` updates Clerk metadata and DB entitlement together.
  - `sync-agent` script prints both env var lines.
  - Sidebar active-state: on a `kommune-byggesak-saksbehandler` URL in an org with access to both agents, the Byggesaker group heading and "Ny byggesak" button are visually emphasized; navigating to a tiltakshaver URL flips the emphasis.

## Risks and mitigations

- **Stale Anthropic-side system prompts.** Registering the renamed agent on Anthropic's side may require a new `ag_...` ID depending on how the SDK handles agent-name changes. If the ID changes, old sessions remain tied to the old ID until they expire naturally — this is fine, existing sessions aren't migrated. New sessions use the new ID. Verify during implementation; document in the plan.
- **Stub agent leaking to real users.** Gated by orgType assignment — only test orgs get `tiltakshaver` orgType until the real applier agent spec ships. No additional feature flag needed; the entitlement mechanism is the flag.
- **Prompt fragment extraction changes the kommune agent's behavior.** The extraction should be lossless (same text, just moved into shared files). Verify by diffing the rendered `composeSystemPrompt(...)` output against the pre-refactor `buildSystemPrompt()` output as a one-time check during implementation. The fragments should produce byte-identical text where currently inline, modulo whitespace and section ordering.
- **Per-call `getAgent()` adds overhead.** Negligible — it's a `Record` lookup. No caching needed.
- **Bare `/agent` landing edge cases.** User signs in with an org that has no entitlement yet, or belongs to multiple orgs with different types. Existing auth layer already handles the "no entitlement" case via `requireActive()`. Multi-org users switching Clerk orgs is an existing flow; the landing redirect recomputes on each load, so it follows the active org naturally.
