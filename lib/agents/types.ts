export const CHECKLIST_TYPES = ["RS", "IG", "ET", "FA", "ES", "MB", "NV", "TA"] as const;
export type ChecklistType = (typeof CHECKLIST_TYPES)[number];

export interface Checkpoint {
  SjekkId: number;
  Id: string;
  Kommunenummer: string;
  Eier: string;
  Sjekkpunkttype: string;
  Navn: string;
  NavnNynorsk?: string;
  Beskrivelse?: string;
  Tema: string;
  Lovhjemmel: { Lovhjemmel: string; LovhjemmelUrl?: string }[];
  Prosesskategori: string;
  Milepel: string;
  HarMaskinlesbarRegel: boolean;
  Regel?: string;
  Tiltakstyper: { Kode: string }[];
  Utfall: {
    Utfallverdi: boolean;
    Utfalltype: string;
    Utfalltypekode: string;
    Utfalltekst?: {
      Innholdstype?: string;
      Tittel?: string;
      Beskrivelse?: string;
      TittelNynorsk?: string;
      BeskrivelseNynorsk?: string;
    };
  }[];
  Undersjekkpunkter: Checkpoint[];
  GyldigFra?: string;
  Oppdatert?: string;
  Rekkefolge?: number;
  Metadata?: Record<string, unknown>;
}

export interface CustomToolDefinition {
  type: "custom";
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AgentModule {
  id: string;

  createAgentConfig(): {
    name: string;
    model: string;
    system: string;
    tools: (CustomToolDefinition | { type: "agent_toolset_20260401" })[];
  };

  handleToolCall(name: string, input: Record<string, unknown>): Promise<string>;

  getDisplayName(toolName: string, input?: Record<string, unknown>): string | null;
}
