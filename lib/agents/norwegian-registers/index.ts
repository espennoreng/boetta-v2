// lib/agents/norwegian-registers/index.ts
import type { CustomToolDefinition, ToolBundle } from "@/lib/agents/types";
import { resolvePropertyToolDefinition, resolveProperty } from "./resolve";
import { nveCheckToolDefinition, nveCheck } from "./nve";
import { riksantikvarenCheckToolDefinition, riksantikvarenCheck } from "./riksantikvaren";
import { getDisplayName } from "./display-names";

export const toolDefinitions: CustomToolDefinition[] = [
  resolvePropertyToolDefinition,
  nveCheckToolDefinition,
  riksantikvarenCheckToolDefinition,
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
    case "riksantikvaren_check":
      return riksantikvarenCheck({
        matrikkel_id: input.matrikkel_id as string,
      });
    default:
      throw new Error(`Unknown tool in norwegian-registers: ${name}`);
  }
}

const promptFragment = `## Oppslag i offentlige registre

Før du ber saksbehandleren om faktaopplysninger om eiendommen,
sjekk om svaret finnes i registrene:

1. Identifiser eiendommen. Les adresse eller gnr/bnr fra søknaden.
   Hvis uklart, kall resolve_property først.
2. For spørsmål om flom- eller skredfare, kall nve_check med matrikkel_id
   fra resolve_property og topic "flom" eller "skred".
3. Alle funn fra registrene MÅ presenteres med kilde som markdown-lenke:
   "[NVE Atlas](URL)". Ikke oppgi funn uten kilde.
4. Registrene er INDIKASJON, ikke avgjørelse. Avslutt slike funn med
   "– bør bekreftes i kommunens fagsystem".
5. Hvis et oppslag returnerer error eller findings: null, fall tilbake til
   å spørre saksbehandleren (som før).
6. area_mapped: false på flom betyr "ikke kartlagt", ikke "ikke i sone".
   Rapporter dette presist.
7. For spørsmål om kulturminner, fredning, SEFRAK eller
   kulturmiljø, kall riksantikvaren_check. Registrer hvert
   funn med sin egen link_askeladden i stedet for én samlet
   kilde — saksbehandler vil klikke seg videre til det
   aktuelle kulturminnet.
8. has_any: false betyr ingen registrerte kulturminner på
   eiendommen. Dette utelukker IKKE uregistrerte funn —
   fysisk inspeksjon kan fortsatt avdekke nye kulturminner.`;

export const norwegianRegisters: ToolBundle = {
  id: "norwegian-registers",
  definitions: toolDefinitions,
  ownsTool,
  handleToolCall,
  getDisplayName,
  promptFragment,
};

export { getDisplayName };
