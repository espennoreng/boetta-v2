import { describe, expect, test } from "bun:test";
import {
  agentEnvVarFor,
  allowedAgentsFor,
  getAgent,
  listAgentTypes,
  ORG_TYPE_TO_AGENT_SLUGS,
  type OrgType,
} from "./registry";

describe("registry", () => {
  test("getAgent returns the kommune agent by slug", () => {
    const agent = getAgent("kommune-byggesak-saksbehandler");
    expect(agent.id).toBe("kommune-byggesak-saksbehandler");
  });

  test("getAgent throws on unknown slug", () => {
    expect(() => getAgent("does-not-exist")).toThrow(
      "Unknown agent type: does-not-exist",
    );
  });

  test("listAgentTypes includes the kommune slug", () => {
    const types = listAgentTypes();
    expect(types).toContain("kommune-byggesak-saksbehandler");
  });

  test("allowedAgentsFor('municipality') returns the kommune slug", () => {
    expect(allowedAgentsFor("municipality")).toEqual([
      "kommune-byggesak-saksbehandler",
    ]);
  });

  test("allowedAgentsFor('tiltakshaver') returns the applier slug", () => {
    expect(allowedAgentsFor("tiltakshaver")).toEqual([
      "tiltakshaver-byggesoknad",
    ]);
  });

  test("allowedAgentsFor for unknown type returns empty array", () => {
    expect(allowedAgentsFor("unknown" as OrgType)).toEqual([]);
  });

  test("allowedAgentsFor for null/undefined returns empty array", () => {
    expect(allowedAgentsFor(null as unknown as OrgType)).toEqual([]);
    expect(allowedAgentsFor(undefined as unknown as OrgType)).toEqual([]);
  });

  test("agentEnvVarFor converts slug to UPPER_SNAKE env var", () => {
    expect(agentEnvVarFor("kommune-byggesak-saksbehandler")).toBe(
      "ANTHROPIC_AGENT_ID_KOMMUNE_BYGGESAK_SAKSBEHANDLER",
    );
    expect(agentEnvVarFor("tiltakshaver-byggesoknad")).toBe(
      "ANTHROPIC_AGENT_ID_TILTAKSHAVER_BYGGESOKNAD",
    );
  });

  test("ORG_TYPE_TO_AGENT_SLUGS has entries for both known types", () => {
    expect(ORG_TYPE_TO_AGENT_SLUGS.municipality).toBeDefined();
    expect(ORG_TYPE_TO_AGENT_SLUGS.tiltakshaver).toBeDefined();
  });
});
