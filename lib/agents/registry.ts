import type { AgentModule } from "./types";
import { byggesakAgent } from "./byggesak/agent";

const agents: Record<string, AgentModule> = {
  byggesak: byggesakAgent,
};

export function getAgent(type: string): AgentModule {
  const agent = agents[type];
  if (!agent) throw new Error(`Unknown agent type: ${type}`);
  return agent;
}

export function listAgentTypes(): string[] {
  return Object.keys(agents);
}
