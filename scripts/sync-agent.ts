import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { getAgent } from "@/lib/agents/registry";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
}

const AGENT_TYPE = "kommune-byggesak-saksbehandler";

const client = new Anthropic();

async function syncAgent(): Promise<string> {
  const config = getAgent(AGENT_TYPE).createAgentConfig();
  const tools = config.tools as Parameters<
    typeof client.beta.agents.create
  >[0]["tools"];
  const existingId = process.env.ANTHROPIC_AGENT_ID;

  if (!existingId) {
    const agent = await client.beta.agents.create({
      name: config.name,
      model: config.model,
      system: config.system,
      tools,
    });
    console.log(`✓ Created agent ${agent.id} (v${agent.version})`);
    console.log(`  Add to .env.local: ANTHROPIC_AGENT_ID=${agent.id}`);
    return agent.id;
  }

  const current = await client.beta.agents.retrieve(existingId);
  const updated = await client.beta.agents.update(existingId, {
    version: current.version,
    name: config.name,
    model: config.model,
    system: config.system,
    tools,
  });
  console.log(
    `✓ Updated agent ${updated.id} (v${current.version} → v${updated.version})`,
  );
  return updated.id;
}

async function syncEnvironment(): Promise<string> {
  const existingId = process.env.ANTHROPIC_ENVIRONMENT_ID;

  if (existingId) {
    await client.beta.environments.retrieve(existingId);
    console.log(`✓ Environment ${existingId} exists`);
    return existingId;
  }

  const environment = await client.beta.environments.create({
    name: `${AGENT_TYPE}-env`,
    config: { type: "cloud", networking: { type: "unrestricted" } },
  });
  console.log(`✓ Created environment ${environment.id}`);
  console.log(
    `  Add to .env.local: ANTHROPIC_ENVIRONMENT_ID=${environment.id}`,
  );
  return environment.id;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }
  await syncAgent();
  await syncEnvironment();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
