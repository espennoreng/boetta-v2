import Anthropic from "@anthropic-ai/sdk";
import type { FileUIPart } from "ai";

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

function buildContentBlocks(
  text: string,
  files: FileUIPart[],
) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    | { type: "document"; source: { type: "base64"; media_type: string; data: string }; title?: string }
  > = [];

  for (const file of files) {
    // data URLs look like: data:<mediaType>;base64,<data>
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

export async function sendMessageAndStream(
  sessionId: string,
  text: string,
  files: FileUIPart[] = [],
) {
  const stream = await client.beta.sessions.events.stream(sessionId);

  const content = buildContentBlocks(text, files);

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: "user.message",
        content,
      },
    ],
  });

  return stream;
}
