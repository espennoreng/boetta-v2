export interface DynamicSection {
  heading: string;
  body: string;
}

export interface ComposeSystemPromptParams {
  persona: string;
  workflow?: string;
  conventions?: string[];
  toolGuidance?: string[];
  dynamicSections?: DynamicSection[];
}

/**
 * Assembles an agent's system prompt from shared + per-agent fragments.
 *
 * Fixed section order (non-configurable):
 *   1. persona (no heading, required)
 *   2. ## Arbeidsflyt + workflow (optional; skipped if empty/absent)
 *   3. conventions[] (each fragment owns its own ## heading)
 *   4. toolGuidance[] (each fragment owns its own ## heading; no auto-wrapper)
 *   5. dynamicSections[] (rendered as "## <heading>\n\n<body>")
 *
 * Empty arrays/strings skip their section entirely.
 */
export function composeSystemPrompt(
  params: ComposeSystemPromptParams,
): string {
  const parts: string[] = [params.persona];

  if (params.workflow && params.workflow.length > 0) {
    parts.push(`## Arbeidsflyt\n\n${params.workflow}`);
  }

  for (const fragment of params.conventions ?? []) {
    parts.push(fragment);
  }

  for (const fragment of params.toolGuidance ?? []) {
    parts.push(fragment);
  }

  for (const { heading, body } of params.dynamicSections ?? []) {
    parts.push(`## ${heading}\n\n${body}`);
  }

  return parts.join("\n\n");
}
