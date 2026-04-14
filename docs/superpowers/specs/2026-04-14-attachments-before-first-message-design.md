---
name: Attachments before first message
description: Let users attach files (and submit attachment-only turns) before they have sent any text in a new chat, by lazily creating the session on first file pick.
---

# Attachments before first message

## Goal

Allow a user landing on `/agent` (empty chat) to attach files — and to submit a turn consisting of attachments only — without first having to send a text message and wait for a reply.

## Motivation

Today the attach button is disabled until a session exists, and a session is only created by the first `POST /api/chat`. To start a conversation with a PDF, the user must: type something, send, wait for the assistant's first reply, then attach and send again. The natural flow is the opposite — drop a file in, optionally add a question, send.

## Non-goals

- Not decoupling uploads from sessions. Attachments remain keyed to a session in R2 and in the DB.
- Not cleaning up orphaned empty sessions. A user who creates a session by attaching and then navigates away leaves a titled-placeholder session in their sidebar; acceptable for v1.
- Not changing how attachments are sent to the agent (they remain inline `image`/`document` content blocks on `user.message`).

## Decisions

- **Lazy session creation, not eager.** A session is minted the first time the user picks or drops a file — not on page load. Page-load creation would produce an empty session every time someone browsed to `/agent`; lazy creation only produces one when the user takes a concrete action.
- **New dedicated endpoint `POST /api/session`.** Reuses `createSession()` from `lib/agent-manager.ts`. Separating session creation from `/api/chat` lets the client obtain a sessionId before it has a message to send.
- **Single in-flight guarantee.** `ensureSession()` caches the in-flight `Promise<string>` on a ref so three simultaneous drops create exactly one session.
- **Empty-text submit is valid.** `buildContentBlocksFromAttachments` already omits the text block when `text` is empty (`lib/attachments.ts:48`), and Managed Agents accepts a `user.message` whose content is image/document blocks only. No sentinel text is needed.
- **Attach button no longer advertises the old workflow.** The "send a text first" tooltip is removed; the paperclip is always active.

## Architecture

### New endpoint

`POST /api/session` — authenticated via `requireActive()`. Body: none. Response: `{ sessionId: string }`. Internally calls `createSession({ clerkOrgId, clerkUserId })` and logs a `session.created` audit event. No title argument; title is set later from the first exchange, same as today.

### Client: `ensureSession()` helper

Added to `useAgentChat` and returned alongside `sendMessage` / `stopMessage`. It reuses the hook's existing `sessionIdRef` and `setSessionId`, plus a new `pendingSessionRef: useRef<Promise<string> | null>` for single-flight. Behavior:

```
ensureSession(): Promise<string>
  if sessionIdRef.current → return it
  if pendingSessionPromise → return it
  pendingSessionPromise = fetch("/api/session", { method: "POST" }).then(parse)
    on success: set ref + state, replaceState to /agent/{id}, call onSessionCreated
    on error: clear pendingSessionPromise, rethrow
  return pendingSessionPromise
```

### UI wiring in `components/chat-page.tsx`

- `AttachFilesButton` — always enabled. `onClick` becomes `async () => { await ensureSession(); attachments.openFileDialog(); }`. Delete the `noSession` branch and tooltip.
- `PromptInput` — new prop `ensureSessionId?: () => Promise<string>`. When `sessionId` is absent and a file is picked or dropped, the component awaits `ensureSessionId()` before invoking `uploadAttachment`. The hard error at `components/ai-elements/prompt-input.tsx:854` is replaced with this call; the error is only thrown if `ensureSessionId` is also absent.
- `ChatPage` passes both `sessionId={sessionId ?? undefined}` and `ensureSessionId={ensureSession}` to `PromptInput`.
- Submit-button gating — allow submit when `text.trim().length > 0 || attachments.files.length > 0`. Today the submit button disables on empty text; update the disabled logic in `PromptInputSubmit` (or its parent) to also consider attachment count.
- `ChatPage`'s `onSubmit` already handles the combined case correctly; no change.

### Server: `/api/chat` validation

Relax the implicit "message is required" assumption. Add:

```
if (!message && attachmentIds.length === 0) → 400 "message or attachments required"
```

No other server change. Title generation at `app/api/chat/route.ts:128` already gates on `assistantText.trim().length > 0`, so an attachment-only turn still gets titled from the assistant's reply (or from a resolved property address).

## Data flow (new-session, attachment-only turn)

1. User on `/agent` (no session). Clicks paperclip.
2. `ensureSession()` → `POST /api/session` → `{ sessionId }`. Ref + state + URL updated. Sidebar gets a placeholder entry.
3. File dialog opens. User picks a PDF.
4. `PromptInput` calls `uploadAttachment({ file, sessionId })` which presigns and PUTs to R2 as today.
5. Attachment chip appears in the input.
6. User clicks Send (text empty). `sendMessage("", [id], [name])`.
7. `POST /api/chat` with `{ message: "", sessionId, attachmentIds: [id] }`. Server resolves the attachment, calls `streamWithToolHandling(sessionId, "", resolved)`. `buildContentBlocksFromAttachments` emits `[document]` only. Managed Agents accepts it.
8. Stream flows back normally. Session title set after the assistant replies.

## Edge cases

- **Two files picked simultaneously** → both share the same in-flight `ensureSession()` promise; one `/api/session` call.
- **`/api/session` fails** (network / auth) → attach button's `onClick` surface-rejects; toast or console error. File dialog does not open. Ref stays null; next click retries.
- **User drops files via `globalDrop` before clicking attach** → same `ensureSessionId` path inside `PromptInput`. If neither `sessionId` nor `ensureSessionId` is provided, keep the existing loud error (developer mistake).
- **Submit with text and no attachments** → unchanged from today.
- **Submit with no text and no attachments** → submit button disabled on the client; server returns 400 if it slips through.
- **User creates a session by attaching, then closes the tab** → empty session in the sidebar. Acceptable; cleanup is a separate concern.
- **Stale `anthropic_file_id` on attachment-only turn** → existing retry in `app/api/chat/route.ts:87` still applies; `resolved` is re-fetched and stream re-invoked.

## Files changed

- `app/api/session/route.ts` — **new**. `POST` handler wrapping `createSession`.
- `hooks/use-agent-chat.ts` — add `ensureSession` and return it.
- `components/chat-page.tsx` — enable `AttachFilesButton` unconditionally, pass `ensureSessionId`.
- `components/ai-elements/prompt-input.tsx` — accept `ensureSessionId` prop; await it in the upload path when `sessionId` is falsy; relax submit-disabled logic to consider attachment count.
- `app/api/chat/route.ts` — add `!message && attachmentIds.length === 0` → 400 guard.

## Testing

- Unit / integration:
  - `POST /api/session` returns a sessionId for an active user; 401 for unauthenticated; 403 for non-active membership.
  - `ensureSession` returns the same promise to concurrent callers.
- Manual:
  - Empty `/agent`, click paperclip → file dialog opens; URL replaces to `/agent/{id}`; sidebar shows placeholder.
  - Drop a PDF on empty `/agent` → same, without clicking paperclip.
  - Attach a PDF, leave text empty, click Send → assistant replies; session gets a title; attachment chip renders in the user turn.
  - Attach a PDF, type a question, click Send → both arrive in one turn.
  - Fail the network on `/api/session` (devtools) → error surfaces, nothing uploads.

## Open questions

None.
