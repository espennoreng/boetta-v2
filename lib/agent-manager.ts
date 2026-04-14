import Anthropic from "@anthropic-ai/sdk";
import {
  type AttachmentForChat,
  buildContentBlocksFromAttachments,
} from "@/lib/attachments";
import { getAgent, agentEnvVarFor } from "@/lib/agents/registry";
import {
  type Citation,
  extractCitationsFromToolResult,
  buildCitationRegistry,
} from "@/lib/citations";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const client = new Anthropic();

const ownershipQueries = makeQueries(db);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Run \`bun run sync-agent\` and copy the printed ID into .env.local.`,
    );
  }
  return value;
}

export async function interruptSession(sessionId: string): Promise<void> {
  await client.beta.sessions.events.send(sessionId, {
    events: [{ type: "user.interrupt" }],
  });
}

export async function createSession(params: {
  agentType: string;
  clerkOrgId: string;
  clerkUserId: string;
  title?: string;
}): Promise<string> {
  const session = await client.beta.sessions.create({
    agent: requireEnv(agentEnvVarFor(params.agentType)),
    environment_id: requireEnv("ANTHROPIC_ENVIRONMENT_ID"),
    metadata: {
      clerkOrgId: params.clerkOrgId,
      clerkUserId: params.clerkUserId,
    },
    ...(params.title ? { title: params.title } : {}),
  });

  await ownershipQueries.recordSessionOwnership({
    anthropicSessionId: session.id,
    clerkOrgId: params.clerkOrgId,
    clerkUserId: params.clerkUserId,
    agentType: params.agentType,
    title: params.title,
  });

  return session.id;
}


export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}

async function* resolvePendingToolCalls(
  sessionId: string,
  agentModule: ReturnType<typeof getAgent>,
): AsyncGenerator<StreamEvent> {
  // Find the most recent session.status_idle event to check for pending actions
  let pendingIds: string[] | null = null;

  for await (const event of client.beta.sessions.events.list(sessionId, {
    order: "desc",
  })) {
    if (event.type === "session.status_idle") {
      const idleEvent = event as {
        stop_reason?: { type: string; event_ids?: string[] };
      };
      if (
        idleEvent.stop_reason?.type === "requires_action" &&
        idleEvent.stop_reason.event_ids?.length
      ) {
        pendingIds = idleEvent.stop_reason.event_ids;
      }
      break;
    }
  }

  if (!pendingIds) return;

  // Find the pending custom tool use events and execute them
  const pendingSet = new Set(pendingIds);
  const toolEvents: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }> = [];

  for await (const event of client.beta.sessions.events.list(sessionId, {
    order: "desc",
  })) {
    if (
      event.type === "agent.custom_tool_use" &&
      pendingSet.has(event.id)
    ) {
      toolEvents.push(
        event as { id: string; name: string; input: Record<string, unknown> },
      );
      pendingSet.delete(event.id);
    }
    if (pendingSet.size === 0) break;
  }

  const toolResults: Array<{
    type: "user.custom_tool_result";
    custom_tool_use_id: string;
    content: Array<{ type: "text"; text: string }>;
  }> = [];

  for (const toolEvent of toolEvents) {
    const displayName = agentModule.getDisplayName(
      toolEvent.name,
      toolEvent.input,
    );
    // Show the tool call in the UI
    yield {
      type: "tool_use",
      id: toolEvent.id,
      name: toolEvent.name,
      ...(displayName ? { displayName } : {}),
    };

    const result = await agentModule.handleToolCall(
      toolEvent.name,
      toolEvent.input,
    );

    toolResults.push({
      type: "user.custom_tool_result",
      custom_tool_use_id: toolEvent.id,
      content: [{ type: "text", text: result }],
    });

    // Show the tool result in the UI
    yield { type: "tool_result", id: toolEvent.id, result };
  }

  if (toolResults.length > 0) {
    await client.beta.sessions.events.send(sessionId, {
      events: toolResults,
    });
    // Wait for the agent to finish processing, forwarding any events
    const stream = await client.beta.sessions.events.stream(sessionId);
    for await (const event of stream) {
      if (event.type === "session.status_idle") break;
    }
    // Recurse in case the agent called more custom tools
    yield* resolvePendingToolCalls(sessionId, agentModule);
  }
}

/**
 * Caller is responsible for resolving each attachment row's anthropic_file_id
 * (via lib/attachments.resolveAttachmentsForChat) BEFORE invoking. This
 * function will not write to the DB.
 */
export async function* streamWithToolHandling(
  sessionId: string,
  agentType: string,
  text: string,
  attachments: AttachmentForChat[] = [],
): AsyncGenerator<StreamEvent> {
  const agentModule = getAgent(agentType);
  // Resolve any pending tool calls from a previous interrupted session
  yield* resolvePendingToolCalls(sessionId, agentModule);

  const content = buildContentBlocksFromAttachments({ text, attachments });

  try {
    await client.beta.sessions.events.send(sessionId, {
      events: [{ type: "user.message", content }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/file[_\- ]?id|not[_\- ]?found|404/i.test(msg)) {
      const ids = attachments.map((a) => a.anthropicFileId).filter(Boolean);
      throw new Error(
        `events.send rejected with possible stale file_id (${ids.join(",")}): ${msg}`,
      );
    }
    throw err;
  }

  const collectedCitations: Citation[] = [];

  // Loop: each iteration opens a stream and processes events until idle.
  // If idle is due to requires_action (custom tool), we handle it and loop again.
  // If idle is end_turn, we're done.
  while (true) {
    const stream = await client.beta.sessions.events.stream(sessionId);
    let shouldContinue = false;

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
          const displayName = agentModule.getDisplayName(toolEvent.name, toolEvent.input);
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
          const displayName = agentModule.getDisplayName(customEvent.name, customEvent.input);

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

          const extracted = extractCitationsFromToolResult(customEvent.name, result);
          collectedCitations.push(...extracted);

          if (customEvent.name === "resolve_property") {
            try {
              const data = JSON.parse(result);
              if (
                data &&
                typeof data.address === "string" &&
                data.address.length > 0 &&
                !data.candidates
              ) {
                yield { type: "property_address", address: data.address };
              }
            } catch {
              // ignore parse errors — fall back to Haiku title
            }
          }

          await client.beta.sessions.events.send(sessionId, {
            events: [
              {
                type: "user.custom_tool_result",
                custom_tool_use_id: customEvent.id,
                content: [{ type: "text", text: result }],
              },
            ],
          });

          yield { type: "tool_result", id: customEvent.id, result };
          break;
        }

        case "agent.tool_result": {
          const resultEvent = event as { tool_use_id: string };
          yield { type: "tool_result", id: resultEvent.tool_use_id };
          break;
        }

        case "session.status_idle": {
          const idleEvent = event as {
            stop_reason?: { type: string; event_ids?: string[] };
          };
          if (idleEvent.stop_reason?.type === "requires_action") {
            // Custom tool was called — we already handled it above.
            // Re-open stream to continue receiving events.
            shouldContinue = true;
          } else {
            // end_turn or other — we're done
            if (collectedCitations.length > 0) {
              const registry = buildCitationRegistry(collectedCitations);
              yield {
                type: "citations",
                citations: Array.from(registry.values()),
              };
            }
            yield { type: "done" };
            return;
          }
          break;
        }
      }
    }

    if (!shouldContinue) {
      yield { type: "done" };
      return;
    }
  }
}
