import type { ToolBundle } from "@/lib/agents/types";
import {
  byggesakToolDefinitions,
  handleToolCall as byggesakHandleToolCall,
} from "./tools";
import { getDisplayName as byggesakGetDisplayName } from "./display-names";

const toolNames = new Set(byggesakToolDefinitions.map((t) => t.name));

const promptFragment = `## Verktøybruk

- Bruk get_checkpoints med filtre for å holde resultatene små. Filtrer alltid på tiltakstype. Legg til tema for å snevre inn ytterligere.
- Bruk get_checkpoint_detail ett sjekkpunkt om gangen, ikke i bulk.
- Bruk search_checkpoints bare når du ikke kjenner sjekkpunkt-ID eller tema.
- Bruk evaluate_rules etter å ha samlet svar for sjekkpunkter med betingede regler.
- Bruk find_checkpoints_by_law for å finne sjekkpunkter som siterer en bestemt lovhjemmel.`;

export const dibkChecklistsToolBundle: ToolBundle = {
  id: "dibk-checklists",
  definitions: byggesakToolDefinitions,
  ownsTool: (name) => toolNames.has(name),
  handleToolCall: byggesakHandleToolCall,
  getDisplayName: byggesakGetDisplayName,
  promptFragment,
};
