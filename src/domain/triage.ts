/**
 * The assistant's automatic sorting: loose ideas, one per line, are ranked into the project they
 * belong to, a new project or sub-project when a line says so ("Projet : …", "Sous-projet : …"),
 * or an inbox when nothing fits. No model involved: lines are matched to existing projects by the
 * words they share with the project's name and its tasks, so what it proposes is explainable.
 */

export interface TriageProject {
  id: string;
  title: string;
  /** Titles of the project's tasks, to recognise its vocabulary. */
  words: readonly string[];
}

export interface TriageItem {
  title: string;
  /** "Urgent", "vite", "demain"… in the line. */
  high: boolean;
}

export type TriageGroup =
  | { kind: "new-project"; name: string; items: TriageItem[] }
  | { kind: "new-sub"; name: string; items: TriageItem[]; under: string | null }
  | { kind: "existing"; projectId: string; name: string; items: TriageItem[] }
  | { kind: "inbox"; items: TriageItem[] };

const STOP = new Set([
  "pour",
  "avec",
  "dans",
  "sans",
  "sur",
  "les",
  "des",
  "une",
  "aux",
  "the",
  "and",
  "for",
  "with",
  "faire",
  "plus",
  "tout",
  "mon",
  "ton",
  "son",
  "nos",
  "vos",
  "leur",
  "page",
  "projet",
]);

export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function tokens(s: string): string[] {
  return norm(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

const HEADER = /^(nouveau |new )?(sous[- ]?projet|sub[- ]?project|projet|project)\s*:\s*(.*)$/;
const URGENT = /\b(urgent|urgente|vite|asap|demain|tout de suite|today|tomorrow)\b/;

/** Splits the pasted text into clean lines (bullets and numbering stripped). */
export function ideaLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s\-*•–—>]+|^\d+[.)]\s+/, "").trim())
    .filter(Boolean);
}

export function triage(text: string, projects: readonly TriageProject[]): TriageGroup[] {
  const vocab = projects.map((p) => ({
    p,
    own: new Set(tokens(p.title)),
    other: new Set(p.words.flatMap(tokens)),
  }));
  const groups: TriageGroup[] = [];
  const existing = new Map<string, Extract<TriageGroup, { kind: "existing" }>>();
  let inbox: Extract<TriageGroup, { kind: "inbox" }> | null = null;
  // The "Projet : …" header the following lines belong to, until a line clearly belongs elsewhere.
  let current: Extract<TriageGroup, { kind: "new-project" | "new-sub" }> | null = null;
  let lastNewProject: string | null = null;

  for (const line of ideaLines(text)) {
    const low = norm(line);
    const h = HEADER.exec(low);
    if (h) {
      const name = line.slice(line.indexOf(":") + 1).trim();
      if (!name) continue;
      const sub = /sous|sub/.test(h[2] ?? "");
      current = sub
        ? { kind: "new-sub", name, items: [], under: lastNewProject }
        : { kind: "new-project", name, items: [] };
      if (!sub) lastNewProject = name;
      groups.push(current);
      continue;
    }
    const item: TriageItem = { title: line, high: URGENT.test(low) };
    const words = new Set(tokens(line));
    let best: { p: TriageProject; score: number } | null = null;
    for (const v of vocab) {
      let score = 0;
      for (const w of words) score += v.own.has(w) ? 3 : v.other.has(w) ? 1 : 0;
      if (score > 0 && (!best || score > best.score)) best = { p: v.p, score };
    }
    if (best) {
      let g = existing.get(best.p.id);
      if (!g) {
        g = { kind: "existing", projectId: best.p.id, name: best.p.title, items: [] };
        existing.set(best.p.id, g);
        groups.push(g);
      }
      g.items.push(item);
    } else if (current) {
      current.items.push(item);
    } else {
      if (!inbox) {
        inbox = { kind: "inbox", items: [] };
        groups.push(inbox);
      }
      inbox.items.push(item);
    }
  }
  // An empty header is still worth creating; the rest is only shown when it holds something.
  return groups.filter(
    (g) => g.items.length > 0 || g.kind === "new-project" || g.kind === "new-sub",
  );
}

export function triageCount(groups: readonly TriageGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0);
}

/**
 * The same proposal, kept inside the element the assistant was opened from: nothing goes to
 * another project or to the inbox. In a project or a sub-project, a "Projet :" line becomes a
 * sub-project of it; in a task, every line becomes one of its sub-tasks.
 */
export function triageInScope(
  groups: readonly TriageGroup[],
  scope: { id: string; name: string; kind: "project" | "sub" | "task" },
): TriageGroup[] {
  const here = (items: TriageItem[]): TriageGroup => ({
    kind: "existing",
    projectId: scope.id,
    name: scope.name,
    items,
  });
  if (scope.kind === "task") {
    const items = groups.flatMap((g) =>
      (g.kind === "new-project" || g.kind === "new-sub") && g.items.length === 0
        ? [{ title: g.name, high: false }]
        : g.items,
    );
    return items.length ? [here(items)] : [];
  }
  const loose = groups.flatMap((g) => (g.kind === "inbox" || g.kind === "existing" ? g.items : []));
  return [
    ...(loose.length ? [here(loose)] : []),
    ...groups.flatMap<TriageGroup>((g) =>
      g.kind === "new-project"
        ? [{ kind: "new-sub", name: g.name, items: g.items, under: null }]
        : g.kind === "new-sub"
          ? [g]
          : [],
    ),
  ];
}
