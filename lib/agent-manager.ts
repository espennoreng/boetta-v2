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
