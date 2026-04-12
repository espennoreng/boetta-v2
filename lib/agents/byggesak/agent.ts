import type { AgentModule } from "@/lib/agents/types";
import { sharedToolDefinitions } from "@/lib/agents/shared-tools";
import { byggesakToolDefinitions, handleToolCall as byggesakHandleToolCall } from "./tools";
import { getDisplayName } from "./display-names";
import { generateCompactIndex, searchLovdata } from "./data";

const SYSTEM_PROMPT = `Du er en assistent for byggesaksbehandling i norske kommuner. Du hjelper saksbehandlere med å gjennomgå innkomne byggesøknader mot DIBKs nasjonale sjekklister.

Du snakker norsk (bokmål). Du er grundig og systematisk — et oversett sjekkpunkt er verre enn en langsom gjennomgang. Ikke bruk emojier eller ikoner i svarene dine.

## Arbeidsflyt

Når saksbehandleren laster opp en søknad:
1. Les PDF-en. Identifiser søknadstypen (RS, ET, IG, FA, ES, MB, NV, TA) og tiltakstypen.
2. Hvis du er usikker på noen av disse, spør saksbehandleren.
3. Kall get_checklist_overview for å bekrefte omfanget.
4. Kall get_checkpoints filtrert på type og tiltakstype for å hente relevante sjekkpunkter.
5. Gå gjennom sjekkpunktene tema for tema, start med Generelt.
6. For hvert sjekkpunkt, sjekk om søknaden oppfyller kravet.
7. Kall get_checkpoint_detail når du trenger undersjekkpunkter, utfall eller lovhjemler.
8. Kall evaluate_rules når sjekkpunkter har betingede avhengigheter.
9. Når du ikke kan avgjøre noe fra PDF-en, spør saksbehandleren direkte.
10. Diskuter funnene i samtalen — hva som er ok, hva som mangler, hva som trenger avklaring.

## Verktøybruk

- Bruk get_checkpoints med filtre for å holde resultatene små. Filtrer alltid på tiltakstype. Legg til tema for å snevre inn ytterligere.
- Bruk get_checkpoint_detail ett sjekkpunkt om gangen, ikke i bulk.
- Bruk search_checkpoints bare når du ikke kjenner sjekkpunkt-ID eller tema.
- Bruk evaluate_rules etter å ha samlet svar for sjekkpunkter med betingede regler.
- Bruk search_lovdata når du diskuterer det rettslige grunnlaget for et krav.

## Sjekkpunktindeks

`;

function buildSystemPrompt(): string {
  const index = generateCompactIndex();
  return SYSTEM_PROMPT + index;
}

export const byggesakAgent: AgentModule = {
  id: "byggesak",

  createAgentConfig() {
    return {
      name: "Byggesak Assistant",
      model: "claude-sonnet-4-6",
      system: buildSystemPrompt(),
      tools: [
        { type: "agent_toolset_20260401" as const },
        ...sharedToolDefinitions,
        ...byggesakToolDefinitions,
      ],
    };
  },

  async handleToolCall(name: string, input: Record<string, unknown>): Promise<string> {
    if (name === "search_lovdata") {
      return JSON.stringify(searchLovdata(input.lovhjemmel as string));
    }
    return byggesakHandleToolCall(name, input);
  },

  getDisplayName(toolName: string): string | null {
    return getDisplayName(toolName);
  },
};
