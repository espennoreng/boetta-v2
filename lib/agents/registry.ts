import type { AgentModule } from "./types";
import { kommuneByggesakSaksbehandlerAgent } from "./kommune-byggesak-saksbehandler/agent";
import { tiltakshaverByggesoknadAgent } from "./tiltakshaver-byggesoknad/agent";

const agents: Record<string, AgentModule> = {
  "kommune-byggesak-saksbehandler": kommuneByggesakSaksbehandlerAgent,
  "tiltakshaver-byggesoknad": tiltakshaverByggesoknadAgent,
};

export type OrgType = "municipality" | "tiltakshaver";

/**
 * Static mapping from Clerk org type to the set of agent slugs that type
 * unlocks. Each slug listed here must also be present in `agents` above.
 *
 * Adding a new agent: register in `agents`, then add the slug to the
 * appropriate org type's array.
 */
export const ORG_TYPE_TO_AGENT_SLUGS: Record<OrgType, string[]> = {
  municipality: ["kommune-byggesak-saksbehandler"],
  tiltakshaver: ["tiltakshaver-byggesoknad"],
};

export function getAgent(type: string): AgentModule {
  const agent = agents[type];
  if (!agent) throw new Error(`Unknown agent type: ${type}`);
  return agent;
}

export function listAgentTypes(): string[] {
  return Object.keys(agents);
}

/**
 * Returns the list of agent slugs allowed for the given org type.
 * Returns [] for unknown, null, or undefined org types.
 */
export function allowedAgentsFor(orgType: OrgType | null | undefined): string[] {
  if (!orgType) return [];
  return ORG_TYPE_TO_AGENT_SLUGS[orgType] ?? [];
}

/**
 * Translates a slug (e.g. "kommune-byggesak-saksbehandler") to the env var
 * name that holds its Anthropic managed agent ID (e.g.
 * "ANTHROPIC_AGENT_ID_KOMMUNE_BYGGESAK_SAKSBEHANDLER").
 */
export function agentEnvVarFor(slug: string): string {
  return `ANTHROPIC_AGENT_ID_${slug.toUpperCase().replace(/-/g, "_")}`;
}
