// lib/agents/norwegian-registers/index.ts
import type { CustomToolDefinition } from "@/lib/agents/types";
import { resolvePropertyToolDefinition, resolveProperty } from "./resolve";
import { nveCheckToolDefinition, nveCheck } from "./nve";

export const toolDefinitions: CustomToolDefinition[] = [
  resolvePropertyToolDefinition,
  nveCheckToolDefinition,
];

const toolNames = new Set(toolDefinitions.map((t) => t.name));

export function ownsTool(name: string): boolean {
  return toolNames.has(name);
}

export async function handleToolCall(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "resolve_property":
      try {
        return JSON.stringify(
          await resolveProperty({
            address: input.address as string | undefined,
            knr: input.knr as string | undefined,
            gnr: input.gnr as number | undefined,
            bnr: input.bnr as number | undefined,
            festenummer: input.festenummer as number | undefined,
          }),
        );
      } catch (err) {
        return JSON.stringify({
          source: "Kartverket",
          source_url: "https://ws.geonorge.no/adresser/v1/sok",
          findings: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    case "nve_check":
      return nveCheck({
        matrikkel_id: input.matrikkel_id as string,
        topic: input.topic as "flom" | "skred",
      });
    default:
      throw new Error(`Unknown tool in norwegian-registers: ${name}`);
  }
}

export { getDisplayName } from "./display-names";
