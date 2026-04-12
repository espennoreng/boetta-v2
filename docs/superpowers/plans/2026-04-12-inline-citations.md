# Inline Citations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show interactive inline citation hover cards when the agent references Norwegian law paragraphs, linking to Lovdata with checkpoint context.

**Architecture:** Server extracts Lovhjemmel data from existing tool results during streaming, emits a `citations` SSE event after the agent finishes. Client stores citations on the message, then a `CitationRenderer` component splits markdown at matched law references and renders `InlineCitation` hover cards from the existing ai-elements component library.

**Tech Stack:** Next.js, React, TypeScript, Streamdown, existing ai-elements components (InlineCitation, HoverCard)

**Spec:** `docs/superpowers/specs/2026-04-12-inline-citations-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `lib/citations.ts` (new) | Citation type, normalization, regex matching, extraction from tool result JSON |
| `lib/agent-manager.ts` (modify) | Collect citations during streaming, emit `citations` event before `done` |
| `hooks/use-agent-chat.ts` (modify) | Add `citations` field to `ChatMessage`, handle `citations` SSE event |
| `components/citation-renderer.tsx` (new) | Split markdown text at citation matches, render InlineCitation components |
| `components/chat-page.tsx` (modify) | Use `CitationRenderer` for assistant message text parts that have citations |

---

### Task 1: Citation types and normalization (`lib/citations.ts`)

**Files:**
- Create: `lib/citations.ts`

- [ ] **Step 1: Create the Citation type and normalization function**

```typescript
// lib/citations.ts

export interface Citation {
  lovhjemmel: string;
  url: string;
  checkpoint: string;
  description?: string;
}

/**
 * Normalize a law reference to a canonical key for matching.
 * "pbl. § 21-2 syvende ledd" -> "pbl§21-2"
 * "SAK10 § 5-4 tredje ledd" -> "sak10§5-4"
 */
export function normalizeLovhjemmel(ref: string): string {
  const lower = ref.toLowerCase();
  // Match pattern: lawId (word chars) ... § ... paragraphNumber (digits-digits)
  const match = lower.match(
    /([a-zæøå][a-zæøå0-9]*)\s*[.]*\s*§\s*(\d+[-–]\d+)/,
  );
  if (!match) return "";
  return `${match[1]}§${match[2].replace("–", "-")}`;
}
```

- [ ] **Step 2: Verify normalization handles expected variations**

Mentally trace through these cases:
- `"pbl.§ 21-2 syvende ledd"` -> match `pbl`, `21-2` -> `"pbl§21-2"`
- `"pbl. § 21-2"` -> match `pbl`, `21-2` -> `"pbl§21-2"`
- `"SAK10 § 5-4 tredje ledd bokstav b"` -> match `sak10`, `5-4` -> `"sak10§5-4"`
- `"pbl §21-2"` -> match `pbl`, `21-2` -> `"pbl§21-2"`

- [ ] **Step 3: Add the extraction function for tool results**

Append to `lib/citations.ts`:

```typescript
/**
 * Extract citations from a tool result JSON string.
 * Handles both get_checkpoint_detail (full Lovhjemmel objects)
 * and get_checkpoints (array of checkpoint summaries).
 */
export function extractCitationsFromToolResult(
  toolName: string,
  resultJson: string,
): Citation[] {
  try {
    const data = JSON.parse(resultJson);
    if (toolName === "get_checkpoint_detail" && data && !data.error) {
      return extractFromCheckpointDetail(data);
    }
    if (toolName === "get_checkpoints" && Array.isArray(data)) {
      return extractFromCheckpointsList(data);
    }
    return [];
  } catch {
    return [];
  }
}

function extractFromCheckpointDetail(cp: {
  Navn?: string;
  Beskrivelse?: string;
  Lovhjemmel?: { Lovhjemmel: string; LovhjemmelUrl?: string }[];
}): Citation[] {
  if (!cp.Lovhjemmel) return [];
  return cp.Lovhjemmel.filter((lh) => lh.Lovhjemmel && lh.LovhjemmelUrl).map(
    (lh) => ({
      lovhjemmel: lh.Lovhjemmel,
      url: lh.LovhjemmelUrl!,
      checkpoint: cp.Navn ?? "",
      description: cp.Beskrivelse,
    }),
  );
}

function extractFromCheckpointsList(
  cps: { Navn?: string; Lovhjemmel?: string[] }[],
): Citation[] {
  // get_checkpoints returns Lovhjemmel as string[] without URLs.
  // We store them with empty URL — they can be enriched later
  // if get_checkpoint_detail is called for the same reference.
  const citations: Citation[] = [];
  for (const cp of cps) {
    if (!cp.Lovhjemmel) continue;
    for (const ref of cp.Lovhjemmel) {
      if (ref) {
        citations.push({
          lovhjemmel: ref,
          url: "",
          checkpoint: cp.Navn ?? "",
        });
      }
    }
  }
  return citations;
}
```

- [ ] **Step 4: Add the text scanning function**

Append to `lib/citations.ts`:

```typescript
export interface CitationMatch {
  /** Start index in the source text */
  start: number;
  /** End index in the source text */
  end: number;
  /** The matched text as it appears in the source */
  matchedText: string;
  /** The resolved citation data */
  citation: Citation;
}

/**
 * Scan text for law references and match them against a citation registry.
 * Returns matches sorted by position in the text.
 */
export function findCitationsInText(
  text: string,
  registry: Map<string, Citation>,
): CitationMatch[] {
  if (registry.size === 0) return [];

  // Match patterns like: pbl. § 21-2, SAK10 § 5-4, tek17 §11-2
  const pattern =
    /([a-zæøåA-ZÆØÅ][a-zæøåA-ZÆØÅ0-9]*)\s*[.]*\s*§\s*(\d+[-–]\d+)/g;

  const matches: CitationMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const key = normalizeLovhjemmel(match[0]);
    const citation = registry.get(key);
    if (citation) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        matchedText: match[0],
        citation,
      });
    }
  }

  return matches;
}

/**
 * Build a citation registry from an array of citations.
 * Keyed by normalized lovhjemmel. Prefers entries with URLs.
 */
export function buildCitationRegistry(
  citations: Citation[],
): Map<string, Citation> {
  const registry = new Map<string, Citation>();
  for (const c of citations) {
    const key = normalizeLovhjemmel(c.lovhjemmel);
    if (!key) continue;
    const existing = registry.get(key);
    // Prefer entries that have URLs and descriptions
    if (!existing || (!existing.url && c.url)) {
      registry.set(key, c);
    }
  }
  return registry;
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/citations.ts
git commit -m "feat: add citation types, normalization, and matching logic"
```

---

### Task 2: Server-side citation extraction (`lib/agent-manager.ts`)

**Files:**
- Modify: `lib/agent-manager.ts:100-217`

- [ ] **Step 1: Import citation utilities**

Add import at the top of `lib/agent-manager.ts`:

```typescript
import {
  type Citation,
  extractCitationsFromToolResult,
  buildCitationRegistry,
} from "@/lib/citations";
```

- [ ] **Step 2: Add citation collection to the streaming loop**

In `streamWithToolHandling`, add a `citations` array before the `while (true)` loop (after line 119, after the `events.send` call):

```typescript
const collectedCitations: Citation[] = [];
```

- [ ] **Step 3: Extract citations from custom tool results**

In the `agent.custom_tool_use` case handler, after `const result = await agentModule.handleToolCall(...)` and before `yield { type: "tool_result", ... }`, add:

```typescript
const extracted = extractCitationsFromToolResult(customEvent.name, result);
collectedCitations.push(...extracted);
```

- [ ] **Step 4: Emit citations event before done**

In the `session.status_idle` handler, in the `else` branch (end_turn), before `yield { type: "done" }`, add:

```typescript
if (collectedCitations.length > 0) {
  const registry = buildCitationRegistry(collectedCitations);
  yield {
    type: "citations",
    citations: Array.from(registry.values()),
  };
}
```

- [ ] **Step 5: Verify the full modified function looks correct**

The modified `streamWithToolHandling` should have:
1. `collectedCitations` array initialized before the while loop
2. `extractCitationsFromToolResult` called in the `agent.custom_tool_use` case
3. `citations` event yielded before `done` in the idle handler

- [ ] **Step 6: Commit**

```bash
git add lib/agent-manager.ts
git commit -m "feat: extract citations from tool results and emit SSE event"
```

---

### Task 3: Client-side citation handling (`hooks/use-agent-chat.ts`)

**Files:**
- Modify: `hooks/use-agent-chat.ts`

- [ ] **Step 1: Import Citation type and add to ChatMessage**

Add the import at the top:

```typescript
import type { Citation } from "@/lib/citations";
```

Add `citations` to `ChatMessage` interface (after the `isThinking` field):

```typescript
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  files?: FileUIPart[];
  toolCalls?: ToolCall[];
  parts?: MessagePart[];
  isThinking?: boolean;
  citations?: Citation[];
}
```

- [ ] **Step 2: Add `citations` to the SSEEvent type**

Update the `SSEEvent` interface to include the new event type:

```typescript
interface SSEEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "citations" | "done" | "error";
  text?: string;
  id?: string;
  name?: string;
  displayName?: string;
  result?: string;
  message?: string;
  citations?: Citation[];
}
```

- [ ] **Step 3: Handle the `citations` event in the switch statement**

Add a new case before the `done` case in the event switch:

```typescript
case "citations": {
  setMessages((prev) =>
    prev.map((msg) =>
      msg.id === assistantId
        ? { ...msg, citations: event.citations }
        : msg,
    ),
  );
  break;
}
```

- [ ] **Step 4: Re-export Citation type**

Add re-export at the bottom of the file so components can import from the hook:

```typescript
export type { Citation } from "@/lib/citations";
```

- [ ] **Step 5: Commit**

```bash
git add hooks/use-agent-chat.ts
git commit -m "feat: handle citations SSE event in chat hook"
```

---

### Task 4: CitationRenderer component (`components/citation-renderer.tsx`)

**Files:**
- Create: `components/citation-renderer.tsx`

This component takes markdown text and a citations array, finds law references in the text, and renders them with `InlineCitation` hover cards while passing non-citation text through `MessageResponse`.

- [ ] **Step 1: Create the CitationRenderer component**

```typescript
// components/citation-renderer.tsx
"use client";

import { useMemo } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  InlineCitation,
  InlineCitationText,
  InlineCitationCard,
  InlineCitationCardTrigger,
  InlineCitationCardBody,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
import type { Citation } from "@/lib/citations";
import { findCitationsInText, buildCitationRegistry } from "@/lib/citations";

interface CitationRendererProps {
  children: string;
  citations: Citation[];
}

export function CitationRenderer({
  children: text,
  citations,
}: CitationRendererProps) {
  const registry = useMemo(
    () => buildCitationRegistry(citations),
    [citations],
  );

  const matches = useMemo(
    () => findCitationsInText(text, registry),
    [text, registry],
  );

  if (matches.length === 0) {
    return <MessageResponse>{text}</MessageResponse>;
  }

  // Split the text into segments: plain text and citation matches
  const segments: Array<
    | { type: "text"; content: string }
    | { type: "citation"; matchedText: string; citation: Citation }
  > = [];

  let lastEnd = 0;
  for (const match of matches) {
    if (match.start > lastEnd) {
      segments.push({ type: "text", content: text.slice(lastEnd, match.start) });
    }
    segments.push({
      type: "citation",
      matchedText: match.matchedText,
      citation: match.citation,
    });
    lastEnd = match.end;
  }
  if (lastEnd < text.length) {
    segments.push({ type: "text", content: text.slice(lastEnd) });
  }

  return (
    <MessageResponse>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return seg.content;
        }
        return (
          <InlineCitation key={i}>
            <InlineCitationText>{seg.matchedText}</InlineCitationText>
            <InlineCitationCard>
              <InlineCitationCardTrigger
                sources={seg.citation.url ? [seg.citation.url] : []}
              />
              <InlineCitationCardBody>
                <div className="p-4 space-y-2">
                  <InlineCitationSource
                    title={seg.citation.checkpoint}
                    url={seg.citation.url || undefined}
                    description={seg.citation.description}
                  />
                </div>
              </InlineCitationCardBody>
            </InlineCitationCard>
          </InlineCitation>
        );
      })}
    </MessageResponse>
  );
}
```

- [ ] **Step 2: Verify the component handles edge cases**

Verify mentally:
- No citations -> renders plain `MessageResponse`
- Text before first citation -> rendered as plain text segment
- Text after last citation -> rendered as plain text segment
- Adjacent citations -> no extra plain text segments between them

- [ ] **Step 3: Commit**

```bash
git add components/citation-renderer.tsx
git commit -m "feat: add CitationRenderer component with InlineCitation hover cards"
```

---

### Task 5: Wire CitationRenderer into chat page (`components/chat-page.tsx`)

**Files:**
- Modify: `components/chat-page.tsx`

- [ ] **Step 1: Add CitationRenderer import**

Add to the imports at the top of `components/chat-page.tsx`:

```typescript
import { CitationRenderer } from "@/components/citation-renderer";
```

- [ ] **Step 2: Update the parts-based rendering path**

In the `ChatMessageItem` function, in the `hasParts` branch where text parts are rendered (around line 312-318), replace the `MessageResponse` rendering with conditional `CitationRenderer`:

Change:

```typescript
return partText ? (
  <MessageContent key={`text-${i}`}>
    <MessageResponse>{partText}</MessageResponse>
  </MessageContent>
) : null;
```

To:

```typescript
return partText ? (
  <MessageContent key={`text-${i}`}>
    {message.citations && message.citations.length > 0 ? (
      <CitationRenderer citations={message.citations}>
        {partText}
      </CitationRenderer>
    ) : (
      <MessageResponse>{partText}</MessageResponse>
    )}
  </MessageContent>
) : null;
```

- [ ] **Step 3: Update the fallback rendering path**

In the fallback branch (around line 337-341), apply the same change:

Change:

```typescript
{cleanText && (
  <MessageContent>
    <MessageResponse>{cleanText}</MessageResponse>
  </MessageContent>
)}
```

To:

```typescript
{cleanText && (
  <MessageContent>
    {message.citations && message.citations.length > 0 ? (
      <CitationRenderer citations={message.citations}>
        {cleanText}
      </CitationRenderer>
    ) : (
      <MessageResponse>{cleanText}</MessageResponse>
    )}
  </MessageContent>
)}
```

- [ ] **Step 4: Commit**

```bash
git add components/chat-page.tsx
git commit -m "feat: wire CitationRenderer into chat message rendering"
```

---

### Task 6: Manual integration test

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open the app and send a test message**

Open `http://localhost:3000` in a browser. Send a message that triggers checkpoint tool calls, e.g.:
> "Hva er kravene for rammetillatelse for nytt boligbygg?"

- [ ] **Step 3: Verify citations appear**

After the agent responds:
1. The agent should call `get_checkpoints` and/or `get_checkpoint_detail`
2. The response text should contain law references (e.g., "pbl. § 21-2")
3. Those references should have a "lovdata.no" badge next to them
4. Hovering over the badge should show a hover card with:
   - Checkpoint name as title
   - Lovdata URL
   - Checkpoint description

- [ ] **Step 4: Verify no-citation messages still work**

Send a follow-up message that does not trigger tool calls (e.g., "Takk"). Verify:
1. Response renders as normal markdown without any citation UI
2. No console errors

- [ ] **Step 5: Commit final state if any adjustments were needed**

```bash
git add -A
git commit -m "fix: adjustments from manual citation testing"
```
