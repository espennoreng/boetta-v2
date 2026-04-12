export interface Citation {
  lovhjemmel: string;
  url: string;
  checkpoint: string;
  description?: string;
}

export function normalizeLovhjemmel(ref: string): string {
  const lower = ref.toLowerCase();
  const match = lower.match(
    /([a-zæøå][a-zæøå0-9]*)\s*[.]*\s*§\s*(\d+[-–]\d+)/,
  );
  if (!match) return "";
  return `${match[1]}§${match[2].replace("–", "-")}`;
}

export function extractCitationsFromToolResult(
  toolName: string,
  resultJson: string,
): Citation[] {
  try {
    const data = JSON.parse(resultJson);
    if (toolName === "get_checkpoint_detail" && data && !data.error) {
      return extractFromCheckpointDetail(data);
    }
    if (toolName === "get_checkpoints" && Array.isArray(data)) {
      return extractFromCheckpointsList(data);
    }
    return [];
  } catch {
    return [];
  }
}

function extractFromCheckpointDetail(cp: {
  Navn?: string;
  Beskrivelse?: string;
  Lovhjemmel?: { Lovhjemmel: string; LovhjemmelUrl?: string }[];
}): Citation[] {
  if (!cp.Lovhjemmel) return [];
  return cp.Lovhjemmel.filter((lh) => lh.Lovhjemmel && lh.LovhjemmelUrl).map(
    (lh) => ({
      lovhjemmel: lh.Lovhjemmel,
      url: lh.LovhjemmelUrl!,
      checkpoint: cp.Navn ?? "",
      description: cp.Beskrivelse,
    }),
  );
}

function extractFromCheckpointsList(
  cps: { Navn?: string; Lovhjemmel?: string[] }[],
): Citation[] {
  const citations: Citation[] = [];
  for (const cp of cps) {
    if (!cp.Lovhjemmel) continue;
    for (const ref of cp.Lovhjemmel) {
      if (ref) {
        citations.push({
          lovhjemmel: ref,
          url: "",
          checkpoint: cp.Navn ?? "",
        });
      }
    }
  }
  return citations;
}

export interface CitationMatch {
  start: number;
  end: number;
  matchedText: string;
  citation: Citation;
}

export function findCitationsInText(
  text: string,
  registry: Map<string, Citation>,
): CitationMatch[] {
  if (registry.size === 0) return [];

  const pattern =
    /([a-zæøåA-ZÆØÅ][a-zæøåA-ZÆØÅ0-9]*)\s*[.]*\s*§\s*(\d+[-–]\d+)/g;

  const matches: CitationMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const key = normalizeLovhjemmel(match[0]);
    const citation = registry.get(key);
    if (citation) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        matchedText: match[0],
        citation,
      });
    }
  }

  return matches;
}

export function buildCitationRegistry(
  citations: Citation[],
): Map<string, Citation> {
  const registry = new Map<string, Citation>();
  for (const c of citations) {
    const key = normalizeLovhjemmel(c.lovhjemmel);
    if (!key) continue;
    const existing = registry.get(key);
    if (!existing || (!existing.url && c.url)) {
      registry.set(key, c);
    }
  }
  return registry;
}
