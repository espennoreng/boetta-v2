# Byggesak Agent — Custom Tools for Building Permit Review

## Goal

Add DIBK building permit checklist tools to the managed agent so a municipal case worker can upload a søknad PDF and have the agent systematically review it against the relevant national checklist. The architecture should make it straightforward to add new permit domain agents (Arbeidstilsyn, Miljø, etc.) without touching shared code.

## Decisions

- **User:** Municipal case worker reviewing incoming building permit applications
- **Workflow:** Upload PDF → agent reads and identifies type → checks against sjekkliste → conversational review with the case worker
- **Output:** Conversational — no structured report. Case worker asks follow-ups and drills into specifics.
- **Data access:** Structured filtering on JSON in memory. No RAG, no vector store, no database.
- **Unverifiable checkpoints:** Agent asks the case worker directly. These questions become tool calls in the future (NVE, planregister, matrikkel, etc.)
- **Multi-agent from the start:** Modular agent architecture where each permit domain is a self-contained module. Adding a new domain = adding a folder, not modifying shared code.

## Architecture

```
Browser (React)
  useAgentChat hook
    POST /api/chat → SSE stream
  ai-elements components (shows tool displayNames)

Next.js API Route (/api/chat)
  Generic event loop — knows nothing about byggesak:
    agent.custom_tool_use → registry.handleToolCall() → user.custom_tool_result
    all other events → proxy to browser (with displayName from registry)

  Agent Registry (lib/agents/registry.ts)
    Maps agent type → AgentModule
    Currently: { byggesak: byggesakAgent }

  Agent Module: Byggesak (lib/agents/byggesak/)
    agent.ts       → agent config (model, system prompt, tool definitions)
    data.ts        → loads 8 DIBK JSON files, exports query functions
    tools.ts       → handleToolCall() for byggesak-specific tools
    display-names.ts → Norwegian display names

  Shared Tools (lib/agents/shared-tools.ts)
    Tool handlers reused across all domains (search_lovdata)

Managed Agents API
  agent + environment + session

Data (data/)
  byggesak/*.json  → 8 DIBK checklist files
```

## Agent Module Interface

Every agent module exports the same shape. The API route and UI are generic — they call these methods without knowing what domain they're in.

```typescript
interface AgentModule {
  // Unique identifier for this agent type
  id: string;

  // Create the Anthropic agent config (model, system prompt, tools)
  createAgentConfig(): {
    name: string;
    model: string;
    system: string;
    tools: ToolDefinition[];
  };

  // Handle a custom tool call — dispatch to the right handler
  handleToolCall(name: string, input: Record<string, unknown>): Promise<string>;

  // Map tool ID → display name for the UI (returns null for unknown tools)
  getDisplayName(toolName: string): string | null;
}
```

## Agent Registry

```typescript
// lib/agents/registry.ts
import { byggesakAgent } from "./byggesak/agent";
// import { arbeidstilsynAgent } from "./arbeidstilsyn/agent";  ← future

export const agents: Record<string, AgentModule> = {
  byggesak: byggesakAgent,
  // arbeidstilsyn: arbeidstilsynAgent,  ← one line to add
};

export function getAgent(type: string): AgentModule {
  const agent = agents[type];
  if (!agent) throw new Error(`Unknown agent type: ${type}`);
  return agent;
}
```

## Custom Tools

### Shared tools (reused by future permit agents)

Defined in `lib/agents/shared-tools.ts`. Each agent module includes these in its tool definitions, but the handler logic is shared.

| Tool | Description | Parameters |
|------|-------------|------------|
| `search_lovdata` | Find all checkpoints citing a specific law paragraph | `lovhjemmel: string` |

### Domain tools (byggesak-specific)

Defined in `lib/agents/byggesak/tools.ts`.

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_checklist_overview` | Summary of a checklist type — checkpoint count, temas, tiltakstyper | `type: RS\|IG\|ET\|FA\|ES\|MB\|NV\|TA` |
| `get_checkpoints` | Filtered list of checkpoints. Returns compact list (ID, name, tema, legal refs) | `type` (required), `tiltakstype?`, `tema?` |
| `get_checkpoint_detail` | Full detail for one checkpoint — sub-checkpoints, outcomes, rules, legal references | `type`, `checkpoint_id` |
| `evaluate_rules` | Given known answers (checkpoint_id → boolean), evaluate conditional rules to find triggered/skipped checkpoints | `type`, `answers: object` |
| `search_checkpoints` | Text search across checkpoint names and descriptions | `query: string`, `type?` |

### Display names

Defined in `lib/agents/byggesak/display-names.ts`.

| Tool ID | Display name |
|---------|-------------|
| `get_checkpoints` | Henter sjekkpunkter |
| `get_checkpoint_detail` | Henter detaljer for sjekkpunkt |
| `evaluate_rules` | Evaluerer regler |
| `search_checkpoints` | Søker i sjekkpunkter |
| `get_checklist_overview` | Henter sjekkliste-oversikt |
| `search_lovdata` | Søker i lovhjemler |

## System Prompt

Four parts, ~5,200 tokens total. Defined in `lib/agents/byggesak/agent.ts`.

### 1. Role and behavior (~200 tokens)

You are a building permit review assistant for Norwegian municipalities. You help case workers review incoming building permit applications (byggesøknader) against DIBK's national checklists. You speak Norwegian (Bokmål). You are thorough and systematic — a missed checkpoint is worse than a slow review.

### 2. Workflow instructions (~300 tokens)

When the case worker uploads an application:
1. Read the PDF. Identify the søknadstype (RS, ET, IG, FA, ES, MB, NV, TA) and tiltakstype.
2. If uncertain about either, ask the case worker.
3. Call `get_checklist_overview` to confirm the scope.
4. Call `get_checkpoints` filtered by type and tiltakstype to get the relevant items.
5. Work through checkpoints by tema, starting with Generelt.
6. For each checkpoint, check whether the application satisfies the requirement.
7. Call `get_checkpoint_detail` when you need sub-checkpoints, outcomes, or legal references.
8. Call `evaluate_rules` when checkpoints have conditional dependencies.
9. When you cannot determine something from the PDF, ask the case worker directly.
10. Discuss findings conversationally — what passes, what's missing, what needs clarification.

### 3. Tool usage guidance (~200 tokens)

- Use `get_checkpoints` with filters to keep results small. Always filter by tiltakstype. Add tema to narrow further.
- Use `get_checkpoint_detail` one checkpoint at a time, not in bulk.
- Use `search_checkpoints` only when you don't know the checkpoint ID or tema.
- Use `evaluate_rules` after collecting answers for checkpoints that have conditional rules.
- Use `search_lovdata` when discussing the legal basis for a requirement.

### 4. Compact checkpoint index (~4,500 tokens)

Deduplicated list of all 195 checkpoint IDs. Format:

```
checklist_types|id|tema|name
RS,ET,ES,IG,FA,MB,NV,TA|1.1|Generelt|Er søknaden og all relevant dokumentasjon skrevet/oversatt til norsk, svensk eller dansk?
RS,ET,ES,IG,FA,MB,NV,TA|1.72|Generelt|Er matrikkelnummer registrert?
RS,ET,ES,NV,TA|1.12|Plan|Foreligger det søknad om dispensasjon?
...195 entries
```

Generated from the JSON data at build time or startup.

## UI Flow

The existing UI handles the review flow almost entirely as-is. Here's what the case worker sees during a review:

### Step-by-step

1. **Case worker uploads PDF + sends message** — the attachment flow already works via PromptInput + `buildContentBlocks` in agent-manager.ts. PDFs are sent as base64 document blocks.

2. **Shimmer ("Thinking...")** — shows immediately via `agent.thinking` event. Already implemented.

3. **Built-in tool cards (read)** — the agent reads the PDF using built-in tools. These show as `ToolHeader` cards with running → completed state transitions. Already implemented.

4. **Agent streams initial analysis** — identifies søknadstype and tiltakstype from the PDF. Rendered via `MessageResponse` with streaming markdown. Already implemented.

5. **Custom tool cards** — `get_checklist_overview`, `get_checkpoints`, etc. show as tool cards with Norwegian display names (e.g., "Henter sjekkpunkter") and running → completed badges. The tool execution happens server-side, invisible to the browser — the client just sees the card state change.

6. **Agent streams findings** — walks through checkpoints by tema, reports what passes, what's missing, cites legal references. All streamed markdown.

7. **Agent asks questions** — when it can't verify something from the PDF, it asks directly in the conversation. The case worker replies, the agent calls `evaluate_rules` to follow the dependency chain, and continues.

### What already works (no changes)

- Streaming markdown rendering (`MessageResponse`)
- Shimmer during thinking (`agent.thinking` events)
- Tool state badges — running/completed transitions (`ToolHeader`)
- Built-in tools (read, bash) — show as tool cards
- Multi-turn conversation — case worker replies, agent continues
- File upload via attachments (`PromptInput` + `buildContentBlocks`)

### What needs minor changes

**Display names in hook** — `use-agent-chat.ts` currently stores `event.name` (e.g., "get_checkpoints") for tool calls. Change to prefer `displayName` when present:

```typescript
case "tool_use": {
  // Use displayName from SSE event, fall back to raw name
  { id: event.id, name: event.displayName ?? event.name, state: "running" }
}
```

The `ToolHeader` component already renders whatever `name` it receives — no component changes needed. The `SSEEvent` type in the hook gains one optional field (`displayName?: string`).

`page.tsx` needs no changes.

## API Route Changes

### Current behavior

```
Agent event → proxy to browser → done
```

### New behavior

The route is generic — it uses the agent registry, not byggesak-specific code.

```
Agent event → is it agent.custom_tool_use?
  No  → proxy to browser (add displayName via registry.getDisplayName())
  Yes → execute registry.handleToolCall(name, input)
       → send user.custom_tool_result back to managed agent
       → proxy tool_use and tool_result events to browser (with displayName)
       → continue streaming
```

### SSE events to browser

Tool use events gain a `displayName` field:

```json
{ "type": "tool_use", "id": "...", "name": "get_checkpoints", "displayName": "Henter sjekkpunkter" }
```

Client uses `displayName` if present, falls back to `name`.

## File Changes

### New files

| File | Purpose |
|------|---------|
| `lib/agents/registry.ts` | Agent registry — maps type → AgentModule, generic dispatch |
| `lib/agents/shared-tools.ts` | Shared tool handlers (search_lovdata) and shared tool definitions |
| `lib/agents/byggesak/agent.ts` | Byggesak AgentModule — config, system prompt, tool list |
| `lib/agents/byggesak/data.ts` | Load and cache 8 DIBK JSON files, export query functions |
| `lib/agents/byggesak/tools.ts` | Tool handlers for byggesak-specific tools |
| `lib/agents/byggesak/display-names.ts` | Display name map |
| `data/byggesak/*.json` | 8 DIBK checklist JSON files |

### Modified files

| File | Change |
|------|--------|
| `lib/agent-manager.ts` | Use registry to get agent config. Change stream handling to intercept custom tool calls via registry. |
| `app/api/chat/route.ts` | Pass registry-based tool handler into event loop. Forward displayName in tool_use events. |
| `hooks/use-agent-chat.ts` | Read `displayName` from tool_use events. |
| `app/page.tsx` | Show `displayName` in ToolHeader. |

## Data

- 8 JSON files, 3MB total, loaded into memory at server startup
- 571 checkpoints across 8 checklist types
- 195 unique checkpoint IDs (70% shared across types)
- 18 tema categories
- 59 tiltakstyper
- 176 unique legal references
- Single checkpoint: median 783 tokens, max 8,686 tokens
- Filtered result set (type + tiltakstype): typically 20-40 checkpoints at 3-5K tokens

## Adding a New Permit Domain

To add a new agent (e.g., Arbeidstilsyn):

1. Create `lib/agents/arbeidstilsyn/` with 4 files implementing `AgentModule`:
   - `agent.ts` — config, system prompt, tool definitions
   - `data.ts` — load domain-specific data
   - `tools.ts` — domain tool handlers
   - `display-names.ts` — Norwegian display names
2. Add data files to `data/arbeidstilsyn/`
3. Add one line to `lib/agents/registry.ts`
4. Done — API route, hook, and UI work automatically

**No shared code is modified.** The registry, API route, hook, and UI components are generic.

## When Sub-Agents Become Available

1. Create an orchestrator agent that routes to domain specialists
2. Move shared tools to the orchestrator or a common sub-agent
3. Each domain agent keeps its own tools
4. The `AgentModule` interface, tool handlers, and data layer don't change

## Out of Scope

- Structured report export
- NVE/planregister/matrikkel tool integrations (future tools)
- Multi-agent orchestration (waiting for sub-agent support)
- Agent routing logic (for now, hardcoded to byggesak — routing added when second agent exists)
- Session persistence across page loads
- Authentication / multi-user support
