# Byggesak Agent — Custom Tools for Building Permit Review

## Goal

Add DIBK building permit checklist tools to the managed agent so a municipal case worker can upload a søknad PDF and have the agent systematically review it against the relevant national checklist.

## Decisions

- **User:** Municipal case worker reviewing incoming building permit applications
- **Workflow:** Upload PDF → agent reads and identifies type → checks against sjekkliste → conversational review with the case worker
- **Output:** Conversational — no structured report. Case worker asks follow-ups and drills into specifics.
- **Data access:** Structured filtering on JSON in memory. No RAG, no vector store, no database.
- **Unverifiable checkpoints:** Agent asks the case worker directly. These questions become tool calls in the future (NVE, planregister, matrikkel, etc.)
- **Multi-agent future:** Each permit domain gets its own agent. Shared tools are duplicated in definitions but backed by shared server-side logic. Domain tools are agent-specific.

## Architecture

```
Browser (React)
  useAgentChat hook
    POST /api/chat → SSE stream
  ai-elements components (shows tool displayNames)

Next.js API Route (/api/chat)
  Event loop with custom tool interception:
    agent.custom_tool_use → handleToolCall() → user.custom_tool_result
    all other events → proxy to browser

  AgentManager (lib/agent-manager.ts)
    Byggesak agent with 6 custom tools + agent_toolset
    System prompt with compact checkpoint index

  ChecklistTools (lib/checklist-tools.ts)
    handleToolCall(name, input) → JSON result
    Display name map for UI

  ChecklistData (lib/checklist-data.ts)
    Loads 8 JSON files into memory at startup
    Query functions: filter, search, detail lookup

Managed Agents API
  agent + environment + session
```

## Custom Tools

### Shared tools (reused by future permit agents)

| Tool | Description | Parameters |
|------|-------------|------------|
| `search_lovdata` | Find all checkpoints citing a specific law paragraph | `lovhjemmel: string` |

### Domain tools (byggesak-specific)

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_checklist_overview` | Summary of a checklist type — checkpoint count, temas, tiltakstyper | `type: RS\|IG\|ET\|FA\|ES\|MB\|NV\|TA` |
| `get_checkpoints` | Filtered list of checkpoints. Returns compact list (ID, name, tema, legal refs) | `type` (required), `tiltakstype?`, `tema?` |
| `get_checkpoint_detail` | Full detail for one checkpoint — sub-checkpoints, outcomes, rules, legal references | `type`, `checkpoint_id` |
| `evaluate_rules` | Given known answers (checkpoint_id → boolean), evaluate conditional rules to find triggered/skipped checkpoints | `type`, `answers: object` |
| `search_checkpoints` | Text search across checkpoint names and descriptions | `query: string`, `type?` |

### Display names

| Tool ID | Display name |
|---------|-------------|
| `get_checkpoints` | Henter sjekkpunkter |
| `get_checkpoint_detail` | Henter detaljer for sjekkpunkt |
| `evaluate_rules` | Evaluerer regler |
| `search_checkpoints` | Søker i sjekkpunkter |
| `get_checklist_overview` | Henter sjekkliste-oversikt |
| `search_lovdata` | Søker i lovhjemler |

## System Prompt

Four parts, ~5,200 tokens total:

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

## API Route Changes

### Current behavior

```
Agent event → proxy to browser → done
```

### New behavior

```
Agent event → is it agent.custom_tool_use?
  No  → proxy to browser (add displayName for tool_use events)
  Yes → execute handleToolCall(name, input)
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
| `lib/checklist-tools.ts` | `handleToolCall(name, input)` dispatch + display name map |
| `lib/checklist-data.ts` | Load and cache 8 JSON files, export query functions |
| `data/checklists/*.json` | 8 DIBK checklist JSON files |

### Modified files

| File | Change |
|------|--------|
| `lib/agent-manager.ts` | Add 6 custom tool definitions. Update system prompt. Change stream handling to intercept custom tool calls. |
| `app/api/chat/route.ts` | Integrate custom tool handler into event loop. Add displayName to tool_use SSE events. |
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

## Multi-Agent Future

When adding new permit domains:

1. Create a new agent with shared tools (`search_lovdata`) + domain-specific tools
2. Add domain data files and a new data loader
3. Add tool handlers to `checklist-tools.ts` (or a new `{domain}-tools.ts`)
4. Add routing logic in the app to select the right agent

When sub-agents become available:

1. Create an orchestrator agent that routes to domain specialists
2. Move shared tools to the orchestrator or a common sub-agent
3. Each domain agent keeps its own tools
4. The `handleToolCall` function and data layer don't change

## Out of Scope

- Structured report export
- NVE/planregister/matrikkel tool integrations (future tools)
- Multi-agent orchestration (waiting for sub-agent support)
- Session persistence across page loads
- Authentication / multi-user support
