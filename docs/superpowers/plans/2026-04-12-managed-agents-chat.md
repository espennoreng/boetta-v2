# Managed Agents Chat Interface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A minimal multi-turn chat UI connected to Claude Managed Agents, with streaming text and tool call indicators.

**Architecture:** Next.js API route proxies Managed Agents SSE events to a custom React hook (`useAgentChat`), which drives ai-elements components for rendering. Agent and environment are lazy-created and cached in memory.

**Tech Stack:** Next.js 16, React 19, Anthropic SDK (`@anthropic-ai/sdk`), ai-elements components, shadcn/ui, Streamdown for markdown rendering.

**Spec:** `docs/superpowers/specs/2026-04-12-managed-agents-chat-design.md`

---

## File Structure

| File | Purpose |
|------|---------|
| `lib/agent-manager.ts` | Module singleton: lazy-creates agent + environment, creates sessions, opens streams |
| `app/api/chat/route.ts` | POST handler: creates sessions, sends messages, proxies SSE events to client |
| `hooks/use-agent-chat.ts` | React hook: manages messages/status state, reads SSE stream from API route |
| `app/page.tsx` | Chat page: wires hook to ai-elements Conversation/Message/PromptInput/Tool components |

---

### Task 1: AgentManager — lazy agent and environment creation

**Files:**
- Create: `lib/agent-manager.ts`

- [ ] **Step 1: Create the agent manager module**

Create `lib/agent-manager.ts` with three exported functions. The module caches agent and environment IDs at module scope.

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

let cachedAgentId: string | null = null;
let cachedEnvironmentId: string | null = null;

export async function getAgentId(): Promise<string> {
  if (cachedAgentId) return cachedAgentId;

  const agent = await client.beta.agents.create({
    name: "Chat Assistant",
    model: "claude-sonnet-4-6",
    system:
      "You are a helpful coding assistant. Write clean, well-documented code.",
    tools: [{ type: "agent_toolset_20260401" }],
  });

  cachedAgentId = agent.id;
  return cachedAgentId;
}

export async function getEnvironmentId(): Promise<string> {
  if (cachedEnvironmentId) return cachedEnvironmentId;

  const environment = await client.beta.environments.create({
    name: `chat-env-${Date.now()}`,
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

export async function sendMessageAndStream(
  sessionId: string,
  text: string,
) {
  const stream = await client.beta.sessions.events.stream(sessionId);

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text }],
      },
    ],
  });

  return stream;
}
```

- [ ] **Step 2: Verify the module compiles**

Run: `npx tsc --noEmit lib/agent-manager.ts`

If there are type errors from the beta API, check that `ANTHROPIC_API_KEY` is set and the SDK version supports the beta namespace. The SDK at `^0.88.0` should have it.

- [ ] **Step 3: Commit**

```bash
git add lib/agent-manager.ts
git commit -m "feat: add agent manager for managed agents lifecycle"
```

---

### Task 2: API Route — SSE proxy

**Files:**
- Create: `app/api/chat/route.ts`

- [ ] **Step 1: Create the POST route handler**

Create `app/api/chat/route.ts`. This handler receives `{ message, sessionId? }`, creates a session if needed, opens the Managed Agents stream, and transforms events into a simplified SSE format for the client.

```typescript
import { createSession, sendMessageAndStream } from "@/lib/agent-manager";

export async function POST(request: Request) {
  const { message, sessionId: existingSessionId } = (await request.json()) as {
    message: string;
    sessionId?: string;
  };

  const sessionId = existingSessionId ?? (await createSession());
  const stream = await sendMessageAndStream(sessionId, message);

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          let data: string | null = null;

          switch (event.type) {
            case "agent.message": {
              const text = event.content
                .filter(
                  (block: { type: string }) => block.type === "text",
                )
                .map((block: { text: string }) => block.text)
                .join("");
              if (text) {
                data = JSON.stringify({ type: "text", text });
              }
              break;
            }
            case "agent.tool_use": {
              data = JSON.stringify({
                type: "tool_use",
                id: event.id,
                name: event.name,
              });
              break;
            }
            case "agent.tool_result": {
              data = JSON.stringify({
                type: "tool_result",
                id: event.tool_use_id,
              });
              break;
            }
            case "session.status_idle": {
              data = JSON.stringify({ type: "done" });
              break;
            }
          }

          if (data) {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          if (event.type === "session.status_idle") {
            break;
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message })}\n\n`,
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

- [ ] **Step 2: Verify the route compiles**

Run: `npx tsc --noEmit app/api/chat/route.ts`

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: add chat API route with SSE proxy for managed agents"
```

---

### Task 3: useAgentChat hook

**Files:**
- Create: `hooks/use-agent-chat.ts`

- [ ] **Step 1: Create the hook**

Create `hooks/use-agent-chat.ts`. This hook manages all chat state and handles the SSE stream from the API route.

```typescript
"use client";

import { useState, useCallback, useRef } from "react";

export interface ToolCall {
  id: string;
  name: string;
  state: "running" | "completed";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCall[];
}

type Status = "idle" | "streaming";

interface SSEEvent {
  type: "text" | "tool_use" | "tool_result" | "done" | "error";
  text?: string;
  id?: string;
  name?: string;
  message?: string;
}

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const sessionIdRef = useRef<string | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };
    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      toolCalls: [],
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setStatus("streaming");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          sessionId: sessionIdRef.current,
        }),
      });

      const newSessionId = response.headers.get("X-Session-Id");
      if (newSessionId) {
        sessionIdRef.current = newSessionId;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event: SSEEvent = JSON.parse(line.slice(6));

          switch (event.type) {
            case "text": {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, text: msg.text + event.text }
                    : msg,
                ),
              );
              break;
            }
            case "tool_use": {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
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
            case "tool_result": {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        toolCalls: msg.toolCalls?.map((tc) =>
                          tc.id === event.id
                            ? { ...tc, state: "completed" as const }
                            : tc,
                        ),
                      }
                    : msg,
                ),
              );
              break;
            }
            case "done": {
              setStatus("idle");
              break;
            }
            case "error": {
              console.error("Agent error:", event.message);
              setStatus("idle");
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setStatus("idle");
    }
  }, []);

  return { messages, status, sendMessage };
}
```

- [ ] **Step 2: Verify the hook compiles**

Run: `npx tsc --noEmit hooks/use-agent-chat.ts`

- [ ] **Step 3: Commit**

```bash
git add hooks/use-agent-chat.ts
git commit -m "feat: add useAgentChat hook for managed agents streaming"
```

---

### Task 4: Chat page UI

**Files:**
- Modify: `app/page.tsx` (replace entire contents)

- [ ] **Step 1: Replace the page with the chat UI**

Replace `app/page.tsx` with the chat interface wiring `useAgentChat` to ai-elements components.

```tsx
"use client";

import { MessageSquare } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputBody,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { Tool, ToolHeader } from "@/components/ai-elements/tool";
import { useAgentChat } from "@/hooks/use-agent-chat";
import type { ChatMessage, ToolCall } from "@/hooks/use-agent-chat";

function toolStateToUIPart(state: ToolCall["state"]) {
  return state === "running" ? "input-available" : "output-available";
}

export default function ChatPage() {
  const { messages, status, sendMessage } = useAgentChat();

  return (
    <div className="flex h-dvh flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Chat with Claude"
              description="Send a message to start a conversation."
              icon={<MessageSquare className="size-8" />}
            />
          ) : (
            messages.map((msg) => (
              <ChatMessageItem key={msg.id} message={msg} />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <PromptInput
          onSubmit={async ({ text }) => {
            if (!text.trim() || status === "streaming") return;
            await sendMessage(text);
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea placeholder="Send a message..." />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              disabled={status === "streaming"}
              className="shrink-0"
            >
              <Send className="size-4" />
            </Button>
          </PromptInputBody>
        </PromptInput>
      </div>
    </div>
  );
}

function ChatMessageItem({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>{message.text}</MessageContent>
      </Message>
    );
  }

  return (
    <Message from="assistant">
      {message.text && (
        <MessageContent>
          <MessageResponse>{message.text}</MessageResponse>
        </MessageContent>
      )}
      {message.toolCalls?.map((tc) => (
        <Tool key={tc.id}>
          <ToolHeader
            type="dynamic-tool"
            toolName={tc.name}
            state={toolStateToUIPart(tc.state)}
          />
        </Tool>
      ))}
    </Message>
  );
}
```

- [ ] **Step 2: Run the dev server and verify the page loads**

Run: `bun run dev`

Open `http://localhost:3000` in the browser. Verify:
- The empty state shows "Chat with Claude" with the message icon
- The prompt input textarea is visible at the bottom
- No console errors

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: add chat page with ai-elements components"
```

---

### Task 5: End-to-end test

**Files:** None (manual testing)

- [ ] **Step 1: Set the API key**

Ensure `ANTHROPIC_API_KEY` is set in the environment. Create `.env.local` if it doesn't exist:

```bash
echo "ANTHROPIC_API_KEY=your-key-here" > .env.local
```

Make sure `.env.local` is in `.gitignore` (Next.js adds it by default).

- [ ] **Step 2: Start the dev server**

Run: `bun run dev`

- [ ] **Step 3: Test the happy path**

Open `http://localhost:3000`. Send: "Create a Python script that prints hello world and save it to hello.py"

Verify:
- User message appears right-aligned
- Assistant text streams in with markdown rendering
- Tool indicators appear (e.g., "write" with running state, then completed)
- After the agent finishes, the submit button re-enables

- [ ] **Step 4: Test multi-turn**

Send a follow-up: "Now modify it to accept a name argument"

Verify:
- The message appends to the existing conversation
- The agent references the prior context (knows about hello.py)
- Tool indicators appear for the edit

- [ ] **Step 5: Fix any issues found during testing**

If components don't render correctly, check:
- `MessageResponse` children prop — must be a string, not JSX
- `ToolHeader` type/state values — must match the ai-elements expected types
- SSE parsing — check browser Network tab for the event stream format

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during e2e testing"
```

Only run this step if changes were made. Skip if everything worked.
