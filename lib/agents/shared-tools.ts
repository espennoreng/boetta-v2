import type { CustomToolDefinition } from "@/lib/agents/types";

export const searchLovdataToolDefinition: CustomToolDefinition = {
  type: "custom",
  name: "search_lovdata",
  description:
    "Find all checkpoints that cite a specific law paragraph. Use when discussing the legal basis for a requirement. Example: 'pbl § 21-2', 'SAK10 § 5-4', 'TEK17 § 9-6'.",
  input_schema: {
    type: "object",
    properties: {
      lovhjemmel: {
        type: "string",
        description:
          "Legal reference to search for, e.g. 'pbl § 21-2', 'SAK10 § 5-4'",
      },
    },
    required: ["lovhjemmel"],
  },
};

export const sharedToolDefinitions: CustomToolDefinition[] = [
  searchLovdataToolDefinition,
];
