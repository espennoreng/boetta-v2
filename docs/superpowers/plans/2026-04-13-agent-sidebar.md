# Agent Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible shadcn sidebar to `/agent` that lists the org's sessions, lets the user start a new one, moves `UserButton` + `OrganizationSwitcher` to the footer, and auto-generates a short Norwegian title for each session via a Claude Haiku call after the first assistant response.

**Architecture:** The `title` column and `session_ownership_org_created_idx` already exist in `session_ownership` — no migration required. Add two queries (`listSessionsForOrg`, `updateSessionTitle`) + a new `GET /api/sessions` route. Title generation lives in a new `lib/session-title.ts` helper. Integration happens in `app/api/chat/route.ts`: when a new session was created in this request, accumulate the assistant's streamed text, generate a title after the Anthropic `done` event, persist, and emit a fresh `session_title` SSE event. Client side: a `SessionsProvider` context holds the list and exposes `refresh()`; `useAgentChat` fires callbacks on `session_title` and `X-Session-Id`-change so the provider re-fetches. The sidebar itself is a client component composed from shadcn's `Sidebar` primitives, with Clerk's auth widgets in `SidebarFooter`.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM + Neon Postgres (PGlite for tests), `@anthropic-ai/sdk` `v0.88`, shadcn `sidebar` (base primitives), Clerk (`UserButton`, `OrganizationSwitcher`), Bun test runner.

---

## File Structure

**Created:**
- `lib/session-title.ts` — Haiku-backed `generateSessionTitle({ userMessage, assistantMessage })` helper
- `app/api/sessions/route.ts` — `GET` handler returning the caller org's sessions
- `app/agent/_components/sessions-provider.tsx` — client context: `{ sessions, refresh, loading }`
- `app/agent/_components/agent-sidebar.tsx` — the composed shadcn sidebar
- `components/ui/sidebar.tsx` — added by `shadcn add sidebar` (do not hand-edit besides structural changes required by this plan)
- `lib/session-title.test.ts` — unit tests for the title helper (Anthropic SDK mocked)

**Modified:**
- `lib/db/queries.ts` — add `listSessionsForOrg`, `updateSessionTitle`
- `lib/db/queries.test.ts` — add coverage for the two new queries
- `app/api/chat/route.ts` — accumulate assistant text, call title generator on first-turn sessions, emit `session_title` SSE event
- `hooks/use-agent-chat.ts` — handle `session_title` SSE event, expose `onSessionCreated` + `onTitleUpdate` options
- `app/agent/layout.tsx` — wrap children in `SidebarProvider` + `AgentSidebar` + `SidebarInset`; remove the fixed top-right Clerk div
- `components/chat-page.tsx` — consume `SessionsProvider`, pass refresh callbacks into `useAgentChat`, add a `SidebarTrigger` to the chat header

**Unchanged but referenced:**
- `lib/agent-manager.ts:53` — `createSession` already accepts a `title`; we will not call it with one on creation (title is generated post-turn)
- `lib/db/schema.ts:33` — `sessionOwnership` table already has `title` column and `(clerk_org_id, created_at)` index

---

## Task 1: Add `listSessionsForOrg` + `updateSessionTitle` queries

**Files:**
- Modify: `lib/db/queries.ts`
- Test: `lib/db/queries.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `lib/db/queries.test.ts`:

```typescript
describe("listSessionsForOrg", () => {
  it("returns sessions for the given org, newest first", async () => {
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_old",
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
    });
    // Small delay to ensure distinct created_at; PGlite resolves now() per statement.
    await new Promise((r) => setTimeout(r, 5));
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_new",
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
      title: "Byggesak Bergen",
    });
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_other_org",
      clerkOrgId: "org_b",
      clerkUserId: "user_2",
    });

    const rows = await q.listSessionsForOrg("org_a");
    expect(rows.map((r) => r.anthropicSessionId)).toEqual(["sess_new", "sess_old"]);
    expect(rows[0].title).toBe("Byggesak Bergen");
  });

  it("excludes archived sessions", async () => {
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_a",
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
    });
    await testDb.db.execute(
      sql`UPDATE session_ownership SET archived_at = now() WHERE anthropic_session_id = 'sess_a'`,
    );
    const rows = await q.listSessionsForOrg("org_a");
    expect(rows).toHaveLength(0);
  });

  it("returns empty array when org has no sessions", async () => {
    expect(await q.listSessionsForOrg("org_empty")).toEqual([]);
  });
});

describe("updateSessionTitle", () => {
  it("updates the title for an existing session", async () => {
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_1",
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
    });
    await q.updateSessionTitle("sess_1", "Fradeling av tomt");
    const row = await q.getSessionOwnership("sess_1");
    expect(row?.title).toBe("Fradeling av tomt");
  });

  it("is a no-op for unknown session id", async () => {
    await q.updateSessionTitle("sess_missing", "x");
    expect(await q.getSessionOwnership("sess_missing")).toBeNull();
  });
});
```

Add this import at the top of the test file if not already present:

```typescript
import { sql } from "drizzle-orm";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test lib/db/queries.test.ts`
Expected: FAIL — `q.listSessionsForOrg is not a function`, `q.updateSessionTitle is not a function`.

- [ ] **Step 3: Implement the queries**

Edit `lib/db/queries.ts`. At the top, change the drizzle import to include `desc` and `and`, `isNull`:

```typescript
import { eq, asc, desc, and, isNull, sql } from "drizzle-orm";
```

Inside `makeQueries`, after `getSessionOwnership` (around line 102, before the closing `};`), add:

```typescript
    async listSessionsForOrg(clerkOrgId: string) {
      return db
        .select({
          anthropicSessionId: sessionOwnership.anthropicSessionId,
          title: sessionOwnership.title,
          createdAt: sessionOwnership.createdAt,
        })
        .from(sessionOwnership)
        .where(
          and(
            eq(sessionOwnership.clerkOrgId, clerkOrgId),
            isNull(sessionOwnership.archivedAt),
          ),
        )
        .orderBy(desc(sessionOwnership.createdAt));
    },

    async updateSessionTitle(anthropicSessionId: string, title: string) {
      await db
        .update(sessionOwnership)
        .set({ title })
        .where(eq(sessionOwnership.anthropicSessionId, anthropicSessionId));
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test lib/db/queries.test.ts`
Expected: PASS — all new cases green, prior tests still green.

- [ ] **Step 5: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "feat(db): add listSessionsForOrg + updateSessionTitle queries"
```

---

## Task 2: Add `GET /api/sessions` route

**Files:**
- Create: `app/api/sessions/route.ts`

- [ ] **Step 1: Create the route**

Write `app/api/sessions/route.ts`:

```typescript
import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const queries = makeQueries(db);

export async function GET() {
  let ctx;
  try {
    ctx = await requireActive();
  } catch (err) {
    const status = err instanceof Error && err.name === "NotActiveError" ? 403 : 401;
    return Response.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status },
    );
  }

  const rows = await queries.listSessionsForOrg(ctx.orgId);

  return Response.json({
    sessions: rows.map((r) => ({
      id: r.anthropicSessionId,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
```

- [ ] **Step 2: Manual smoke test**

Run dev server: `bun run dev`. Sign in with a user whose org is `active`. Visit `http://localhost:3000/api/sessions` in the browser.
Expected: `{"sessions":[...]}`. With no existing sessions, the array is empty. Sign out → expected `{"error":"Not authenticated"}` with `401`.

- [ ] **Step 3: Commit**

```bash
git add app/api/sessions/route.ts
git commit -m "feat(api): add GET /api/sessions for sidebar list"
```

---

## Task 3: Create the Haiku title generator

**Files:**
- Create: `lib/session-title.ts`
- Test: `lib/session-title.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/session-title.test.ts`:

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mock the Anthropic SDK BEFORE importing the module under test.
const createMock = mock(async (_args: unknown) => ({
  content: [{ type: "text", text: "Byggesak i Bergen" }],
}));

mock.module("@anthropic-ai/sdk", () => {
  return {
    default: class AnthropicMock {
      messages = { create: createMock };
    },
  };
});

const { generateSessionTitle } = await import("./session-title");

beforeEach(() => {
  createMock.mockClear();
});

describe("generateSessionTitle", () => {
  it("calls Haiku with the user and assistant text and returns the title", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Fradeling av tomt" }],
    });

    const title = await generateSessionTitle({
      userMessage: "Kan jeg dele fra en tomt?",
      assistantMessage: "Ja, men det krever tillatelse...",
    });

    expect(title).toBe("Fradeling av tomt");
    expect(createMock).toHaveBeenCalledTimes(1);
    const args = createMock.mock.calls[0][0] as { model: string; max_tokens: number };
    expect(args.model).toBe("claude-haiku-4-5-20251001");
    expect(args.max_tokens).toBeLessThanOrEqual(40);
  });

  it("strips surrounding quotes and trims whitespace", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: '  "Byggesak Bergen"\n' }],
    });

    const title = await generateSessionTitle({
      userMessage: "hei",
      assistantMessage: "hei",
    });

    expect(title).toBe("Byggesak Bergen");
  });

  it("truncates model input text to avoid token waste", async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "ok" }],
    });

    const bigText = "a".repeat(5000);
    await generateSessionTitle({
      userMessage: bigText,
      assistantMessage: bigText,
    });

    const args = createMock.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    // Each side capped at 500 chars; content has both.
    expect(args.messages[0].content.length).toBeLessThan(1500);
  });

  it("returns null when the model returns empty text (fail-safe)", async () => {
    createMock.mockResolvedValueOnce({ content: [{ type: "text", text: "" }] });
    const title = await generateSessionTitle({
      userMessage: "x",
      assistantMessage: "y",
    });
    expect(title).toBeNull();
  });

  it("returns null when the API throws (never breaks the caller)", async () => {
    createMock.mockRejectedValueOnce(new Error("network"));
    const title = await generateSessionTitle({
      userMessage: "x",
      assistantMessage: "y",
    });
    expect(title).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `bun test lib/session-title.test.ts`
Expected: FAIL — module `./session-title` does not exist.

- [ ] **Step 3: Implement the helper**

Create `lib/session-title.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const MODEL = "claude-haiku-4-5-20251001";
const MAX_INPUT_CHARS = 500;

const SYSTEM_PROMPT =
  "Du lager korte, beskrivende titler på norsk for samtaler i en juridisk AI-assistent for kommuner og byggesaker. " +
  "Returner kun selve tittelen — ingen anførselstegn, ingen punktum, ingen forklaring. " +
  "Maks 6 ord. Bruk substantivfraser, ikke fullstendige setninger.";

export interface GenerateTitleArgs {
  userMessage: string;
  assistantMessage: string;
}

export async function generateSessionTitle(
  args: GenerateTitleArgs,
): Promise<string | null> {
  const userText = args.userMessage.slice(0, MAX_INPUT_CHARS);
  const assistantText = args.assistantMessage.slice(0, MAX_INPUT_CHARS);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 30,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `Samtalen:\n\nBruker: ${userText}\n\nAssistent: ${assistantText}\n\n` +
            "Skriv en kort tittel (maks 6 ord) på norsk som beskriver hva samtalen handler om.",
        },
      ],
    });

    const textBlock = response.content.find(
      (b): b is { type: "text"; text: string } => b.type === "text",
    );
    const raw = textBlock?.text ?? "";
    const cleaned = raw.trim().replace(/^["'«»]+|["'«»]+$/g, "").trim();
    return cleaned.length > 0 ? cleaned : null;
  } catch (err) {
    console.error("generateSessionTitle failed:", err);
    return null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test lib/session-title.test.ts`
Expected: PASS — all five cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/session-title.ts lib/session-title.test.ts
git commit -m "feat: add Haiku-backed session title generator"
```

---

## Task 4: Generate + persist + stream the title from the chat route

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Update the route to accumulate assistant text and emit `session_title`**

Replace the contents of `app/api/chat/route.ts` with:

```typescript
import {
  createSession,
  streamWithToolHandling,
} from "@/lib/agent-manager";
import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { makeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { generateSessionTitle } from "@/lib/session-title";
import type { FileUIPart } from "ai";

const queries = makeQueries(db);
const audit = makeAudit(db);

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireActive();
  } catch (err) {
    const status = err instanceof Error && err.name === "NotActiveError" ? 403 : 401;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unauthorized" }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }

  const { message, sessionId: existingSessionId, files } =
    (await request.json()) as {
      message: string;
      sessionId?: string;
      files?: FileUIPart[];
    };

  let sessionId = existingSessionId;
  let eventForAudit: "session.created" | "session.opened" = "session.opened";

  if (!sessionId) {
    sessionId = await createSession({
      clerkOrgId: ctx.orgId,
      clerkUserId: ctx.userId,
    });
    eventForAudit = "session.created";
  } else {
    const ownership = await queries.getSessionOwnership(sessionId);
    if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  await audit.logEvent({
    actorUserId: ctx.userId,
    actorOrgId: ctx.orgId,
    event: eventForAudit,
    subjectType: "session",
    subjectId: sessionId,
  });

  const isNewSession = eventForAudit === "session.created";
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      let assistantText = "";
      try {
        for await (const event of streamWithToolHandling(
          sessionId!,
          message,
          files ?? [],
        )) {
          if (event.type === "text" && typeof event.text === "string") {
            assistantText += event.text;
          }

          // Forward every event except `done` — we defer `done` until after
          // we have optionally emitted `session_title`.
          if (event.type === "done") break;

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }

        // For newly created sessions with a non-empty assistant response,
        // generate a title via Haiku, persist it, and emit it over SSE.
        if (isNewSession && assistantText.trim().length > 0) {
          const title = await generateSessionTitle({
            userMessage: message,
            assistantMessage: assistantText,
          });
          if (title) {
            await queries.updateSessionTitle(sessionId!, title);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "session_title",
                  sessionId,
                  title,
                })}\n\n`,
              ),
            );
          }
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`),
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
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

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke test**

Start dev server, sign in, send one message on a fresh session. The network tab's SSE stream should show a `session_title` event after the stream finishes. Query the DB (or hit `/api/sessions`) to confirm the row's `title` now has a Norwegian phrase.

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(api): generate and stream session title on first turn"
```

---

## Task 5: Handle `session_title` in `useAgentChat` and expose lifecycle callbacks

**Files:**
- Modify: `hooks/use-agent-chat.ts`

- [ ] **Step 1: Extend the hook's types and options**

Edit `hooks/use-agent-chat.ts`. Update `SSEEvent` (around line 31) to include the new event type:

```typescript
interface SSEEvent {
  type:
    | "text"
    | "tool_use"
    | "tool_result"
    | "thinking"
    | "citations"
    | "session_title"
    | "done"
    | "error";
  text?: string;
  id?: string;
  name?: string;
  displayName?: string;
  result?: string;
  message?: string;
  citations?: Citation[];
  sessionId?: string;
  title?: string;
}
```

Update `UseAgentChatOptions` (around line 42):

```typescript
interface UseAgentChatOptions {
  initialSessionId?: string | null;
  initialMessages?: ChatMessage[];
  onSessionCreated?: (sessionId: string) => void;
  onTitleUpdate?: (sessionId: string, title: string) => void;
}
```

- [ ] **Step 2: Call `onSessionCreated` and handle `session_title`**

Inside `useAgentChat`, replace the block that reads `X-Session-Id` (currently at lines 86–93) with:

```typescript
      const newSessionId = response.headers.get("X-Session-Id");
      const isNewSession =
        newSessionId !== null && newSessionId !== sessionIdRef.current;
      if (newSessionId) {
        sessionIdRef.current = newSessionId;
        if (
          typeof window !== "undefined" &&
          !window.location.pathname.includes(newSessionId)
        ) {
          window.history.replaceState(null, "", `/agent/${newSessionId}`);
        }
        if (isNewSession) {
          options.onSessionCreated?.(newSessionId);
        }
      }
```

Note the path fix: existing code writes `/${newSessionId}` which loses the `/agent` prefix. New code writes `/agent/${newSessionId}`.

Add a new case inside the SSE `switch` (next to `citations`):

```typescript
            case "session_title": {
              if (event.sessionId && event.title) {
                options.onTitleUpdate?.(event.sessionId, event.title);
              }
              break;
            }
```

Also change the `useCallback` dependency list at the bottom (currently `[]`) so the callbacks are up to date:

```typescript
  }, [options.onSessionCreated, options.onTitleUpdate]);
```

- [ ] **Step 3: Type-check**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add hooks/use-agent-chat.ts
git commit -m "feat(hook): handle session_title SSE event and lifecycle callbacks"
```

---

## Task 6: Install shadcn `sidebar`

**Files:**
- Create: `components/ui/sidebar.tsx` (via CLI)
- Modify: `components.json` (only if CLI updates it)

- [ ] **Step 1: Add the component**

Run: `bunx --bun shadcn@latest add sidebar`
If prompted about overwriting `components.json`, accept defaults.

- [ ] **Step 2: Verify the file**

Run: `ls components/ui/sidebar.tsx`
Expected: file exists. Quickly skim it for the named exports: `Sidebar`, `SidebarProvider`, `SidebarInset`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarGroup`, `SidebarGroupContent`, `SidebarGroupLabel`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarRail`, `SidebarTrigger`.

- [ ] **Step 3: Commit**

```bash
git add components/ui/sidebar.tsx components.json
git commit -m "chore(ui): add shadcn sidebar component"
```

---

## Task 7: Build the `SessionsProvider` context

**Files:**
- Create: `app/agent/_components/sessions-provider.tsx`

- [ ] **Step 1: Write the provider**

Create `app/agent/_components/sessions-provider.tsx`:

```typescript
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface SessionListItem {
  id: string;
  title: string | null;
  createdAt: string;
}

interface SessionsContextValue {
  sessions: SessionListItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  applyTitle: (sessionId: string, title: string) => void;
  upsertPlaceholder: (sessionId: string) => void;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

export function SessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) return;
      const data = (await res.json()) as { sessions: SessionListItem[] };
      setSessions(data.sessions);
    } finally {
      setLoading(false);
    }
  }, []);

  const applyTitle = useCallback((sessionId: string, title: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title } : s)),
    );
  }, []);

  const upsertPlaceholder = useCallback((sessionId: string) => {
    setSessions((prev) => {
      if (prev.some((s) => s.id === sessionId)) return prev;
      return [
        { id: sessionId, title: null, createdAt: new Date().toISOString() },
        ...prev,
      ];
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SessionsContext.Provider
      value={{ sessions, loading, refresh, applyTitle, upsertPlaceholder }}
    >
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) {
    throw new Error("useSessions must be used inside <SessionsProvider>");
  }
  return ctx;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/agent/_components/sessions-provider.tsx
git commit -m "feat(agent): add SessionsProvider context"
```

---

## Task 8: Build the `AgentSidebar` component

**Files:**
- Create: `app/agent/_components/agent-sidebar.tsx`

- [ ] **Step 1: Write the sidebar**

Create `app/agent/_components/agent-sidebar.tsx`:

```typescript
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { PlusIcon, MessageSquareIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useSessions } from "./sessions-provider";

export function AgentSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { sessions, loading } = useSessions();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={() => router.push("/agent")}
        >
          <PlusIcon data-icon="inline-start" />
          Ny samtale
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Samtaler</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {loading && sessions.length === 0 ? (
                <SidebarMenuItem>
                  <div className="px-2 py-1 text-muted-foreground text-xs">
                    Laster…
                  </div>
                </SidebarMenuItem>
              ) : sessions.length === 0 ? (
                <SidebarMenuItem>
                  <div className="px-2 py-1 text-muted-foreground text-xs">
                    Ingen samtaler enda
                  </div>
                </SidebarMenuItem>
              ) : (
                sessions.map((s) => {
                  const href = `/agent/${s.id}`;
                  const isActive = pathname === href;
                  const label = s.title ?? "Uten tittel";
                  return (
                    <SidebarMenuItem key={s.id}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={label}>
                        <Link href={href}>
                          <MessageSquareIcon />
                          <span className="truncate">{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 px-1 py-1 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-1">
          <UserButton />
          <OrganizationSwitcher
            hidePersonal
            afterSelectOrganizationUrl="/agent"
            afterCreateOrganizationUrl="/pending"
            appearance={{
              elements: {
                rootBox: "flex-1 min-w-0",
                organizationSwitcherTrigger:
                  "group-data-[collapsible=icon]:hidden",
              },
            }}
          />
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
```

Note: `asChild` / `render` — `components/ui/sidebar.tsx` is base-primitive-based in this project. Confirm whether `SidebarMenuButton` in your installed file expects `asChild` or `render`. After running Task 6, grep the installed file:

```bash
grep -E "asChild|render" components/ui/sidebar.tsx | head
```

If it uses `render={<Link .../>}` instead of `asChild`, change the two `SidebarMenuButton` usages accordingly:

```tsx
<SidebarMenuButton
  render={<Link href={href} />}
  isActive={isActive}
  tooltip={label}
>
  <MessageSquareIcon />
  <span className="truncate">{label}</span>
</SidebarMenuButton>
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/agent/_components/agent-sidebar.tsx
git commit -m "feat(agent): add AgentSidebar with session list and footer"
```

---

## Task 9: Refactor `app/agent/layout.tsx`

**Files:**
- Modify: `app/agent/layout.tsx`

- [ ] **Step 1: Replace the layout**

Replace the whole contents of `app/agent/layout.tsx` with:

```tsx
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AgentSidebar } from "./_components/agent-sidebar";
import { SessionsProvider } from "./_components/sessions-provider";

export default function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionsProvider>
      <SidebarProvider>
        <AgentSidebar />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </SessionsProvider>
  );
}
```

The fixed top-right div with `<UserButton />` + `<OrganizationSwitcher />` is intentionally removed — those widgets now live in `SidebarFooter`.

- [ ] **Step 2: Visual smoke test**

Run: `bun run dev`. Visit `/agent` while signed in with an active-org user.
Expected: sidebar visible on the left with "Ny samtale" button, empty sessions list (or existing ones), footer with avatar + org switcher. Clicking the `SidebarTrigger` (to be added next task) or pressing `cmd+b` collapses to icon mode.

- [ ] **Step 3: Commit**

```bash
git add app/agent/layout.tsx
git commit -m "refactor(agent): layout now composes SessionsProvider + Sidebar"
```

---

## Task 10: Wire the chat page to refresh the sidebar

**Files:**
- Modify: `components/chat-page.tsx`

- [ ] **Step 1: Consume `useSessions` and add a `SidebarTrigger`**

In `components/chat-page.tsx`, add imports near the top (next to existing imports):

```tsx
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useSessions } from "@/app/agent/_components/sessions-provider";
```

Inside the `ChatPage` function body (before the `useAgentChat` call, currently line 266), add:

```tsx
  const { refresh, applyTitle, upsertPlaceholder } = useSessions();
```

Change the `useAgentChat` call:

```tsx
  const { messages, status, sendMessage } = useAgentChat({
    initialSessionId,
    initialMessages,
    onSessionCreated: (sessionId) => {
      upsertPlaceholder(sessionId);
      // Best-effort: refetch so we get the canonical row from the server.
      void refresh();
    },
    onTitleUpdate: (sessionId, title) => {
      applyTitle(sessionId, title);
    },
  });
```

At the top of the rendered tree (just after `<div className="flex h-dvh flex-col">`, line 272), insert a small header that hosts the sidebar trigger:

```tsx
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger />
      </header>
```

- [ ] **Step 2: Type-check and visual smoke test**

Run: `bunx tsc --noEmit`
Expected: no errors.

Run: `bun run dev`. Sign in, start a new conversation, send one message.
Expected (user-visible sequence):
1. Sidebar gets a "Uten tittel" entry immediately when the first response's `X-Session-Id` header arrives.
2. A few seconds after the assistant finishes, the sidebar entry's label updates to a Norwegian phrase.
3. Reloading `/agent/<id>` keeps the title (persisted in DB). Clicking the entry navigates to the session; the active style highlights it.
4. `cmd+b` collapses/expands the sidebar. In collapsed mode, only icons show, `OrganizationSwitcher`'s trigger is hidden (its dropdown still opens via `UserButton`'s org list if desired — acceptable tradeoff), and the session entries show as tooltips on hover.

- [ ] **Step 3: Commit**

```bash
git add components/chat-page.tsx
git commit -m "feat(agent): wire chat page to sidebar refresh + title updates"
```

---

## Task 11: End-to-end manual verification

No code changes — this is a verification checklist. Complete every bullet before calling the feature done.

- [ ] **Step 1: Fresh-session happy path**

  1. Sign in as a user in an `active` org with zero sessions.
  2. Visit `/agent`. Sidebar renders, sessions list is empty, footer shows avatar + org switcher.
  3. Send "Kan jeg dele fra en tomt i Bergen?". Wait for the response.
  4. New sidebar entry appears mid-stream as "Uten tittel".
  5. Within ~3s of the response finishing, the entry's label becomes something like "Fradeling av tomt i Bergen".
  6. URL is `/agent/sess_...`.

- [ ] **Step 2: Navigation & active state**

  1. Click "Ny samtale" — navigates to `/agent`, clears the chat.
  2. Send another message, different topic.
  3. Two entries now visible. Clicking the first navigates back; the first entry has the active highlight and the second does not.

- [ ] **Step 3: Collapse / keyboard**

  1. Press `cmd+b` (or click the trigger). Sidebar collapses to icon rail.
  2. Hovering a session icon shows the title as a tooltip.
  3. `cmd+b` again expands it. The expanded state persists in its cookie across reload.

- [ ] **Step 4: Isolation**

  1. Sign in as a user in a different `active` org. Their session list is empty (does not see org A's sessions).
  2. Hit `/api/sessions` directly while signed out → `401`. Signed in but no org → `401`. Signed in with `pending` org → `403`.

- [ ] **Step 5: Final commit**

If any small polish edits were made in this task, commit them:

```bash
git add -A
git commit -m "chore(agent): sidebar polish from manual QA"
```

---

## Notes / Deferred

- **Archive / rename UX** is not in this plan. `archived_at` filtering is already honored by `listSessionsForOrg`, so adding a "Slett samtale" right-click later is a query + a mutation away.
- **Title-regeneration if the Haiku call fails:** the entry stays "Uten tittel" — a future job could retry, but at ~0.1¢ per title the blast radius of one miss is tiny.
- **Streaming title** (token-by-token) is overkill for a 3-word string; the current approach waits for the full Haiku response and emits a single `session_title` SSE event.
- **Titles don't stream into the Anthropic SDK's `session.title` field** — that would be a follow-up if we ever want the title to show up in Anthropic's dashboards. For our own UI we only need the DB column.
