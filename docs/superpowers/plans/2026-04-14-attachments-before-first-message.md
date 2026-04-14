# Attachments before first message — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach files (and submit attachment-only turns) before sending any text, by lazily creating the agent session on the first file pick or drop.

**Architecture:** A new `POST /api/session` endpoint exposes `createSession()` from `lib/agent-manager.ts`. The chat page's `useAgentChat` hook gains an `ensureSession()` helper (single-flight) that calls this endpoint when no session exists yet. The paperclip button and `PromptInput`'s drag-drop path await `ensureSessionId()` before uploading to R2. `/api/chat` is relaxed to accept an empty `message` as long as at least one attachment is present; `buildContentBlocksFromAttachments` already handles empty-text correctly.

**Tech Stack:** Next.js App Router, TypeScript, React, Clerk auth, `@anthropic-ai/sdk` Managed Agents beta, R2 presigned uploads, Drizzle/Neon. Verification is manual in a browser — the codebase has no existing automated test suite, so this plan does not introduce one.

Related spec: `docs/superpowers/specs/2026-04-14-attachments-before-first-message-design.md`.

---

## Task 1: Add `POST /api/session` endpoint

**Files:**
- Create: `app/api/session/route.ts`

- [ ] **Step 1: Create the route handler**

Write this file verbatim:

```ts
import { createSession } from "@/lib/agent-manager";
import { requireActive, type CurrentContext } from "@/lib/auth";
import { makeAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const audit = makeAudit(db);

export async function POST() {
  let ctx: CurrentContext;
  try {
    ctx = await requireActive();
  } catch (err) {
    const status = err instanceof Error && err.name === "NotActiveError" ? 403 : 401;
    return Response.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status },
    );
  }

  const sessionId = await createSession({
    clerkOrgId: ctx.orgId,
    clerkUserId: ctx.userId,
  });

  await audit.logEvent({
    actorUserId: ctx.userId,
    actorOrgId: ctx.orgId,
    event: "session.created",
    subjectType: "session",
    subjectId: sessionId,
  });

  return Response.json({ sessionId });
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `bun run lint`
Expected: no errors in `app/api/session/route.ts`.

- [ ] **Step 4: Smoke-test with the dev server**

Run: `bun run dev` (in a second terminal).

Open `http://localhost:3000/agent` in a logged-in browser, then in devtools console:

```js
await fetch("/api/session", { method: "POST" }).then(r => r.json())
```

Expected: `{ sessionId: "ses_..." }`. A new row appears in `session_ownership` (check via `bun run db:studio` if desired).

- [ ] **Step 5: Commit**

```bash
git add app/api/session/route.ts
git commit -m "feat(api): add POST /api/session for lazy session creation"
```

---

## Task 2: Add `ensureSession()` to `useAgentChat`

**Files:**
- Modify: `hooks/use-agent-chat.ts`

- [ ] **Step 1: Add a `pendingSessionRef` and the `ensureSession` callback**

Inside `useAgentChat`, after the existing `abortControllerRef`, add:

```ts
const pendingSessionRef = useRef<Promise<string> | null>(null);

const ensureSession = useCallback(async (): Promise<string> => {
  if (sessionIdRef.current) return sessionIdRef.current;
  if (pendingSessionRef.current) return pendingSessionRef.current;

  const promise = (async () => {
    const res = await fetch("/api/session", { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Failed to create session (${res.status})`);
    }
    const { sessionId: newSessionId } = (await res.json()) as { sessionId: string };
    sessionIdRef.current = newSessionId;
    setSessionId(newSessionId);
    if (
      typeof window !== "undefined" &&
      !window.location.pathname.includes(newSessionId)
    ) {
      window.history.replaceState(null, "", `/agent/${newSessionId}`);
    }
    options.onSessionCreated?.(newSessionId);
    return newSessionId;
  })();

  pendingSessionRef.current = promise;
  try {
    return await promise;
  } catch (err) {
    pendingSessionRef.current = null;
    throw err;
  } finally {
    // Once resolved, clear the cached promise so a later retry after a hard
    // error path can re-run (the ref-based cache no longer matters because
    // sessionIdRef.current is now set).
    if (pendingSessionRef.current === promise) {
      pendingSessionRef.current = null;
    }
  }
}, [options.onSessionCreated]);
```

- [ ] **Step 2: Return `ensureSession` from the hook**

Change the final return of `useAgentChat`:

```ts
return { messages, status, sendMessage, stopMessage, sessionId, ensureSession };
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add hooks/use-agent-chat.ts
git commit -m "feat(hooks): add ensureSession() to useAgentChat"
```

---

## Task 3: Thread `ensureSessionId` prop through `PromptInput`

**Files:**
- Modify: `components/ai-elements/prompt-input.tsx`

- [ ] **Step 1: Add the prop to `PromptInputProps`**

In the `PromptInputProps` type (around line 475-500), add below `sessionId`:

```ts
/**
 * Called when a file is picked or dropped and `sessionId` is absent.
 * Must resolve to a valid session id; the upload flow awaits this before
 * presigning. If omitted and files are provided without a sessionId, the
 * existing hard error still throws.
 */
ensureSessionId?: () => Promise<string>;
```

- [ ] **Step 2: Destructure the new prop**

Update the `PromptInput` component signature (around line 502) to destructure `ensureSessionId`:

```ts
export const PromptInput = ({
  className,
  accept,
  multiple,
  sessionId,
  ensureSessionId,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
```

- [ ] **Step 3: Resolve the session id inside `handleSubmit`**

Replace the block at lines 852-859 (the `if (!sessionId && files.length > 0) throw ...` block) with:

```ts
let effectiveSessionId = sessionId;
if (!effectiveSessionId && files.length > 0) {
  if (!ensureSessionId) {
    throw new Error(
      "PromptInput needs sessionId (or ensureSessionId) to upload attachments. " +
        "Pass <PromptInput sessionId={sessionId} ensureSessionId={ensureSession} ...>.",
    );
  }
  effectiveSessionId = await ensureSessionId();
}
```

Then change the `uploadAttachment` call from `sessionId: sessionId!` to `sessionId: effectiveSessionId!`:

```ts
const { attachmentId } = await uploadAttachment({ file, sessionId: effectiveSessionId! });
```

- [ ] **Step 4: Update the `handleSubmit` dependency array**

In the `useCallback` dependency array at the end of `handleSubmit` (around line 900), add `sessionId` and `ensureSessionId`:

```ts
[usingProvider, controller, files, onSubmit, clear, sessionId, ensureSessionId]
```

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/ai-elements/prompt-input.tsx
git commit -m "feat(prompt-input): accept ensureSessionId to create session on first upload"
```

---

## Task 4: Enable attach button and wire `ensureSession`

**Files:**
- Modify: `components/chat-page.tsx`

- [ ] **Step 1: Pull `ensureSession` out of the hook**

Update the destructure at `components/chat-page.tsx:290` to include `ensureSession`:

```ts
const { messages, status, sendMessage, stopMessage, sessionId, ensureSession } = useAgentChat({
  initialSessionId,
  initialMessages,
  onSessionCreated: handleSessionCreated,
  onTitleUpdate: handleTitleUpdate,
});
```

- [ ] **Step 2: Rewrite `AttachFilesButton` to always be enabled**

Replace the component (lines 111-123) with:

```tsx
const AttachFilesButton = ({ ensureSession }: { ensureSession: () => Promise<string> }) => {
  const attachments = usePromptInputAttachments();
  const handleClick = useCallback(async () => {
    try {
      await ensureSession();
      attachments.openFileDialog();
    } catch (err) {
      console.error("Failed to create session for attachment:", err);
    }
  }, [ensureSession, attachments]);

  return (
    <PromptInputButton onClick={handleClick}>
      <PaperclipIcon className="size-4" />
    </PromptInputButton>
  );
};
```

- [ ] **Step 3: Pass `ensureSession` to the attach button and `PromptInput`**

Update the JSX in `ChatPage`'s render (the `<PromptInput>` block and the `<AttachFilesButton />` usage):

Replace:
```tsx
<PromptInput
  accept="application/pdf,image/png,image/jpeg,image/webp"
  globalDrop
  multiple
  sessionId={sessionId ?? undefined}
  onSubmit={({ text, attachmentIds, attachmentNames }) => {
    if ((!text.trim() && attachmentIds.length === 0) || status === "streaming")
      return;
    if (attachmentIds.length > 0 && !sessionId) {
      // Defense-in-depth: attach button is already disabled without a sessionId,
      // but guard here as well in case files slip through another path.
      console.error("Cannot upload attachments before a session exists. Send a text message first.");
      return;
    }
    sendMessage(text, attachmentIds, attachmentNames);
  }}
>
```

With:
```tsx
<PromptInput
  accept="application/pdf,image/png,image/jpeg,image/webp"
  globalDrop
  multiple
  sessionId={sessionId ?? undefined}
  ensureSessionId={ensureSession}
  onSubmit={({ text, attachmentIds, attachmentNames }) => {
    if ((!text.trim() && attachmentIds.length === 0) || status === "streaming")
      return;
    sendMessage(text, attachmentIds, attachmentNames);
  }}
>
```

And replace `<AttachFilesButton sessionId={sessionId} />` with `<AttachFilesButton ensureSession={ensureSession} />`.

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/chat-page.tsx
git commit -m "feat(chat): enable attach button without a session using ensureSession"
```

---

## Task 5: Relax `/api/chat` validation

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Add empty-input guard**

After the `const { message, sessionId: existingSessionId, attachmentIds = [] } = parsedBody;` line (around line 37), add:

```ts
if ((!message || message.trim().length === 0) && attachmentIds.length === 0) {
  return new Response(
    JSON.stringify({ error: "message or attachmentIds required" }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-test the guard**

With dev server running and a logged-in browser at `/agent`, in devtools console:

```js
await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "", sessionId: null }),
}).then(r => ({ status: r.status, body: await r.json() }))
```

Expected: `{ status: 400, body: { error: "message or attachmentIds required" } }`.

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "fix(api/chat): require message or attachments, not message alone"
```

---

## Task 6: End-to-end manual verification

No code changes in this task — it verifies the feature works in a browser.

- [ ] **Step 1: Start the dev server**

Run: `bun run dev`
Navigate to `http://localhost:3000/agent` in a logged-in browser.

- [ ] **Step 2: Scenario A — paperclip on empty chat**

1. Confirm the chat is empty (no messages, no sidebar-highlighted session).
2. Click the paperclip icon.
3. Expected:
   - URL changes to `/agent/ses_...` via `replaceState`.
   - A placeholder entry appears in the sidebar.
   - The OS file picker opens.
4. Pick a small PDF. Confirm the attachment chip appears in the input.
5. Click Send with **empty** textarea.
6. Expected: assistant replies; the user turn shows the attachment chip; the session eventually gets a title.

- [ ] **Step 3: Scenario B — drag-drop on empty chat**

1. Open a fresh `/agent` (cmd-click the "Ny samtale" link or hard-refresh).
2. Drag a PDF from Finder anywhere onto the page.
3. Expected: same as Scenario A — session is created, URL updates, file upload proceeds.

- [ ] **Step 4: Scenario C — combined text + attachment on first turn**

1. Open a fresh `/agent`.
2. Click paperclip, pick a PDF.
3. Type "oppsummer dette dokumentet" in the textarea.
4. Click Send.
5. Expected: assistant replies; user turn shows both the attachment chip and the text.

- [ ] **Step 5: Scenario D — `/api/session` failure**

1. Open a fresh `/agent`. Open devtools → Network tab → right-click `/api/session` and "Block request URL".
2. Click the paperclip.
3. Expected: the file dialog does *not* open. A console error is logged ("Failed to create session..."). URL does not change. Sidebar is unchanged.
4. Unblock the URL. Click paperclip again. Expected: works as in Scenario A.

- [ ] **Step 6: Scenario E — concurrent drops**

1. Open a fresh `/agent`.
2. Select two PDFs in Finder and drag both onto the page in a single drop.
3. Expected: a single `/api/session` POST fires (check Network tab); both files upload; both chips render.

- [ ] **Step 7: Regression — existing-session chat still works**

1. Open an existing session from the sidebar.
2. Send a plain text message. Expected: replies stream as before.
3. Attach a file in that existing session and send with text. Expected: works as before.

- [ ] **Step 8: Commit (no-op marker)**

If any scenario required a fix, commit it now with an appropriate message. If all passed, no commit is needed — proceed.

---

## Self-review notes

- **Spec coverage:** new endpoint (Task 1), `ensureSession` hook (Task 2), `PromptInput` rewiring (Task 3), UI button + submit handler (Task 4), server guard (Task 5), manual verification matching the spec's "Testing → Manual" list (Task 6). The spec's "Testing → Unit / integration" bullets are intentionally dropped because the project has no existing automated test infrastructure; see plan intro.
- **Naming consistency:** `ensureSession` on the hook returns `Promise<string>`; the `PromptInput` prop is `ensureSessionId` and has the same signature. Both names appear verbatim in every task that touches them.
- **No placeholders:** every step contains the actual code or command needed.
