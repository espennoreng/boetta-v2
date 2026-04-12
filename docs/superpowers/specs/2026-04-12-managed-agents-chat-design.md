# Managed Agents Chat Interface — MVP Design

## Goal

A minimal chat interface that connects to Claude Managed Agents. Users send text messages, watch the agent work (with tool call indicators), and can continue the conversation across multiple turns.

## Decisions

- **Interaction model:** Multi-turn conversational. User sends follow-ups after the agent goes idle.
- **Agent config:** Hardcoded. Sonnet 4.6, agent_toolset_20260401, unrestricted networking.
- **Agent/env lifecycle:** Lazy-created on first request, cached in memory.
- **Tool display:** Text + tool indicators (name and status badge). No expandable details.
- **Architecture:** Anthropic SDK on server, custom React hook on client, ai-elements for rendering.
- **No file uploads, no sidebar, no session list, no interrupt support.** Single session per page load.

## Architecture

```
Browser (React)
  useAgentChat hook
    POST /api/chat → SSE stream
  ai-elements components

Next.js API Route (/api/chat)
  AgentManager (module singleton)
    lazy-creates agent + environment
    creates sessions
    proxies SSE events

Managed Agents API
  agent + environment + session
```

## Server

### AgentManager (`lib/agent-manager.ts`)

Module-level singleton with cached IDs. Three functions:

**`getAgentId()`** — Creates the agent on first call, returns cached ID after.
- Model: `claude-sonnet-4-6`
- Tools: `[{ type: "agent_toolset_20260401" }]`
- System: `"You are a helpful coding assistant. Write clean, well-documented code."`

**`getEnvironmentId()`** — Creates the environment on first call, returns cached ID after.
- Config: `{ type: "cloud", networking: { type: "unrestricted" } }`

**`createSession()`** — Creates a new session referencing cached agent + environment. Returns session ID.

**`sendMessageAndStream(sessionId, text)`** — Opens the SSE stream via the SDK, sends the user message event, returns the SDK stream object.

### API Route (`app/api/chat/route.ts`)

Single `POST` handler.

**Request:** `{ message: string, sessionId?: string }`

**Behavior:**
1. If no sessionId, calls `createSession()`.
2. Calls `sendMessageAndStream(sessionId, message)`.
3. Transforms Managed Agents events into simplified SSE for the client:
   - `agent.message` → `{ type: "text", text: "..." }`
   - `agent.tool_use` → `{ type: "tool_use", name: "bash", id: "..." }`
   - `agent.tool_result` → `{ type: "tool_result", id: "...", output: "..." }`
   - `session.status_idle` → `{ type: "done" }`
   - All other events are ignored.
4. Returns sessionId via `x-session-id` response header.

**Response:** `ReadableStream` with `Content-Type: text/event-stream`.

## Client

### useAgentChat hook (`hooks/use-agent-chat.ts`)

Custom React hook. No external dependencies beyond React.

**State:**
```typescript
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  id: string;
  name: string;
  state: "running" | "completed";
}

type Status = "idle" | "streaming";
```

- `messages: ChatMessage[]`
- `sessionId: string | null` — null until first response
- `status: Status`

**`sendMessage(text: string)`:**
1. Appends user message to state.
2. Appends empty assistant message (filled by stream).
3. POSTs to `/api/chat` with `{ message, sessionId }`.
4. Reads `x-session-id` from response header, stores it.
5. Reads SSE stream, updates current assistant message:
   - `text` → append to `assistant.text`
   - `tool_use` → push to `assistant.toolCalls` with state `"running"`
   - `tool_result` → update matching toolCall to `"completed"`
   - `done` → set status to `"idle"`

**Returns:** `{ messages, status, sendMessage }`

SSE reading: fetch-based, `ReadableStream` reader with a `while` loop parsing `data:` lines.

### Page (`app/page.tsx`)

Single page wiring the hook to ai-elements components:

```
Conversation
  ConversationContent
    ConversationEmptyState (when messages is empty)
      title: "Chat with Claude"
      description: "Send a message to start a conversation."
    {messages.map →
      if user:
        Message(from="user")
          MessageContent → plain text
      if assistant:
        Message(from="assistant")
          MessageContent
            MessageResponse → streaming markdown rendering
          {toolCalls?.map →
            Tool
              ToolHeader(title=name, state=mapped_state)
          }
    }
  ConversationScrollButton
PromptInput(onSubmit → sendMessage)
  PromptInputBody
    PromptInputTextarea
    PromptInputSubmit (disabled when status === "streaming")
```

**ToolHeader state mapping:**
- `"running"` → `"input-available"` (shows pulsing clock + "Running")
- `"completed"` → `"output-available"` (shows green check + "Completed")

## Files to Create

| File | Purpose |
|------|---------|
| `lib/agent-manager.ts` | Managed Agents singleton (agent, env, session creation) |
| `app/api/chat/route.ts` | POST handler, SSE proxy |
| `hooks/use-agent-chat.ts` | React hook for chat state + streaming |
| `app/page.tsx` | Chat UI (replace starter template) |

## Out of Scope (Future)

- File uploads/attachments
- Session persistence/list/sidebar
- Agent configuration UI
- Interrupt/steering mid-execution
- Expandable tool call details
- Dark mode toggle (already supported via CSS, just no toggle)
- Error handling beyond basic try/catch
