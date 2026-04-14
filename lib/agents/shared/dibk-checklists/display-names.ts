const displayNames: Record<string, string> = {
  get_checklist_overview: "Henter sjekkliste-oversikt",
  get_checkpoints: "Henter sjekkpunkter",
  get_checkpoint_detail: "Henter detaljer for sjekkpunkt",
  evaluate_rules: "Evaluerer regler",
  search_checkpoints: "Søker i sjekkpunkter",
  find_checkpoints_by_law: "Finner sjekkpunkter som siterer lovhjemmel",
};

export function getDisplayName(
  toolName: string,
  input?: Record<string, unknown>,
): string | null {
  const base = displayNames[toolName];
  if (!base) return null;
  if (!input) return base;

  switch (toolName) {
    case "get_checklist_overview":
      return input.type ? `${base} (${input.type})` : base;

    case "get_checkpoints":
      if (input.tema) return `${base} — ${input.tema}`;
      if (input.tiltakstype) return `${base} — ${input.tiltakstype}`;
      return base;

    case "get_checkpoint_detail":
      return input.checkpoint_id
        ? `${base} ${input.checkpoint_id}`
        : base;

    case "search_checkpoints":
      return input.query ? `${base}: "${input.query}"` : base;

    case "find_checkpoints_by_law":
      return input.lovhjemmel
        ? `${base}: ${input.lovhjemmel}`
        : base;

    default:
      return base;
  }
}
