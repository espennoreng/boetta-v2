const displayNames: Record<string, string> = {
  get_checklist_overview: "Henter sjekkliste-oversikt",
  get_checkpoints: "Henter sjekkpunkter",
  get_checkpoint_detail: "Henter detaljer for sjekkpunkt",
  evaluate_rules: "Evaluerer regler",
  search_checkpoints: "Søker i sjekkpunkter",
  search_lovdata: "Søker i lovhjemler",
};

export function getDisplayName(toolName: string): string | null {
  return displayNames[toolName] ?? null;
}
