---
name: managed-agents
description: Build and operate Claude Managed Agents — the Anthropic-hosted agent harness for long-running, autonomous tasks. Use when the user asks about managed agents, agent sessions, agent environments, agent tools, agent events/streaming, agent memory stores, agent vaults, agent outcomes, multi-agent orchestration, or the `ant` CLI for agents. Covers the full API surface including agents, environments, sessions, events, tools, MCP connector, skills, files, permission policies, vaults, outcomes, memory, and multi-agent.
user-invocable: false
---

# Claude Managed Agents

Claude Managed Agents is a pre-built, configurable agent harness that runs in Anthropic-managed infrastructure. Instead of building your own agent loop, tool execution, and runtime, you get a fully managed environment where Claude can read files, run commands, browse the web, and execute code securely.

**Beta status:** All endpoints require the `managed-agents-2026-04-01` beta header. The SDK sets it automatically.

**When to use:** Long-running tasks, async work, cloud-sandboxed execution, minimal infrastructure, stateful sessions.

**When NOT to use:** If you need custom agent loops with fine-grained control, use the Messages API directly.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Agent** | Reusable, versioned config: model + system prompt + tools + MCP servers + skills |
| **Environment** | Container template: packages, networking, pre-installed runtimes |
| **Session** | Running agent instance in an environment. Maintains conversation history. |
| **Events** | Messages exchanged between your app and the agent (SSE-based streaming) |

## API Endpoints & Resources

| Resource | Base URL | Key Operations |
|----------|----------|----------------|
| Agents | `/v1/agents` | create, retrieve, update, archive, list versions |
| Environments | `/v1/environments` | create, retrieve, update, archive, delete |
| Sessions | `/v1/sessions` | create, retrieve, list, archive, delete |
| Events | `/v1/sessions/:id/events` | send (POST), stream (GET `/stream`) |
| Files | `/v1/files` | upload, download, list (scope by session) |
| Vaults | `/v1/vaults` | create, list, archive, delete |
| Credentials | `/v1/vaults/:id/credentials` | create, update, archive, delete |
| Memory Stores | `/v1/memory_stores` | create, list, archive, delete |
| Memories | `/v1/memory_stores/:id/memories` | write, read, update, delete, list, search |
| Session Threads | `/v1/sessions/:id/threads` | list, stream, list events |

## Required Headers

```
x-api-key: $ANTHROPIC_API_KEY
anthropic-version: 2023-06-01
anthropic-beta: managed-agents-2026-04-01
content-type: application/json
```

Research preview features (outcomes, multiagent, memory) additionally require: `managed-agents-2026-04-01-research-preview`

## CLI Tool: `ant`

Install via Homebrew (macOS): `brew install anthropics/tap/ant`
Install via curl (Linux): download from GitHub releases
Install via Go: `go install github.com/anthropics/anthropic-cli/cmd/ant@latest`

Key commands:
- `ant beta:agents create/update/archive`
- `ant beta:environments create/list/archive/delete`
- `ant beta:sessions create/list/archive/delete`
- `ant beta:sessions:events send`
- `ant beta:vaults create/list/archive`
- `ant beta:vaults:credentials create/update/archive`
- `ant beta:memory-stores create/list`
- `ant beta:memory-stores:memories write/list/retrieve/delete`

## SDK Support

All major SDKs support managed agents under `client.beta`:
- **Python**: `pip install anthropic` → `client.beta.agents`, `client.beta.sessions`, etc.
- **TypeScript**: `npm install @anthropic-ai/sdk` → `client.beta.agents`, `client.beta.sessions`, etc.
- **Go**: `go get github.com/anthropics/anthropic-sdk-go` → `client.Beta.Agents`, etc.
- **Java**: `com.anthropic:anthropic-java` → `client.beta().agents()`, etc.
- **C#**: `dotnet add package Anthropic` → `client.Beta.Agents`, etc.
- **Ruby**: `bundle add anthropic` → `client.beta.agents`, etc.
- **PHP**: `composer require anthropic-ai/sdk` → `$client->beta->agents`, etc.

---

## 1. Agent Setup

### Create an Agent

```python
agent = client.beta.agents.create(
    name="Coding Assistant",
    model="claude-sonnet-4-6",
    system="You are a helpful coding assistant.",
    tools=[{"type": "agent_toolset_20260401"}],
)
```

```typescript
const agent = await client.beta.agents.create({
  name: "Coding Assistant",
  model: "claude-sonnet-4-6",
  system: "You are a helpful coding assistant.",
  tools: [{ type: "agent_toolset_20260401" }],
});
```

### Agent Configuration Fields

| Field | Description |
|-------|-------------|
| `name` | Required. Human-readable name. |
| `model` | Required. Claude model ID (all 4.5+ models supported). For fast mode: `{"id": "claude-opus-4-6", "speed": "fast"}` |
| `system` | System prompt defining behavior/persona. |
| `tools` | Array of tools: `agent_toolset_20260401`, `mcp_toolset`, `custom` tools. |
| `mcp_servers` | MCP server connections (type, name, url). |
| `skills` | Domain-specific skill attachments (max 20 per session). |
| `callable_agents` | Other agents this agent can invoke (multi-agent, research preview). |
| `description` | What the agent does. |
| `metadata` | Arbitrary key-value pairs. |

### Update an Agent

Updates create a new version. Pass current `version` for optimistic concurrency. Omitted fields are preserved. Scalar fields replace. Array fields fully replace.

```python
updated = client.beta.agents.update(
    agent.id,
    version=agent.version,
    system="Updated system prompt.",
)
```

### Agent Lifecycle

- **Update**: creates new version (auto-incrementing)
- **List versions**: `client.beta.agents.versions.list(agent.id)`
- **Archive**: `client.beta.agents.archive(agent.id)` — read-only, existing sessions continue

---

## 2. Environments

Environments define the container config. Create once, reuse across sessions. Each session gets its own isolated container instance.

### Create an Environment

```python
environment = client.beta.environments.create(
    name="python-dev",
    config={
        "type": "cloud",
        "networking": {"type": "unrestricted"},
    },
)
```

### Configuration Options

#### Packages
Pre-install packages into the container:

```python
config={
    "type": "cloud",
    "packages": {
        "pip": ["pandas", "numpy", "scikit-learn"],
        "npm": ["express"],
        "apt": ["ffmpeg"],
        "cargo": ["ripgrep@14.0.0"],
        "gem": ["rails:7.1.0"],
        "go": ["golang.org/x/tools/cmd/goimports@latest"],
    },
    "networking": {"type": "unrestricted"},
}
```

Supported package managers: `apt`, `cargo`, `gem`, `go`, `npm`, `pip`

#### Networking

| Mode | Description |
|------|-------------|
| `unrestricted` | Full outbound access (default), except safety blocklist |
| `limited` | Restrict to `allowed_hosts` list. Optional: `allow_mcp_servers`, `allow_package_managers` bools |

```python
config={
    "type": "cloud",
    "networking": {
        "type": "limited",
        "allowed_hosts": ["api.example.com"],
        "allow_mcp_servers": True,
        "allow_package_managers": True,
    },
}
```

### Pre-installed Container Runtimes

| Language | Version | Package Manager |
|----------|---------|-----------------|
| Python | 3.12+ | pip, uv |
| Node.js | 20+ | npm, yarn, pnpm |
| Go | 1.22+ | go modules |
| Rust | 1.77+ | cargo |
| Java | 21+ | maven, gradle |
| Ruby | 3.3+ | bundler, gem |
| PHP | 8.3+ | composer |
| C/C++ | GCC 13+ | make, cmake |

**Container specs:** Ubuntu 22.04 LTS, x86_64, up to 8 GB RAM, up to 10 GB disk.

**Pre-installed databases:** SQLite (local), PostgreSQL client (`psql`), Redis client (`redis-cli`).

**Pre-installed utilities:** git, curl, wget, jq, tar, zip, ssh, tmux, make, cmake, ripgrep, vim, nano, sed, awk, grep, diff, tree, htop.

### Environment Lifecycle
- Persist until archived or deleted
- Multiple sessions can share the same environment
- Not versioned
- Archive: `client.beta.environments.archive(id)` — read-only
- Delete: `client.beta.environments.delete(id)` — only if no sessions reference it

---

## 3. Sessions

A session is a running agent instance within an environment.

### Create a Session

```python
session = client.beta.sessions.create(
    agent=agent.id,
    environment_id=environment.id,
    title="My session",
)
```

#### Pin to a specific agent version:

```python
session = client.beta.sessions.create(
    agent={"type": "agent", "id": agent.id, "version": 1},
    environment_id=environment.id,
)
```

#### With vault credentials (for MCP auth):

```python
session = client.beta.sessions.create(
    agent=agent.id,
    environment_id=environment.id,
    vault_ids=[vault.id],
)
```

#### With file resources:

```python
session = client.beta.sessions.create(
    agent=agent.id,
    environment_id=environment.id,
    resources=[
        {"type": "file", "file_id": file.id, "mount_path": "/workspace/data.csv"},
    ],
)
```

#### With memory stores:

```python
session = client.beta.sessions.create(
    agent=agent.id,
    environment_id=environment.id,
    resources=[
        {
            "type": "memory_store",
            "memory_store_id": store.id,
            "access": "read_write",
            "prompt": "Check before starting any task.",
        },
    ],
)
```

### Session Statuses

| Status | Description |
|--------|-------------|
| `idle` | Waiting for input (initial state) |
| `running` | Actively executing |
| `rescheduling` | Transient error, retrying automatically |
| `terminated` | Ended due to unrecoverable error |

### Session Operations
- **Retrieve**: `client.beta.sessions.retrieve(id)`
- **List**: `client.beta.sessions.list()`
- **Archive**: `client.beta.sessions.archive(id)` — preserves history, no new events
- **Delete**: `client.beta.sessions.delete(id)` — permanent removal (cannot delete running sessions)

---

## 4. Events & Streaming

Communication is event-based. You send user events and receive agent/session events via SSE.

### Sending Events

```python
client.beta.sessions.events.send(
    session.id,
    events=[
        {
            "type": "user.message",
            "content": [{"type": "text", "text": "Your task here"}],
        },
    ],
)
```

### Streaming Events

```python
with client.beta.sessions.events.stream(session.id) as stream:
    client.beta.sessions.events.send(session.id, events=[...])
    for event in stream:
        match event.type:
            case "agent.message":
                for block in event.content:
                    print(block.text, end="")
            case "agent.tool_use":
                print(f"\n[Using tool: {event.name}]")
            case "session.status_idle":
                print("\nAgent finished.")
                break
```

```typescript
const stream = await client.beta.sessions.events.stream(session.id);
await client.beta.sessions.events.send(session.id, { events: [...] });
for await (const event of stream) {
  if (event.type === "agent.message") {
    for (const block of event.content) process.stdout.write(block.text);
  } else if (event.type === "agent.tool_use") {
    console.log(`\n[Using tool: ${event.name}]`);
  } else if (event.type === "session.status_idle") {
    console.log("\nAgent finished.");
    break;
  }
}
```

### User Event Types

| Type | Description |
|------|-------------|
| `user.message` | Text message to the agent |
| `user.interrupt` | Stop the agent mid-execution |
| `user.custom_tool_result` | Response to a custom tool call |
| `user.tool_confirmation` | Approve/deny a tool call (for `always_ask` policies) |
| `user.define_outcome` | Define an outcome for the agent (research preview) |

### Agent Event Types

| Type | Description |
|------|-------------|
| `agent.message` | Text response |
| `agent.thinking` | Agent thinking content |
| `agent.tool_use` | Pre-built tool invocation |
| `agent.tool_result` | Pre-built tool result |
| `agent.mcp_tool_use` | MCP tool invocation |
| `agent.mcp_tool_result` | MCP tool result |
| `agent.custom_tool_use` | Custom tool invocation (you must respond) |
| `agent.thread_context_compacted` | Context was compacted |
| `agent.thread_message_sent` | Multi-agent message sent |
| `agent.thread_message_received` | Multi-agent message received |

### Session Event Types

| Type | Description |
|------|-------------|
| `session.status_running` | Agent is actively processing |
| `session.status_idle` | Agent finished, includes `stop_reason` |
| `session.status_rescheduled` | Transient error, retrying |
| `session.status_terminated` | Unrecoverable error |
| `session.error` | Error with `retry_status` |
| `session.outcome_evaluated` | Outcome evaluation terminal status |
| `session.thread_created` | Multi-agent thread spawned |
| `session.thread_idle` | Multi-agent thread finished |

### Span Event Types (Observability)

| Type | Description |
|------|-------------|
| `span.model_request_start` | Model inference started |
| `span.model_request_end` | Model inference completed, includes `model_usage` token counts |
| `span.outcome_evaluation_start` | Outcome evaluation started |
| `span.outcome_evaluation_ongoing` | Outcome evaluation heartbeat |
| `span.outcome_evaluation_end` | Outcome evaluation completed |

### Interrupting the Agent

```python
client.beta.sessions.events.send(
    session.id,
    events=[
        {"type": "user.interrupt"},
        {
            "type": "user.message",
            "content": [{"type": "text", "text": "Do this instead."}],
        },
    ],
)
```

### Handling Custom Tool Calls

When you receive an `agent.custom_tool_use` event, execute the tool yourself and send back:

```python
client.beta.sessions.events.send(
    session.id,
    events=[
        {
            "type": "user.custom_tool_result",
            "tool_use_id": event.id,
            "content": [{"type": "text", "text": "Tool result here"}],
        },
    ],
)
```

### Tool Confirmation (for `always_ask` policies)

When `session.status_idle` has `stop_reason: requires_action`:

```python
client.beta.sessions.events.send(
    session.id,
    events=[
        {
            "type": "user.tool_confirmation",
            "tool_use_id": event_id,
            "result": "allow",  # or "deny" with "deny_message"
        },
    ],
)
```

---

## 5. Tools

### Agent Toolset (Built-in)

Enable all pre-built tools with `agent_toolset_20260401`:

| Tool | Name | Description |
|------|------|-------------|
| Bash | `bash` | Execute shell commands |
| Read | `read` | Read files |
| Write | `write` | Write files |
| Edit | `edit` | String replacement in files |
| Glob | `glob` | File pattern matching |
| Grep | `grep` | Regex text search |
| Web fetch | `web_fetch` | Fetch URL content |
| Web search | `web_search` | Search the web |

### Configuring Tools

Disable specific tools:
```json
{
  "type": "agent_toolset_20260401",
  "configs": [
    {"name": "web_fetch", "enabled": false},
    {"name": "web_search", "enabled": false}
  ]
}
```

Enable only specific tools:
```json
{
  "type": "agent_toolset_20260401",
  "default_config": {"enabled": false},
  "configs": [
    {"name": "bash", "enabled": true},
    {"name": "read", "enabled": true},
    {"name": "write", "enabled": true}
  ]
}
```

### Custom Tools

Define tools the agent can call but your application executes:

```python
agent = client.beta.agents.create(
    name="Weather Agent",
    model="claude-sonnet-4-6",
    tools=[
        {"type": "agent_toolset_20260401"},
        {
            "type": "custom",
            "name": "get_weather",
            "description": "Get current weather for a location",
            "input_schema": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "City name"},
                },
                "required": ["location"],
            },
        },
    ],
)
```

Custom tool best practices:
- Provide extremely detailed descriptions (3-4+ sentences)
- Consolidate related operations into fewer tools with an `action` parameter
- Use meaningful namespacing in tool names (e.g., `db_query`, `storage_read`)
- Return only high-signal information in responses

---

## 6. Permission Policies

Control whether tools execute automatically or require approval.

| Policy | Behavior |
|--------|----------|
| `always_allow` | Executes automatically (default for agent toolset) |
| `always_ask` | Pauses and waits for `user.tool_confirmation` (default for MCP toolset) |

### Set toolset-level policy:

```python
tools=[{
    "type": "agent_toolset_20260401",
    "default_config": {
        "permission_policy": {"type": "always_ask"},
    },
}]
```

### Override individual tool policy:

```python
tools=[{
    "type": "agent_toolset_20260401",
    "default_config": {"permission_policy": {"type": "always_allow"}},
    "configs": [
        {"name": "bash", "permission_policy": {"type": "always_ask"}},
    ],
}]
```

### MCP toolset permission:

```python
tools=[
    {"type": "agent_toolset_20260401"},
    {
        "type": "mcp_toolset",
        "mcp_server_name": "github",
        "default_config": {"permission_policy": {"type": "always_allow"}},
    },
]
```

---

## 7. MCP Connector

Connect remote MCP servers to agents for external tools and data.

### Declare MCP servers on the agent:

```python
agent = client.beta.agents.create(
    name="GitHub Assistant",
    model="claude-sonnet-4-6",
    mcp_servers=[
        {"type": "url", "name": "github", "url": "https://api.githubcopilot.com/mcp/"},
    ],
    tools=[
        {"type": "agent_toolset_20260401"},
        {"type": "mcp_toolset", "mcp_server_name": "github"},
    ],
)
```

### Provide auth at session creation via vaults:

```python
session = client.beta.sessions.create(
    agent=agent.id,
    environment_id=environment.id,
    vault_ids=[vault.id],
)
```

Only remote MCP servers with HTTP streamable transport are supported.

---

## 8. Vaults & Credentials

Vaults store per-user credentials for MCP server authentication.

### Create a vault:

```python
vault = client.beta.vaults.create(
    display_name="Alice",
    metadata={"external_user_id": "usr_abc123"},
)
```

### Add credentials:

**MCP OAuth** (with auto-refresh):
```python
credential = client.beta.vaults.credentials.create(
    vault_id=vault.id,
    display_name="Alice's Slack",
    auth={
        "type": "mcp_oauth",
        "mcp_server_url": "https://mcp.slack.com/mcp",
        "access_token": "xoxp-...",
        "expires_at": "2026-04-15T00:00:00Z",
        "refresh": {
            "token_endpoint": "https://slack.com/api/oauth.v2.access",
            "client_id": "1234567890.0987654321",
            "scope": "channels:read chat:write",
            "refresh_token": "xoxe-1-...",
            "token_endpoint_auth": {"type": "client_secret_post", "client_secret": "abc123..."},
        },
    },
)
```

**Static bearer** (API keys):
```python
credential = client.beta.vaults.credentials.create(
    vault_id=vault.id,
    display_name="Linear API key",
    auth={
        "type": "static_bearer",
        "mcp_server_url": "https://mcp.linear.app/mcp",
        "token": "lin_api_your_linear_key",
    },
)
```

Constraints:
- One active credential per `mcp_server_url` per vault
- `mcp_server_url` is immutable after creation
- Max 20 credentials per vault
- Secret fields are write-only (never returned in responses)

---

## 9. Skills

Skills are reusable, filesystem-based resources for domain-specific expertise. They load on demand.

### Skill types:
- **Anthropic pre-built**: `xlsx`, `pptx`, `docx`, `pdf` handling
- **Custom**: Organization-authored skills

### Attach skills to an agent:

```python
agent = client.beta.agents.create(
    name="Financial Analyst",
    model="claude-sonnet-4-6",
    skills=[
        {"type": "anthropic", "skill_id": "xlsx"},
        {"type": "custom", "skill_id": "skill_abc123", "version": "latest"},
    ],
)
```

Max 20 skills per session (across all agents in multi-agent setups).

---

## 10. Files

### Upload a file:

```python
file = client.beta.files.upload(file=Path("data.csv"))
```

### Mount files in a session:

```python
session = client.beta.sessions.create(
    agent=agent.id,
    environment_id=environment.id,
    resources=[
        {"type": "file", "file_id": file.id, "mount_path": "/workspace/data.csv"},
    ],
)
```

### Add/remove files on running sessions:

```python
resource = client.beta.sessions.resources.add(session.id, type="file", file_id=file.id)
client.beta.sessions.resources.delete(resource.id, session_id=session.id)
```

### Download session files:

```python
files = client.beta.files.list(scope_id=session.id)
content = client.beta.files.download(files.data[0].id)
content.write_to_file("output.txt")
```

Limits: Max 100 files per session. Mounted files are read-only copies.

---

## 11. Outcomes (Research Preview)

Outcomes elevate sessions from conversation to goal-directed work. Define what "done" looks like with a rubric; a separate grader evaluates and iterates.

**Requires access request:** https://claude.com/form/claude-managed-agents

### Define an outcome:

```python
client.beta.sessions.events.send(
    session.id,
    events=[{
        "type": "user.define_outcome",
        "description": "Build a DCF model for Costco in .xlsx",
        "rubric": {"type": "text", "content": "# DCF Model Rubric\n..."},
        "max_iterations": 5,  # optional, default 3, max 20
    }],
)
```

### Outcome evaluation results:
- `satisfied` — session goes idle
- `needs_revision` — agent iterates
- `max_iterations_reached` — final revision attempt
- `failed` — rubric/task mismatch
- `interrupted` — user interrupted

Deliverables are written to `/mnt/session/outputs/` and retrievable via Files API.

---

## 12. Memory Stores (Research Preview)

Persistent memory across sessions for user preferences, project context, and domain knowledge.

**Requires access request:** https://claude.com/form/claude-managed-agents

### Create a memory store:

```python
store = client.beta.memory_stores.create(
    name="User Preferences",
    description="Per-user preferences and project context.",
)
```

### Seed with content:

```python
client.beta.memory_stores.memories.write(
    memory_store_id=store.id,
    path="/formatting_standards.md",
    content="All reports use GAAP formatting...",
)
```

### Attach to a session:

```python
session = client.beta.sessions.create(
    agent=agent.id,
    environment_id=environment.id,
    resources=[{
        "type": "memory_store",
        "memory_store_id": store.id,
        "access": "read_write",  # or "read_only"
    }],
)
```

Max 8 memory stores per session. Individual memories capped at 100KB.

### Memory tools (auto-available when attached):
`memory_list`, `memory_search`, `memory_read`, `memory_write`, `memory_edit`, `memory_delete`

### Audit trail:
Every mutation creates an immutable memory version (`memver_...`). Supports list, retrieve, and redact operations.

---

## 13. Multi-Agent Orchestration (Research Preview)

One coordinator agent delegates to specialized sub-agents. All share the same container/filesystem but have isolated context windows.

**Requires access request:** https://claude.com/form/claude-managed-agents

### Declare callable agents:

```python
orchestrator = client.beta.agents.create(
    name="Engineering Lead",
    model="claude-sonnet-4-6",
    system="Coordinate engineering work. Delegate review to reviewer, tests to test writer.",
    tools=[{"type": "agent_toolset_20260401"}],
    callable_agents=[
        {"type": "agent", "id": reviewer.id, "version": reviewer.version},
        {"type": "agent", "id": test_writer.id, "version": test_writer.version},
    ],
)
```

- Only one level of delegation (sub-agents cannot call other agents)
- Each agent runs in its own thread with isolated context
- Threads are persistent (coordinator can send follow-ups)
- Session status aggregates all thread statuses

### Multi-agent event types:
- `session.thread_created` — new thread spawned
- `session.thread_idle` — thread finished
- `agent.thread_message_sent` — message to another thread
- `agent.thread_message_received` — message from another thread

### Thread streams:
```python
# List threads
for thread in client.beta.sessions.threads.list(session.id):
    print(f"[{thread.agent_name}] {thread.status}")

# Stream a specific thread
with client.beta.sessions.threads.stream(thread.id, session_id=session.id) as stream:
    for event in stream:
        ...
```

When tool confirmations or custom tool results come from a sub-agent thread, echo the `session_thread_id` in your response.

---

## Rate Limits

| Operation | Limit |
|-----------|-------|
| Create endpoints | 60 req/min per org |
| Read endpoints | 600 req/min per org |

Organization spend limits and tier-based rate limits also apply.

---

## Complete Quickstart Flow

```python
from anthropic import Anthropic

client = Anthropic()

# 1. Create agent
agent = client.beta.agents.create(
    name="Coding Assistant",
    model="claude-sonnet-4-6",
    system="You are a helpful coding assistant.",
    tools=[{"type": "agent_toolset_20260401"}],
)

# 2. Create environment
environment = client.beta.environments.create(
    name="quickstart-env",
    config={"type": "cloud", "networking": {"type": "unrestricted"}},
)

# 3. Create session
session = client.beta.sessions.create(
    agent=agent.id,
    environment_id=environment.id,
)

# 4. Stream and interact
with client.beta.sessions.events.stream(session.id) as stream:
    client.beta.sessions.events.send(
        session.id,
        events=[{
            "type": "user.message",
            "content": [{"type": "text", "text": "Create a hello world script"}],
        }],
    )
    for event in stream:
        match event.type:
            case "agent.message":
                for block in event.content:
                    print(block.text, end="")
            case "agent.tool_use":
                print(f"\n[Using tool: {event.name}]")
            case "session.status_idle":
                print("\n\nDone.")
                break
```

## Branding Guidelines

When referencing Claude in products integrating Managed Agents:
- **Allowed:** "Claude Agent", "Claude", "{YourName} Powered by Claude"
- **Not permitted:** "Claude Code", "Claude Cowork", Claude Code ASCII art/visual elements
