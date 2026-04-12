# Inline Citations for Legal References

## Overview

Show inline citation hover cards when the agent references Norwegian law paragraphs (e.g., "pbl. § 21-2"). Citations are extracted from existing tool results — no new tools or agent prompt changes needed. On hover, users see the checkpoint name, description, and a clickable Lovdata link.

## Data Flow

### Server: Citation extraction (`agent-manager.ts`)

During streaming, when processing `agent.custom_tool_use` results for `get_checkpoint_detail` and `get_checkpoints`, extract `Lovhjemmel` entries from the JSON response.

Each citation contains:
- `lovhjemmel`: The reference string (e.g., "pbl.§ 21-2 syvende ledd")
- `url`: Lovdata URL (e.g., "https://lovdata.no/lov/2008-06-27-71/§21-2")
- `checkpoint`: Checkpoint name (`Navn`)
- `description`: Checkpoint description (`Beskrivelse`)

Store in a `Map<string, Citation>` keyed by normalized reference (see Matching section). Merge across tool calls — prefer entries that have URLs. After the agent finishes (`session.status_idle` with `end_turn`), emit a `citations` SSE event with the collected array.

SSE format:
```
data: {"type":"citations","citations":[{"lovhjemmel":"pbl.§ 21-2 syvende ledd","url":"https://lovdata.no/lov/2008-06-27-71/§21-2","checkpoint":"Er søknaden skrevet på norsk...","description":"Søknader fra Fellestjenester..."}]}
```

### Client: Citation storage (`use-agent-chat.ts`)

Add `citations?: Citation[]` to the `ChatMessage` interface. Handle the `citations` SSE event by attaching the array to the current assistant message.

```typescript
interface Citation {
  lovhjemmel: string;
  url: string;
  checkpoint: string;
  description?: string;
}
```

### Client: Rendering (`chat-page.tsx`)

A `CitationRenderer` component replaces `MessageResponse` for assistant messages that have citations. It splits the raw markdown text at citation match points and renders alternating segments:
- Plain text segments pass through `MessageResponse` (Streamdown)
- Matched law references render as `InlineCitation` components with hover cards

## Citation Matching

### Normalization

Both registry keys and text matches go through the same normalizer:

1. Lowercase the input
2. Strip all whitespace, dots, and extra punctuation around `§`
3. Extract canonical key: `{lawId}§{paragraphNumber}` (e.g., `pbl§21-2`)

This handles variations like "pbl. § 21-2", "pbl.§ 21-2", "pbl §21-2" all normalizing to `pbl§21-2`.

### Text scanning

A regex scans the message text for law reference patterns:
```
/(pbl|sak10|tek17|tek10|bek|fvl|forvaltningsloven)[\s.]*§\s*(\d+[-–]\d+)/gi
```

The law identifier list is derived from the collected citation registry at runtime — any `lawId` that appears in the registry gets added to the pattern. The hardcoded list above covers the most common identifiers as a baseline.

Each match is normalized and looked up in the citation registry. Only references with a registry match get citation treatment.

### Extraction from tool results

Two tools produce Lovhjemmel data:
- `get_checkpoint_detail`: Returns full `Lovhjemmel: { Lovhjemmel, LovhjemmelUrl }[]` plus `Navn` and `Beskrivelse`
- `get_checkpoints`: Returns `Lovhjemmel: string[]` (reference text only, no URLs)

Both feed into the registry. Entries from `get_checkpoint_detail` are preferred since they include URLs and context.

## Hover Card Content

Each `InlineCitation` hover card displays:
- **Title**: Checkpoint name (`Navn`)
- **URL**: Lovdata link, shown as truncated hostname ("lovdata.no")
- **Description**: Checkpoint description (`Beskrivelse`) — context for what the law requires

Uses existing components: `InlineCitationCard`, `InlineCitationCardTrigger`, `InlineCitationSource`, `InlineCitationCardBody`. No carousel — one citation per reference.

Inline appearance: matched text gets subtle highlight on hover (`InlineCitationText`), with a small "lovdata.no" badge (`InlineCitationCardTrigger`).

## Edge Cases

### Streaming
Citations arrive as a single event after the agent finishes. During streaming, text renders without hover cards. Once `citations` arrives, the message re-renders with interactive references.

### Multiple checkpoints citing the same law
First checkpoint's data wins. The Lovdata URL is the same regardless of which checkpoint references it.

### No citations collected
When the agent responds without calling checkpoint tools, `citations` is empty/absent. `CitationRenderer` falls back to plain `MessageResponse`.

### Markdown integrity
Law references in this domain appear as standalone text, not inside markdown formatting constructs. Text splitting at match points should not break markdown structure.

### Unmatched references
Law references the agent mentions without corresponding tool result data get no hover card — they render as plain text. No URL guessing.

## Files Changed

| File | Change |
|------|--------|
| `lib/agent-manager.ts` | Extract citations from tool results, emit `citations` SSE event |
| `hooks/use-agent-chat.ts` | Add `Citation` type, `citations` field on `ChatMessage`, handle `citations` event |
| `components/chat-page.tsx` | Add `CitationRenderer` component, use it for assistant messages with citations |
| `lib/citations.ts` (new) | Normalization function, regex scanner, citation matching logic |
