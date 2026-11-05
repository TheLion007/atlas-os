import type { ApiEdge, ApiObject, ProgressEntry } from "./api-types";
import { diffDays } from "./dates";
import { rollUpProgress } from "./engine";

/**
 * What the project screens show, derived from the shared graph and the work journal. Nothing here
 * is stored: a card's progress is the same weighted roll-up every other lens uses.
 */

const str = (d: Record<string, unknown> | undefined, k: string): string | null => {
  const v = d?.[k];
  return typeof v === "string" && v ? v : null;
};

const isLive = (n: ApiObject): boolean => n.status !== "dropped";

/** Every object contained, at any depth, in `rootId` (not including it). */
export function descendantsOf(rootId: string, edges: readonly ApiEdge[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "contains") continue;
    const list = children.get(e.from);
    if (list) list.push(e.to);
    else children.set(e.from, [e.to]);
  }
  const out = new Set<string>();
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

export interface ProjectCard {
  id: string;
  title: string;
  /** A stored colour token, or null (the screen then picks a stable one). */
  color: string | null;
  status: ApiObject["status"];
  description: string;
  /** 0–1, or null when there is nothing to measure yet. */
  progress: number | null;
  targetDate: string | null;
  /** Days until the target date (negative once late), or null without one. */
  daysLeft: number | null;
  tasksOpen: number;
  tasksDone: number;
  tasksLate: number;
  subProjects: { id: string; title: string; progress: number | null }[];
}

/** One card per live top-level project, most urgent first. */
export function projectCards(
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
  today: string,
): ProjectCard[] {
  const progress = rollUpProgress(
    nodes.map((n) => ({
      id: n.id,
      type: n.type,
      status: n.status,
      effort: typeof n.details?.effort === "number" ? n.details.effort : null,
    })),
    edges,
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cards: ProjectCard[] = [];
  for (const p of nodes) {
    if (p.type !== "project" || !isLive(p) || p.status === "done") continue;
    const inside = [...descendantsOf(p.id, edges)]
      .map((id) => byId.get(id))
      .filter((n): n is ApiObject => !!n && isLive(n));
    const tasks = inside.filter((n) => n.type === "task");
    const target = str(p.details, "targetDate");
    cards.push({
      id: p.id,
      title: p.title,
      color: p.color,
      status: p.status,
      description: str(p.details, "description") ?? "",
      progress: progress.get(p.id)?.progress ?? null,
      targetDate: target,
      daysLeft: target ? diffDays(today, target) : null,
      tasksOpen: tasks.filter((t) => t.status !== "done").length,
      tasksDone: tasks.filter((t) => t.status === "done").length,
      tasksLate: tasks.filter((t) => t.status !== "done" && (str(t.details, "due") ?? "9") < today)
        .length,
      subProjects: edges
        .filter((e) => e.kind === "contains" && e.from === p.id)
        .map((e) => byId.get(e.to))
        .filter((n): n is ApiObject => !!n && n.type === "sub_project" && isLive(n))
        .map((s) => ({ id: s.id, title: s.title, progress: progress.get(s.id)?.progress ?? null })),
    });
  }
  return cards.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
}

export type BoardColumn = "draft" | "active" | "done";
export const BOARD_COLUMNS: readonly BoardColumn[] = ["draft", "active", "done"];

export interface BoardCard {
  id: string;
  title: string;
  status: BoardColumn;
  due: string | null;
  late: boolean;
  /** The sub-project it sits in, when it is not directly in the project. */
  group: string | null;
}

/** The project's tasks laid out as the three lifecycle columns (dropped tasks are not shown). */
export function projectBoard(
  projectId: string,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
  today: string,
): Record<BoardColumn, BoardCard[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parentOf = new Map<string, string>();
  for (const e of edges) if (e.kind === "contains") parentOf.set(e.to, e.from);
  const out: Record<BoardColumn, BoardCard[]> = { draft: [], active: [], done: [] };
  for (const id of descendantsOf(projectId, edges)) {
    const n = byId.get(id);
    if (!n || n.type !== "task" || n.status === "dropped") continue;
    const parent = parentOf.get(id);
    const parentNode = parent && parent !== projectId ? byId.get(parent) : undefined;
    const due = str(n.details, "due");
    out[n.status].push({
      id,
      title: n.title,
      status: n.status,
      due,
      late: n.status !== "done" && due !== null && due < today,
      group: parentNode && parentNode.type === "sub_project" ? parentNode.title : null,
    });
  }
  const byDue = (a: BoardCard, b: BoardCard) =>
    a.due === b.due
      ? a.title.localeCompare(b.title)
      : a.due === null
        ? 1
        : b.due === null
          ? -1
          : a.due < b.due
            ? -1
            : 1;
  for (const col of BOARD_COLUMNS) out[col].sort(byDue);
  return out;
}

export interface DayBar {
  day: string;
  count: number;
  /** Counts per project, for a stacked bar. */
  byProject: Record<string, number>;
  isToday: boolean;
}

const addDaysIso = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The last `days` days (ending today) with how much progress each one holds. */
export function recentDays(
  progress: readonly ProgressEntry[],
  today: string,
  days = 7,
  projectId?: string,
): DayBar[] {
  const bars: DayBar[] = [];
  const index = new Map<string, DayBar>();
  for (let i = days - 1; i >= 0; i--) {
    const day = addDaysIso(today, -i);
    const bar: DayBar = { day, count: 0, byProject: {}, isToday: i === 0 };
    bars.push(bar);
    index.set(day, bar);
  }
  for (const p of progress) {
    if (projectId && p.projectId !== projectId) continue;
    const bar = index.get(p.day);
    if (!bar) continue;
    bar.count += 1;
    const key = p.projectId ?? "";
    bar.byProject[key] = (bar.byProject[key] ?? 0) + 1;
  }
  return bars;
}

/** Consecutive days with progress, counting back from today (or from yesterday if today is empty). */
export function streak(progress: readonly ProgressEntry[], today: string): number {
  const days = new Set(progress.map((p) => p.day));
  let cursor = days.has(today) ? today : addDaysIso(today, -1);
  let n = 0;
  while (days.has(cursor)) {
    n += 1;
    cursor = addDaysIso(cursor, -1);
  }
  return n;
}

export interface GraphNodeMeta {
  /** The project it belongs to, or null (places, people, decisions with no project…). */
  group: string | null;
  /** 0..1: how far along (projects, sub-projects) or how weighty (the rest). */
  size: number | undefined;
}

/**
 * What the Graph needs to know about every node beyond its type: the project it gathers with and
 * a size. A node belongs to the project that contains it at any depth, or that a note, document
 * or memory is attached to; anything else belongs to none.
 */
export function graphMeta(
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): Map<string, GraphNodeMeta> {
  const progress = rollUpProgress(
    nodes.map((n) => ({
      id: n.id,
      type: n.type,
      status: n.status,
      effort: typeof n.details?.effort === "number" ? n.details.effort : null,
    })),
    edges,
  );
  const group = new Map<string, string>();
  for (const p of nodes) {
    if (p.type !== "project") continue;
    group.set(p.id, p.id);
    for (const id of descendantsOf(p.id, edges)) group.set(id, p.id);
  }
  // Attached material takes the project of whatever it is attached to.
  for (const e of edges) {
    if (e.kind !== "references" && e.kind !== "about") continue;
    const a = group.get(e.from);
    const b = group.get(e.to);
    if (a && !b) group.set(e.to, a);
    else if (b && !a) group.set(e.from, b);
  }
  const out = new Map<string, GraphNodeMeta>();
  for (const n of nodes) {
    let size: number | undefined;
    if (n.type === "project" || n.type === "sub_project")
      size = progress.get(n.id)?.progress ?? 0.25;
    else if (n.type === "task") size = n.status === "done" ? 0.1 : 0.35;
    else if (n.type === "milestone" || n.type === "decision" || n.type === "risk") size = 0.5;
    out.set(n.id, { group: group.get(n.id) ?? null, size });
  }
  return out;
}
