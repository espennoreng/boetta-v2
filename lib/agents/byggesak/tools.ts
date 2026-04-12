import type { CustomToolDefinition, ChecklistType } from "@/lib/agents/types";
import { CHECKLIST_TYPES } from "@/lib/agents/types";
import {
  getChecklistOverview,
  getCheckpoints,
  getCheckpointDetail,
  evaluateRules,
  searchCheckpoints,
  searchLovdata,
} from "./data";

const checklistTypeEnum = [...CHECKLIST_TYPES];

export const byggesakToolDefinitions: CustomToolDefinition[] = [
  {
    type: "custom",
    name: "get_checklist_overview",
    description:
      "Get a summary of a checklist type — how many checkpoints, which temas (categories), and which tiltakstyper (project types) it covers. Use at the start of a review to orient.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: checklistTypeEnum,
          description: "Checklist type code",
        },
      },
      required: ["type"],
    },
  },
  {
    type: "custom",
    name: "get_checkpoints",
    description:
      "Get a filtered list of checkpoints. Returns a compact list with ID, name, tema, and legal references. Always specify type. Use tiltakstype and/or tema to narrow results — without filters a full checklist can be 130 items.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: checklistTypeEnum,
          description: "Checklist type code",
        },
        tiltakstype: {
          type: "string",
          description:
            "Project type code to filter by, e.g. 'nyttbyggboligformal', 'rivinghelebygg', 'bruksendring'",
        },
        tema: {
          type: "string",
          description:
            "Category to filter by, e.g. 'Generelt', 'Plan', 'Ansvar og gjennomføring'",
        },
      },
      required: ["type"],
    },
  },
  {
    type: "custom",
    name: "get_checkpoint_detail",
    description:
      "Get full details for a single checkpoint including sub-checkpoints (undersjekkpunkter), outcomes (utfall), conditional rules, and legal references. Use after get_checkpoints to drill into a specific item.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: checklistTypeEnum,
          description: "Checklist type code",
        },
        checkpoint_id: {
          type: "string",
          description: "The checkpoint Id, e.g. '1.1', '3.12', '17.10'",
        },
      },
      required: ["type", "checkpoint_id"],
    },
  },
  {
    type: "custom",
    name: "evaluate_rules",
    description:
      "Given a checklist type and a set of known answers (checkpoint_id: true/false), evaluate the conditional rules to determine which additional checkpoints are triggered or skipped. Use after collecting answers for checkpoints that have dependencies.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: checklistTypeEnum,
          description: "Checklist type code",
        },
        answers: {
          type: "object",
          description:
            "Map of checkpoint_id to boolean, e.g. {'3.1': true, '1.12': false}",
        },
      },
      required: ["type", "answers"],
    },
  },
  {
    type: "custom",
    name: "search_checkpoints",
    description:
      "Text search across checkpoint names and descriptions. Use for open-ended questions when you don't know the exact tema or checkpoint ID.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search text in Norwegian",
        },
        type: {
          type: "string",
          enum: checklistTypeEnum,
          description: "Optional: limit search to one checklist type",
        },
      },
      required: ["query"],
    },
  },
];

export async function handleToolCall(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "get_checklist_overview":
      return JSON.stringify(
        getChecklistOverview(input.type as ChecklistType),
      );

    case "get_checkpoints":
      return JSON.stringify(
        getCheckpoints(
          input.type as ChecklistType,
          input.tiltakstype as string | undefined,
          input.tema as string | undefined,
        ),
      );

    case "get_checkpoint_detail": {
      const detail = getCheckpointDetail(
        input.type as ChecklistType,
        input.checkpoint_id as string,
      );
      if (!detail) {
        return JSON.stringify({ error: "Checkpoint not found" });
      }
      return JSON.stringify(detail);
    }

    case "evaluate_rules":
      return JSON.stringify(
        evaluateRules(
          input.type as ChecklistType,
          input.answers as Record<string, boolean>,
        ),
      );

    case "search_checkpoints":
      return JSON.stringify(
        searchCheckpoints(
          input.query as string,
          input.type as ChecklistType | undefined,
        ),
      );

    case "search_lovdata":
      return JSON.stringify(
        searchLovdata(input.lovhjemmel as string),
      );

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
