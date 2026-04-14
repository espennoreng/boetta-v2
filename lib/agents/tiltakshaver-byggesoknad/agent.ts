import type { AgentModule } from "@/lib/agents/types";
import { composeSystemPrompt } from "@/lib/agents/compose-system-prompt";
import { answerChipsFragment } from "@/lib/agents/shared/prompt-fragments/answer-chips";
import { norwegianRegisters } from "@/lib/agents/norwegian-registers";
import { PERSONA } from "./persona";
import { WORKFLOW } from "./workflow";

const bundles = [norwegianRegisters];

export const tiltakshaverByggesoknadAgent: AgentModule = {
  id: "tiltakshaver-byggesoknad",

  createAgentConfig() {
    return {
      name: "Tiltakshaver Byggesøknad (Stub)",
      model: "claude-haiku-4-5-20251001",
      system: composeSystemPrompt({
        persona: PERSONA,
        workflow: WORKFLOW,
        conventions: [answerChipsFragment],
        toolGuidance: bundles
          .map((b) => b.promptFragment)
          .filter((s): s is string => Boolean(s)),
      }),
      tools: [
        { type: "agent_toolset_20260401" as const },
        ...bundles.flatMap((b) => b.definitions),
      ],
    };
  },

  async handleToolCall(name, input) {
    const bundle = bundles.find((b) => b.ownsTool(name));
    if (!bundle) throw new Error(`No bundle owns tool ${name}`);
    return bundle.handleToolCall(name, input);
  },

  getDisplayName(name, input) {
    for (const b of bundles) {
      const n = b.getDisplayName(name, input);
      if (n) return n;
    }
    return null;
  },

  ui: {
    newSessionLabel: "Ny søknad",
    sessionGroupLabel: "Mine søknader",
  },
};
