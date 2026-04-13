// lib/agents/norwegian-registers/display-names.ts
const displayNames: Record<string, string> = {
  resolve_property: "Slår opp eiendom",
  nve_check: "Sjekker NVE-registre",
};

export function getDisplayName(
  toolName: string,
  input?: Record<string, unknown>,
): string | null {
  const base = displayNames[toolName];
  if (!base) return null;
  if (!input) return base;
  switch (toolName) {
    case "resolve_property":
      if (input.address) return `${base}: ${input.address}`;
      if (input.knr && input.gnr && input.bnr) {
        return `${base}: ${input.knr}-${input.gnr}-${input.bnr}`;
      }
      return base;
    case "nve_check":
      return input.topic ? `${base} (${input.topic})` : base;
    default:
      return base;
  }
}
