import type { AgentModule } from "./types";
import { kommuneByggesakSaksbehandlerAgent } from "./kommune-byggesak-saksbehandler/agent";

const agents: Record<string, AgentModule> = {
  "kommune-byggesak-saksbehandler": kommuneByggesakSaksbehandlerAgent,
};

export function getAgent(type: string): AgentModule {
  const agent = agents[type];
  if (!agent) throw new Error(`Unknown agent type: ${type}`);
  return agent;
}

export function listAgentTypes(): string[] {
  return Object.keys(agents);
}
