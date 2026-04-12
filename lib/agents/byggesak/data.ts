import { readFileSync } from "fs";
import { join } from "path";
import type { Checkpoint, ChecklistType } from "@/lib/agents/types";
import { CHECKLIST_TYPES } from "@/lib/agents/types";

let cache: Record<string, Checkpoint[]> | null = null;

function loadAll(): Record<string, Checkpoint[]> {
  if (cache) return cache;
  cache = {};
  for (const type of CHECKLIST_TYPES) {
    const filePath = join(process.cwd(), "data", "byggesak", `${type}.json`);
    const raw = readFileSync(filePath, "utf-8");
    cache[type] = JSON.parse(raw) as Checkpoint[];
  }
  return cache;
}

export function getChecklistOverview(type: ChecklistType) {
  const data = loadAll();
  const cps = data[type] ?? [];
  const temas = new Map<string, number>();
  const tiltakstyper = new Set<string>();
  for (const cp of cps) {
    temas.set(cp.Tema, (temas.get(cp.Tema) ?? 0) + 1);
    for (const tt of cp.Tiltakstyper) {
      tiltakstyper.add(tt.Kode);
    }
  }
  return {
    type,
    checkpointCount: cps.length,
    temas: Object.fromEntries(temas),
    tiltakstyperCount: tiltakstyper.size,
    tiltakstyper: [...tiltakstyper].sort(),
  };
}

export function getCheckpoints(
  type: ChecklistType,
  tiltakstype?: string,
  tema?: string,
) {
  const data = loadAll();
  let cps = data[type] ?? [];
  if (tiltakstype) {
    cps = cps.filter((cp) =>
      cp.Tiltakstyper.some((tt) => tt.Kode === tiltakstype),
    );
  }
  if (tema) {
    cps = cps.filter((cp) => cp.Tema === tema);
  }
  return cps.map((cp) => ({
    Id: cp.Id,
    Navn: cp.Navn,
    Tema: cp.Tema,
    Lovhjemmel: cp.Lovhjemmel.filter((l) => l.Lovhjemmel),
  }));
}

export function getCheckpointDetail(type: ChecklistType, checkpointId: string) {
  const data = loadAll();
  const cps = data[type] ?? [];
  return cps.find((cp) => cp.Id === checkpointId) ?? null;
}

export function evaluateRules(
  type: ChecklistType,
  answers: Record<string, boolean>,
) {
  const data = loadAll();
  const cps = data[type] ?? [];
  const triggered: { Id: string; Navn: string; Regel: string }[] = [];
  for (const cp of cps) {
    const regel = cp.Regel;
    if (!regel) continue;
    for (const cpId of Object.keys(answers)) {
      if (regel.includes(cpId)) {
        triggered.push({ Id: cp.Id, Navn: cp.Navn, Regel: regel });
        break;
      }
    }
  }
  return triggered;
}

export function searchCheckpoints(query: string, type?: ChecklistType) {
  const data = loadAll();
  const q = query.toLowerCase();
  const results: { type: string; Id: string; Navn: string; Tema: string }[] = [];
  const typesToSearch = type ? [type] : (CHECKLIST_TYPES as readonly string[]);
  for (const t of typesToSearch) {
    for (const cp of data[t] ?? []) {
      if (
        cp.Navn.toLowerCase().includes(q) ||
        (cp.Beskrivelse ?? "").toLowerCase().includes(q)
      ) {
        results.push({ type: t, Id: cp.Id, Navn: cp.Navn, Tema: cp.Tema });
      }
    }
  }
  return results;
}

export function searchLovdata(lovhjemmel: string) {
  const data = loadAll();
  const ref = lovhjemmel.toLowerCase();
  const results: { type: string; Id: string; Navn: string }[] = [];
  for (const [t, cps] of Object.entries(data)) {
    for (const cp of cps) {
      for (const lh of cp.Lovhjemmel) {
        if (lh.Lovhjemmel.toLowerCase().includes(ref)) {
          results.push({ type: t, Id: cp.Id, Navn: cp.Navn });
          break;
        }
      }
    }
  }
  return results;
}

export function generateCompactIndex(): string {
  const data = loadAll();
  const idMap = new Map<string, { types: Set<string>; tema: string; navn: string }>();
  for (const [type, cps] of Object.entries(data)) {
    for (const cp of cps) {
      const existing = idMap.get(cp.Id);
      if (existing) {
        existing.types.add(type);
      } else {
        idMap.set(cp.Id, { types: new Set([type]), tema: cp.Tema, navn: cp.Navn });
      }
    }
  }
  const lines = ["checklist_types|id|tema|name"];
  for (const [id, info] of idMap) {
    lines.push(`${[...info.types].sort().join(",")}|${id}|${info.tema}|${info.navn}`);
  }
  return lines.join("\n");
}
