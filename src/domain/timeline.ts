import type { ApiEdge, ApiObject } from "./api-types";
import { addDays, diffDays } from "./dates";
import type { LifecycleStatus, ObjectType } from "./enums";
import { CycleError, computeBlocked, isBlockable, computeSchedule } from "./engine";

/**
 * The timeline view-model: rows by project, each with its span, milestones and dated tasks,
 * positioned by the schedule engine (dependency propagation, slip against baseline). Nothing
 * here is stored; changing a scenario or a date simply produces a new model.
 */

export interface TimelineItem {
  id: string;
  type: "milestone" | "task";
  title: string;
  status: LifecycleStatus;
  /** Scheduled date after dependency propagation. */
  date: string;
  /** Baseline, when it differs: a ghost bar is drawn between the two. */
  baselineDate: string | null;
  slipDays: number | null;
  blocked: boolean;
}

export interface TimelineRow {
  id: string;
  title: string;
  type: ObjectType;
  status: LifecycleStatus;
  start: string | null;
  end: string | null;
  items: TimelineItem[];
}

export interface TimelineDependency {
  /** The item that must come first. */
  from: string;
  /** The item that waits. */
  to: string;
}

export interface TimelineModel {
  start: string;
  end: string;
  rows: TimelineRow[];
  dependencies: TimelineDependency[];
}

const str = (d: Record<string, unknown> | undefined, k: string): string | null => {
  const v = d?.[k];
  return typeof v === "string" && v !== "" ? v : null;
};

const yearOf = (iso: string): number => Number(iso.slice(0, 4));
/** The blueprint's default frame is six years from today. */
export const DEFAULT_SPAN_YEARS = 6;

/** Whole calendar years covering today, the default span, and every date supplied. */
export function timelineWindow(
  today: string,
  dates: readonly string[],
): { start: string; end: string } {
  const years = dates.map(yearOf);
  const first = Math.min(yearOf(today), ...years);
  const last = Math.max(yearOf(today) + DEFAULT_SPAN_YEARS, ...years);
  return { start: `${first}-01-01`, end: `${last}-12-31` };
}

export function buildTimeline(
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
  today: string,
): TimelineModel {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map<string, string>();
  for (const e of edges) if (e.kind === "contains") parent.set(e.to, e.from);

  const scheduleNodes = nodes
    .filter((n) => n.type === "milestone" || n.type === "task")
    .map((n) => ({
      id: n.id,
      date: n.type === "milestone" ? str(n.details, "date") : str(n.details, "due"),
      baselineDate: n.type === "milestone" ? str(n.details, "baselineDate") : null,
    }));
  let schedule: ReturnType<typeof computeSchedule>;
  try {
    schedule = computeSchedule(scheduleNodes, edges);
  } catch (e) {
    if (!(e instanceof CycleError)) throw e;
    schedule = computeSchedule(scheduleNodes, []);
  }
  const blocked = computeBlocked(
    nodes.filter((n) => isBlockable(n.type)).map((n) => ({ id: n.id, status: n.status })),
    edges,
  );

  /** The project an item belongs to, climbing through sub-projects. */
  const projectOf = (id: string): string | null => {
    let current: string | undefined = id;
    for (let hops = 0; current && hops < 32; hops++) {
      const n = byId.get(current);
      if (n?.type === "project") return n.id;
      current = parent.get(current);
    }
    return null;
  };

  const rows = new Map<string, TimelineRow>();
  for (const n of nodes) {
    if (n.type !== "project" || n.status === "dropped") continue;
    rows.set(n.id, {
      id: n.id,
      title: n.title,
      type: n.type,
      status: n.status,
      start: str(n.details, "startDate"),
      end: str(n.details, "targetDate"),
      items: [],
    });
  }

  const itemIds = new Set<string>();
  for (const n of nodes) {
    if ((n.type !== "milestone" && n.type !== "task") || n.status === "dropped") continue;
    const s = schedule.get(n.id);
    const date = s?.scheduledDate;
    const row = rows.get(projectOf(n.id) ?? "");
    if (!date || !row) continue;
    const baseline = s?.plannedDate && s.slipDays !== null ? addDays(date, -s.slipDays) : null;
    row.items.push({
      id: n.id,
      type: n.type,
      title: n.title,
      status: n.status,
      date,
      baselineDate: baseline && baseline !== date ? baseline : null,
      slipDays: s?.slipDays ?? null,
      blocked: blocked.has(n.id),
    });
    itemIds.add(n.id);
  }
  for (const row of rows.values())
    row.items.sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title),
    );

  const dependencies: TimelineDependency[] = edges
    .filter((e) => e.kind === "depends_on" && itemIds.has(e.from) && itemIds.has(e.to))
    .map((e) => ({ from: e.to, to: e.from }));

  const ordered = [...rows.values()]
    .filter((r) => r.items.length > 0 || (r.start && r.end))
    .sort(
      (a, b) =>
        (a.start ?? "9999").localeCompare(b.start ?? "9999") || a.title.localeCompare(b.title),
    );

  const dates = ordered.flatMap((r) => [
    ...(r.start ? [r.start] : []),
    ...(r.end ? [r.end] : []),
    ...r.items.flatMap((i) => [i.date, ...(i.baselineDate ? [i.baselineDate] : [])]),
  ]);
  const { start, end } = timelineWindow(today, dates);
  return { start, end, rows: ordered, dependencies };
}

/** Days from the window start, for positioning. */
export const dayIndex = (windowStart: string, iso: string): number => diffDays(windowStart, iso);
