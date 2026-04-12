# Byggesak Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DIBK building permit checklist tools to the managed agent so a case worker can upload a søknad PDF and review it against the national checklist.

**Architecture:** Modular agent system — each permit domain is a self-contained module implementing `AgentModule`. A generic registry dispatches tool calls. The API route intercepts `agent.custom_tool_use` events, executes them server-side, and sends results back. Checklist data is loaded from JSON into memory.

**Tech Stack:** Next.js 16, Anthropic SDK (`@anthropic-ai/sdk`), TypeScript, Managed Agents API

**Spec:** `docs/superpowers/specs/2026-04-12-byggesak-agent-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `lib/agents/types.ts` | `AgentModule` interface and shared TypeScript types |
| `lib/agents/registry.ts` | Agent registry — maps type string → AgentModule |
| `lib/agents/shared-tools.ts` | `search_lovdata` tool definition and handler |
| `lib/agents/byggesak/data.ts` | Load and cache 8 DIBK JSON files, export query functions |
| `lib/agents/byggesak/tools.ts` | Tool handlers for 5 byggesak-specific tools |
| `lib/agents/byggesak/display-names.ts` | Tool ID → Norwegian display name map |
| `lib/agents/byggesak/agent.ts` | Byggesak AgentModule — wires config, prompt, tools, display names |
| `data/byggesak/*.json` | 8 DIBK checklist JSON files (copied from Obsidian vault) |

### Modified files

| File | Change |
|------|--------|
| `lib/agent-manager.ts` | Use registry for agent config. Add custom tool interception loop. |
| `app/api/chat/route.ts` | Handle `agent.custom_tool_use` events. Add `displayName` to SSE. |
| `hooks/use-agent-chat.ts` | Add `displayName` to `SSEEvent` type. Prefer it over `name`. |

---

### Task 1: Copy checklist data files

**Files:**
- Create: `data/byggesak/RS.json`, `data/byggesak/IG.json`, `data/byggesak/ET.json`, `data/byggesak/FA.json`, `data/byggesak/ES.json`, `data/byggesak/MB.json`, `data/byggesak/NV.json`, `data/byggesak/TA.json`

- [ ] **Step 1: Create data directory and copy JSON files**

```bash
mkdir -p data/byggesak
cp /Users/espennoreng/repo/obsidian-vault/Projects/Boetta/checklists/RS-rammetillatelse.json data/byggesak/RS.json
cp /Users/espennoreng/repo/obsidian-vault/Projects/Boetta/checklists/IG-igangsettingstillatelse.json data/byggesak/IG.json
cp /Users/espennoreng/repo/obsidian-vault/Projects/Boetta/checklists/ET-ettrinnssoknad.json data/byggesak/ET.json
cp /Users/espennoreng/repo/obsidian-vault/Projects/Boetta/checklists/FA-ferdigattest.json data/byggesak/FA.json
cp /Users/espennoreng/repo/obsidian-vault/Projects/Boetta/checklists/ES-endringssoknad.json data/byggesak/ES.json
cp /Users/espennoreng/repo/obsidian-vault/Projects/Boetta/checklists/MB-midlertidig-brukstillatelse.json data/byggesak/MB.json
cp /Users/espennoreng/repo/obsidian-vault/Projects/Boetta/checklists/NV-nabovarsel.json data/byggesak/NV.json
cp /Users/espennoreng/repo/obsidian-vault/Projects/Boetta/checklists/TA-tiltak-uten-ansvarsrett.json data/byggesak/TA.json
```

- [ ] **Step 2: Verify files**

Run: `ls -lh data/byggesak/`
Expected: 8 JSON files, total ~3MB

- [ ] **Step 3: Commit**

```bash
git add data/byggesak/
git commit -m "data: add DIBK checklist JSON files for byggesak"
```

---

### Task 2: AgentModule interface and shared types

**Files:**
- Create: `lib/agents/types.ts`

- [ ] **Step 1: Create the AgentModule interface**

```typescript
// lib/agents/types.ts

export const CHECKLIST_TYPES = ["RS", "IG", "ET", "FA", "ES", "MB", "NV", "TA"] as const;
export type ChecklistType = (typeof CHECKLIST_TYPES)[number];

export interface Checkpoint {
  SjekkId: number;
  Id: string;
  Kommunenummer: string;
  Eier: string;
  Sjekkpunkttype: string;
  Navn: string;
  NavnNynorsk?: string;
  Beskrivelse?: string;
  Tema: string;
  Lovhjemmel: { Lovhjemmel: string; LovhjemmelUrl?: string }[];
  Prosesskategori: string;
  Milepel: string;
  HarMaskinlesbarRegel: boolean;
  Regel?: string;
  Tiltakstyper: { Kode: string }[];
  Utfall: {
    Utfallverdi: boolean;
    Utfalltype: string;
    Utfalltypekode: string;
    Utfalltekst?: {
      Innholdstype?: string;
      Tittel?: string;
      Beskrivelse?: string;
      TittelNynorsk?: string;
      BeskrivelseNynorsk?: string;
    };
  }[];
  Undersjekkpunkter: Checkpoint[];
  GyldigFra?: string;
  Oppdatert?: string;
  Rekkefolge?: number;
  Metadata?: Record<string, unknown>;
}

export interface CustomToolDefinition {
  type: "custom";
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AgentModule {
  id: string;

  createAgentConfig(): {
    name: string;
    model: string;
    system: string;
    tools: (CustomToolDefinition | { type: "agent_toolset_20260401" })[];
  };

  handleToolCall(name: string, input: Record<string, unknown>): Promise<string>;

  getDisplayName(toolName: string): string | null;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit lib/agents/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/agents/types.ts
git commit -m "feat: add AgentModule interface and shared types"
```

---

### Task 3: Checklist data loader

**Files:**
- Create: `lib/agents/byggesak/data.ts`

- [ ] **Step 1: Create the data loader with query functions**

```typescript
// lib/agents/byggesak/data.ts
import { readFileSync } from "fs";
import { join } from "path";
import type { Checkpoint, ChecklistType } from "@/lib/agents/types";
import { CHECKLIST_TYPES } from "@/lib/agents/types";

let cache: Record<string, Checkpoint[]> | null = null;

function loadAll(): Record<string, Checkpoint[]> {
  if (cache) return cache;
  cache = {};
  for (const type of CHECKLIST_TYPES) {
    const filePath = join(process.cwd(), "data", "byggesak", `${type}.json`);
    const raw = readFileSync(filePath, "utf-8");
    cache[type] = JSON.parse(raw) as Checkpoint[];
  }
  return cache;
}

export function getChecklistOverview(type: ChecklistType) {
  const data = loadAll();
  const cps = data[type] ?? [];
  const temas = new Map<string, number>();
  const tiltakstyper = new Set<string>();
  for (const cp of cps) {
    temas.set(cp.Tema, (temas.get(cp.Tema) ?? 0) + 1);
    for (const tt of cp.Tiltakstyper) {
      tiltakstyper.add(tt.Kode);
    }
  }
  return {
    type,
    checkpointCount: cps.length,
    temas: Object.fromEntries(temas),
    tiltakstyperCount: tiltakstyper.size,
    tiltakstyper: [...tiltakstyper].sort(),
  };
}

export function getCheckpoints(
  type: ChecklistType,
  tiltakstype?: string,
  tema?: string,
) {
  const data = loadAll();
  let cps = data[type] ?? [];
  if (tiltakstype) {
    cps = cps.filter((cp) =>
      cp.Tiltakstyper.some((tt) => tt.Kode === tiltakstype),
    );
  }
  if (tema) {
    cps = cps.filter((cp) => cp.Tema === tema);
  }
  return cps.map((cp) => ({
    Id: cp.Id,
    Navn: cp.Navn,
    Tema: cp.Tema,
    Lovhjemmel: cp.Lovhjemmel.filter((l) => l.Lovhjemmel).map((l) => l.Lovhjemmel),
  }));
}

export function getCheckpointDetail(type: ChecklistType, checkpointId: string) {
  const data = loadAll();
  const cps = data[type] ?? [];
  return cps.find((cp) => cp.Id === checkpointId) ?? null;
}

export function evaluateRules(
  type: ChecklistType,
  answers: Record<string, boolean>,
) {
  const data = loadAll();
  const cps = data[type] ?? [];
  const triggered: { Id: string; Navn: string; Regel: string }[] = [];
  for (const cp of cps) {
    const regel = cp.Regel;
    if (!regel) continue;
    for (const cpId of Object.keys(answers)) {
      if (regel.includes(cpId)) {
        triggered.push({ Id: cp.Id, Navn: cp.Navn, Regel: regel });
        break;
      }
    }
  }
  return triggered;
}

export function searchCheckpoints(query: string, type?: ChecklistType) {
  const data = loadAll();
  const q = query.toLowerCase();
  const results: { type: string; Id: string; Navn: string; Tema: string }[] = [];
  const typesToSearch = type ? [type] : (CHECKLIST_TYPES as readonly string[]);
  for (const t of typesToSearch) {
    for (const cp of data[t] ?? []) {
      if (
        cp.Navn.toLowerCase().includes(q) ||
        (cp.Beskrivelse ?? "").toLowerCase().includes(q)
      ) {
        results.push({ type: t, Id: cp.Id, Navn: cp.Navn, Tema: cp.Tema });
      }
    }
  }
  return results;
}

export function searchLovdata(lovhjemmel: string) {
  const data = loadAll();
  const ref = lovhjemmel.toLowerCase();
  const results: { type: string; Id: string; Navn: string }[] = [];
  for (const [t, cps] of Object.entries(data)) {
    for (const cp of cps) {
      for (const lh of cp.Lovhjemmel) {
        if (lh.Lovhjemmel.toLowerCase().includes(ref)) {
          results.push({ type: t, Id: cp.Id, Navn: cp.Navn });
          break;
        }
      }
    }
  }
  return results;
}

export function generateCompactIndex(): string {
  const data = loadAll();
  const idMap = new Map<string, { types: Set<string>; tema: string; navn: string }>();
  for (const [type, cps] of Object.entries(data)) {
    for (const cp of cps) {
      const existing = idMap.get(cp.Id);
      if (existing) {
        existing.types.add(type);
      } else {
        idMap.set(cp.Id, { types: new Set([type]), tema: cp.Tema, navn: cp.Navn });
      }
    }
  }
  const lines = ["checklist_types|id|tema|name"];
  for (const [id, info] of idMap) {
    lines.push(`${[...info.types].sort().join(",")}|${id}|${info.tema}|${info.navn}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit lib/agents/byggesak/data.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/agents/byggesak/data.ts
git commit -m "feat: add byggesak checklist data loader with query functions"
```

---

### Task 4: Display names

**Files:**
- Create: `lib/agents/byggesak/display-names.ts`

- [ ] **Step 1: Create display name map**

```typescript
// lib/agents/byggesak/display-names.ts

const displayNames: Record<string, string> = {
  get_checklist_overview: "Henter sjekkliste-oversikt",
  get_checkpoints: "Henter sjekkpunkter",
  get_checkpoint_detail: "Henter detaljer for sjekkpunkt",
  evaluate_rules: "Evaluerer regler",
  search_checkpoints: "Søker i sjekkpunkter",
  search_lovdata: "Søker i lovhjemler",
};

export function getDisplayName(toolName: string): string | null {
  return displayNames[toolName] ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/agents/byggesak/display-names.ts
git commit -m "feat: add Norwegian display names for byggesak tools"
```

---

### Task 5: Shared tools

**Files:**
- Create: `lib/agents/shared-tools.ts`

- [ ] **Step 1: Create shared tool definitions and handler**

```typescript
// lib/agents/shared-tools.ts
import type { CustomToolDefinition } from "@/lib/agents/types";

export const searchLovdataToolDefinition: CustomToolDefinition = {
  type: "custom",
  name: "search_lovdata",
  description:
    "Find all checkpoints that cite a specific law paragraph. Use when discussing the legal basis for a requirement. Example: 'pbl § 21-2', 'SAK10 § 5-4', 'TEK17 § 9-6'.",
  input_schema: {
    type: "object",
    properties: {
      lovhjemmel: {
        type: "string",
        description:
          "Legal reference to search for, e.g. 'pbl § 21-2', 'SAK10 § 5-4'",
      },
    },
    required: ["lovhjemmel"],
  },
};

export const sharedToolDefinitions: CustomToolDefinition[] = [
  searchLovdataToolDefinition,
];
```

- [ ] **Step 2: Commit**

```bash
git add lib/agents/shared-tools.ts
git commit -m "feat: add shared tool definitions for cross-domain tools"
```

---

### Task 6: Byggesak tool handlers

**Files:**
- Create: `lib/agents/byggesak/tools.ts`

- [ ] **Step 1: Create tool handlers and definitions**

```typescript
// lib/agents/byggesak/tools.ts
import type { CustomToolDefinition, ChecklistType } from "@/lib/agents/types";
import { CHECKLIST_TYPES } from "@/lib/agents/types";
import {
  getChecklistOverview,
  getCheckpoints,
  getCheckpointDetail,
  evaluateRules,
  searchCheckpoints,
  searchLovdata,
} from "./data";

const checklistTypeEnum = [...CHECKLIST_TYPES];

export const byggesakToolDefinitions: CustomToolDefinition[] = [
  {
    type: "custom",
    name: "get_checklist_overview",
    description:
      "Get a summary of a checklist type — how many checkpoints, which temas (categories), and which tiltakstyper (project types) it covers. Use at the start of a review to orient.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: checklistTypeEnum,
          description: "Checklist type code",
        },
      },
      required: ["type"],
    },
  },
  {
    type: "custom",
    name: "get_checkpoints",
    description:
      "Get a filtered list of checkpoints. Returns a compact list with ID, name, tema, and legal references. Always specify type. Use tiltakstype and/or tema to narrow results — without filters a full checklist can be 130 items.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: checklistTypeEnum,
          description: "Checklist type code",
        },
        tiltakstype: {
          type: "string",
          description:
            "Project type code to filter by, e.g. 'nyttbyggboligformal', 'rivinghelebygg', 'bruksendring'",
        },
        tema: {
          type: "string",
          description:
            "Category to filter by, e.g. 'Generelt', 'Plan', 'Ansvar og gjennomføring'",
        },
      },
      required: ["type"],
    },
  },
  {
    type: "custom",
    name: "get_checkpoint_detail",
    description:
      "Get full details for a single checkpoint including sub-checkpoints (undersjekkpunkter), outcomes (utfall), conditional rules, and legal references. Use after get_checkpoints to drill into a specific item.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: checklistTypeEnum,
          description: "Checklist type code",
        },
        checkpoint_id: {
          type: "string",
          description: "The checkpoint Id, e.g. '1.1', '3.12', '17.10'",
        },
      },
      required: ["type", "checkpoint_id"],
    },
  },
  {
    type: "custom",
    name: "evaluate_rules",
    description:
      "Given a checklist type and a set of known answers (checkpoint_id: true/false), evaluate the conditional rules to determine which additional checkpoints are triggered or skipped. Use after collecting answers for checkpoints that have dependencies.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: checklistTypeEnum,
          description: "Checklist type code",
        },
        answers: {
          type: "object",
          description:
            "Map of checkpoint_id to boolean, e.g. {'3.1': true, '1.12': false}",
        },
      },
      required: ["type", "answers"],
    },
  },
  {
    type: "custom",
    name: "search_checkpoints",
    description:
      "Text search across checkpoint names and descriptions. Use for open-ended questions when you don't know the exact tema or checkpoint ID.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search text in Norwegian",
        },
        type: {
          type: "string",
          enum: checklistTypeEnum,
          description: "Optional: limit search to one checklist type",
        },
      },
      required: ["query"],
    },
  },
];

export async function handleToolCall(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "get_checklist_overview":
      return JSON.stringify(
        getChecklistOverview(input.type as ChecklistType),
      );

    case "get_checkpoints":
      return JSON.stringify(
        getCheckpoints(
          input.type as ChecklistType,
          input.tiltakstype as string | undefined,
          input.tema as string | undefined,
        ),
      );

    case "get_checkpoint_detail": {
      const detail = getCheckpointDetail(
        input.type as ChecklistType,
        input.checkpoint_id as string,
      );
      if (!detail) {
        return JSON.stringify({ error: "Checkpoint not found" });
      }
      return JSON.stringify(detail);
    }

    case "evaluate_rules":
      return JSON.stringify(
        evaluateRules(
          input.type as ChecklistType,
          input.answers as Record<string, boolean>,
        ),
      );

    case "search_checkpoints":
      return JSON.stringify(
        searchCheckpoints(
          input.query as string,
          input.type as ChecklistType | undefined,
        ),
      );

    case "search_lovdata":
      return JSON.stringify(
        searchLovdata(input.lovhjemmel as string),
      );

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit lib/agents/byggesak/tools.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/agents/byggesak/tools.ts
git commit -m "feat: add byggesak tool definitions and handlers"
```

---

### Task 7: Byggesak agent module

**Files:**
- Create: `lib/agents/byggesak/agent.ts`

- [ ] **Step 1: Create the agent module**

```typescript
// lib/agents/byggesak/agent.ts
import type { AgentModule } from "@/lib/agents/types";
import { sharedToolDefinitions } from "@/lib/agents/shared-tools";
import { byggesakToolDefinitions, handleToolCall as byggesakHandleToolCall } from "./tools";
import { getDisplayName } from "./display-names";
import { generateCompactIndex, searchLovdata } from "./data";

const SYSTEM_PROMPT = `Du er en assistent for byggesaksbehandling i norske kommuner. Du hjelper saksbehandlere med å gjennomgå innkomne byggesøknader mot DIBKs nasjonale sjekklister.

Du snakker norsk (bokmål). Du er grundig og systematisk — et oversett sjekkpunkt er verre enn en langsom gjennomgang.

## Arbeidsflyt

Når saksbehandleren laster opp en søknad:
1. Les PDF-en. Identifiser søknadstypen (RS, ET, IG, FA, ES, MB, NV, TA) og tiltakstypen.
2. Hvis du er usikker på noen av disse, spør saksbehandleren.
3. Kall get_checklist_overview for å bekrefte omfanget.
4. Kall get_checkpoints filtrert på type og tiltakstype for å hente relevante sjekkpunkter.
5. Gå gjennom sjekkpunktene tema for tema, start med Generelt.
6. For hvert sjekkpunkt, sjekk om søknaden oppfyller kravet.
7. Kall get_checkpoint_detail når du trenger undersjekkpunkter, utfall eller lovhjemler.
8. Kall evaluate_rules når sjekkpunkter har betingede avhengigheter.
9. Når du ikke kan avgjøre noe fra PDF-en, spør saksbehandleren direkte.
10. Diskuter funnene i samtalen — hva som er ok, hva som mangler, hva som trenger avklaring.

## Verktøybruk

- Bruk get_checkpoints med filtre for å holde resultatene små. Filtrer alltid på tiltakstype. Legg til tema for å snevre inn ytterligere.
- Bruk get_checkpoint_detail ett sjekkpunkt om gangen, ikke i bulk.
- Bruk search_checkpoints bare når du ikke kjenner sjekkpunkt-ID eller tema.
- Bruk evaluate_rules etter å ha samlet svar for sjekkpunkter med betingede regler.
- Bruk search_lovdata når du diskuterer det rettslige grunnlaget for et krav.

## Sjekkpunktindeks

`;

function buildSystemPrompt(): string {
  const index = generateCompactIndex();
  return SYSTEM_PROMPT + index;
}

export const byggesakAgent: AgentModule = {
  id: "byggesak",

  createAgentConfig() {
    return {
      name: "Byggesak Assistant",
      model: "claude-sonnet-4-6",
      system: buildSystemPrompt(),
      tools: [
        { type: "agent_toolset_20260401" as const },
        ...sharedToolDefinitions,
        ...byggesakToolDefinitions,
      ],
    };
  },

  async handleToolCall(name: string, input: Record<string, unknown>): Promise<string> {
    if (name === "search_lovdata") {
      return JSON.stringify(searchLovdata(input.lovhjemmel as string));
    }
    return byggesakHandleToolCall(name, input);
  },

  getDisplayName(toolName: string): string | null {
    return getDisplayName(toolName);
  },
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit lib/agents/byggesak/agent.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/agents/byggesak/agent.ts
git commit -m "feat: add byggesak agent module with system prompt and tool wiring"
```

---

### Task 8: Agent registry

**Files:**
- Create: `lib/agents/registry.ts`

- [ ] **Step 1: Create the registry**

```typescript
// lib/agents/registry.ts
import type { AgentModule } from "./types";
import { byggesakAgent } from "./byggesak/agent";

const agents: Record<string, AgentModule> = {
  byggesak: byggesakAgent,
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

- [ ] **Step 2: Commit**

```bash
git add lib/agents/registry.ts
git commit -m "feat: add agent registry"
```

---

### Task 9: Update agent-manager to use registry

**Files:**
- Modify: `lib/agent-manager.ts`

This is the biggest change. The agent-manager needs to:
1. Use the registry to get agent config instead of hardcoded values
2. Expose a way to handle the custom tool loop

- [ ] **Step 1: Rewrite agent-manager.ts**

Replace the entire contents of `lib/agent-manager.ts` with:

```typescript
// lib/agent-manager.ts
import Anthropic from "@anthropic-ai/sdk";
import type { FileUIPart } from "ai";
import { getAgent } from "@/lib/agents/registry";

const client = new Anthropic();

const AGENT_TYPE = "byggesak";

let cachedAgentId: string | null = null;
let cachedEnvironmentId: string | null = null;

const agentModule = getAgent(AGENT_TYPE);

export async function getAgentId(): Promise<string> {
  if (cachedAgentId) return cachedAgentId;

  const config = agentModule.createAgentConfig();

  const agent = await client.beta.agents.create({
    name: config.name,
    model: config.model,
    system: config.system,
    tools: config.tools as Parameters<typeof client.beta.agents.create>[0]["tools"],
  });

  cachedAgentId = agent.id;
  return cachedAgentId;
}

export async function getEnvironmentId(): Promise<string> {
  if (cachedEnvironmentId) return cachedEnvironmentId;

  const environment = await client.beta.environments.create({
    name: `${AGENT_TYPE}-env-${Date.now()}`,
    config: {
      type: "cloud",
      networking: { type: "unrestricted" },
    },
  });

  cachedEnvironmentId = environment.id;
  return cachedEnvironmentId;
}

export async function createSession(): Promise<string> {
  const [agentId, environmentId] = await Promise.all([
    getAgentId(),
    getEnvironmentId(),
  ]);

  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
  });

  return session.id;
}

function buildContentBlocks(text: string, files: FileUIPart[]) {
  const content: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }
    | {
        type: "document";
        source: { type: "base64"; media_type: string; data: string };
        title?: string;
      }
  > = [];

  for (const file of files) {
    const match = file.url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) continue;

    const [, mediaType, data] = match;

    if (mediaType.startsWith("image/")) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      });
    } else {
      content.push({
        type: "document",
        source: { type: "base64", media_type: mediaType, data },
        ...(file.filename ? { title: file.filename } : {}),
      });
    }
  }

  if (text) {
    content.push({ type: "text", text });
  }

  return content;
}

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

export async function* streamWithToolHandling(
  sessionId: string,
  text: string,
  files: FileUIPart[] = [],
): AsyncGenerator<StreamEvent> {
  const stream = await client.beta.sessions.events.stream(sessionId);

  const content = buildContentBlocks(text, files);

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: "user.message",
        content,
      },
    ],
  });

  for await (const event of stream) {
    switch (event.type) {
      case "agent.message": {
        const msgText = (event as { content: { type: string; text: string }[] }).content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        if (msgText) {
          yield { type: "text", text: msgText };
        }
        break;
      }

      case "agent.thinking": {
        yield { type: "thinking" };
        break;
      }

      case "agent.tool_use": {
        const toolEvent = event as { id: string; name: string; input: Record<string, unknown> };
        const displayName = agentModule.getDisplayName(toolEvent.name);
        yield {
          type: "tool_use",
          id: toolEvent.id,
          name: toolEvent.name,
          ...(displayName ? { displayName } : {}),
        };
        break;
      }

      case "agent.custom_tool_use": {
        const customEvent = event as { id: string; name: string; input: Record<string, unknown> };
        const displayName = agentModule.getDisplayName(customEvent.name);

        yield {
          type: "tool_use",
          id: customEvent.id,
          name: customEvent.name,
          ...(displayName ? { displayName } : {}),
        };

        const result = await agentModule.handleToolCall(
          customEvent.name,
          customEvent.input,
        );

        await client.beta.sessions.events.send(sessionId, {
          events: [
            {
              type: "user.custom_tool_result",
              tool_use_id: customEvent.id,
              content: [{ type: "text", text: result }],
            },
          ],
        });

        yield { type: "tool_result", id: customEvent.id };
        break;
      }

      case "agent.tool_result": {
        const resultEvent = event as { tool_use_id: string };
        yield { type: "tool_result", id: resultEvent.tool_use_id };
        break;
      }

      case "session.status_idle": {
        yield { type: "done" };
        return;
      }
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit lib/agent-manager.ts`
Expected: No errors (there may be type warnings from the Anthropic SDK beta types — these are acceptable)

- [ ] **Step 3: Commit**

```bash
git add lib/agent-manager.ts
git commit -m "feat: update agent-manager to use registry and handle custom tools"
```

---

### Task 10: Update API route

**Files:**
- Modify: `app/api/chat/route.ts`

The route switches from manually iterating the raw SDK stream to consuming the `streamWithToolHandling` generator.

- [ ] **Step 1: Rewrite route.ts**

Replace the entire contents of `app/api/chat/route.ts` with:

```typescript
// app/api/chat/route.ts
import { createSession, streamWithToolHandling } from "@/lib/agent-manager";
import type { FileUIPart } from "ai";

export async function POST(request: Request) {
  const { message, sessionId: existingSessionId, files } =
    (await request.json()) as {
      message: string;
      sessionId?: string;
      files?: FileUIPart[];
    };

  const sessionId = existingSessionId ?? (await createSession());

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of streamWithToolHandling(
          sessionId,
          message,
          files ?? [],
        )) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );

          if (event.type === "done") {
            break;
          }
        }
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Session-Id": sessionId,
    },
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit app/api/chat/route.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: update API route to use streamWithToolHandling generator"
```

---

### Task 11: Update client hook for displayName

**Files:**
- Modify: `hooks/use-agent-chat.ts`

Two small changes: add `displayName` to the `SSEEvent` type, and prefer it when creating tool call entries.

- [ ] **Step 1: Add displayName to SSEEvent type**

In `hooks/use-agent-chat.ts`, find:

```typescript
interface SSEEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "done" | "error";
  text?: string;
  id?: string;
  name?: string;
  message?: string;
}
```

Replace with:

```typescript
interface SSEEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "done" | "error";
  text?: string;
  id?: string;
  name?: string;
  displayName?: string;
  message?: string;
}
```

- [ ] **Step 2: Use displayName in tool_use handler**

In the same file, find the `tool_use` case:

```typescript
            case "tool_use": {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        isThinking: false,
                        toolCalls: [
                          ...(msg.toolCalls ?? []),
                          {
                            id: event.id!,
                            name: event.name!,
                            state: "running" as const,
                          },
                        ],
                      }
                    : msg,
                ),
              );
              break;
            }
```

Replace with:

```typescript
            case "tool_use": {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        isThinking: false,
                        toolCalls: [
                          ...(msg.toolCalls ?? []),
                          {
                            id: event.id!,
                            name: event.displayName ?? event.name!,
                            state: "running" as const,
                          },
                        ],
                      }
                    : msg,
                ),
              );
              break;
            }
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit hooks/use-agent-chat.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add hooks/use-agent-chat.ts
git commit -m "feat: use displayName for custom tool calls in chat hook"
```

---

### Task 12: Smoke test

**Files:** None — manual verification

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Expected: Server starts without errors on http://localhost:3000

- [ ] **Step 2: Verify agent creation**

Open http://localhost:3000 and send a message: "Hei, hva kan du hjelpe meg med?"

Expected:
- Agent creates successfully (no errors in terminal)
- Agent responds in Norwegian mentioning building permit review

- [ ] **Step 3: Test with a simple tool call**

Send: "Vis meg en oversikt over sjekklisten for rammesøknad"

Expected:
- Tool card appears with display name "Henter sjekkliste-oversikt"
- Tool transitions from running to completed
- Agent describes the RS checklist contents

- [ ] **Step 4: Test filtered query**

Send: "Hent sjekkpunkter for nytt boligbygg under tema Generelt"

Expected:
- Tool card "Henter sjekkpunkter" appears
- Agent lists the relevant checkpoints for `nyttbyggboligformal` + `Generelt`

- [ ] **Step 5: Test checkpoint detail**

Send: "Vis meg detaljer for sjekkpunkt 1.12"

Expected:
- Tool card "Henter detaljer for sjekkpunkt" appears
- Agent shows dispensation requirements with sub-checkpoints and legal references

- [ ] **Step 6: Commit final state**

```bash
git add -A
git commit -m "feat: byggesak agent with custom checklist tools"
```
