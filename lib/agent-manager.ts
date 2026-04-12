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
  const content = buildContentBlocks(text, files);

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: "user.message",
        content,
      },
    ],
  });

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
