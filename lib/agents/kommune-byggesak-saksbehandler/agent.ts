import type { AgentModule } from "@/lib/agents/types";
import { composeSystemPrompt } from "@/lib/agents/compose-system-prompt";
import { answerChipsFragment } from "@/lib/agents/shared/prompt-fragments/answer-chips";
import { findingsTableFragment } from "@/lib/agents/shared/prompt-fragments/findings-table";
import { lawCitationsFragment } from "@/lib/agents/shared/prompt-fragments/law-citations";
import { norwegianRegisters } from "@/lib/agents/norwegian-registers";
import { dibkChecklistsToolBundle } from "@/lib/agents/shared/dibk-checklists/tool-bundle";
import { generateCompactIndex } from "@/lib/agents/shared/dibk-checklists/data";
import { PERSONA } from "./persona";
import { WORKFLOW } from "./workflow";

const bundles = [dibkChecklistsToolBundle, norwegianRegisters];

export const kommuneByggesakSaksbehandlerAgent: AgentModule = {
  id: "kommune-byggesak-saksbehandler",

  createAgentConfig() {
    return {
      name: "Kommune Byggesak Saksbehandler",
      model: "claude-sonnet-4-6",
      system: composeSystemPrompt({
        persona: PERSONA,
        workflow: WORKFLOW,
        conventions: [
          answerChipsFragment,
          findingsTableFragment,
          lawCitationsFragment,
        ],
        toolGuidance: bundles
          .map((b) => b.promptFragment)
          .filter((s): s is string => Boolean(s)),
        dynamicSections: [
          { heading: "Sjekkpunktindeks", body: generateCompactIndex() },
        ],
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
    newSessionLabel: "Ny byggesak",
    sessionGroupLabel: "Byggesaker",
  },
};
