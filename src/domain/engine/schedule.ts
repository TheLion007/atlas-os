import { addDays, diffDays, maxDate } from "../dates";
import type { EdgeRef } from "../graph-validation";
import { CycleError } from "./progress";

export interface ScheduleNode {
  id: string;
  /** The date the owner planned (milestone date / task due). `null` if undated. */
  date: string | null;
  /** The baseline the slip is measured against. Falls back to the planned date. */
  baselineDate?: string | null;
}

export interface ScheduleEdge extends EdgeRef {
  /** Lag after the predecessor, in days (may be negative for lead). Defaults to 0. */
  lagDays?: number | null;
}

export interface ScheduledItem {
  id: string;
  /** Planned date after applying any override, before dependency propagation. */
  plannedDate: string | null;
  /** Date after dependency propagation. `null` when nothing dated constrains it. */
  scheduledDate: string | null;
  /** scheduledDate − baseline, in days; `null` when either side is unknown. */
  slipDays: number | null;
  /** The predecessor that pushed the date later than planned, if any (for "explain this delay"). */
  drivenBy: string | null;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Forward-propagates dates along `depends_on` edges (`X depends_on Y`: Y precedes X).
 *
 *   scheduled(X) = max( planned(X), max over predecessors P of scheduled(P) + lag(P→X) )
 *
 * Phase 3 models point-in-time dates, so all four dependency types reduce to
 * "predecessor date + lag". Start/finish semantics arrive with task durations (Timeline phase).
 *
 * `overrides` replace a node's planned date without touching the committed data; this is what
 * `simulate` uses to preview a change. Throws {@link CycleError} on a dependency cycle.
 */
export function computeSchedule(
  nodes: readonly ScheduleNode[],
  edges: readonly ScheduleEdge[],
  overrides: ReadonlyMap<string, string | null> = new Map(),
): Map<string, ScheduledItem> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const preds = new Map<string, { id: string; lag: number }[]>();
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const succs = new Map<string, string[]>();

  for (const e of edges) {
    if (e.kind !== "depends_on") continue;
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) continue;
    pushTo(preds, e.from, { id: e.to, lag: e.lagDays ?? 0 });
    pushTo(succs, e.to, e.from);
    indegree.set(e.from, (indegree.get(e.from) ?? 0) + 1);
  }

  // Kahn's algorithm: predecessors are always resolved before their dependants.
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const s of succs.get(id) ?? []) {
      const d = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, d);
      if (d === 0) queue.push(s);
    }
  }
  if (order.length !== nodes.length) {
    const stuck = nodes.map((n) => n.id).filter((id) => !order.includes(id));
    throw new CycleError(stuck);
  }

  const result = new Map<string, ScheduledItem>();
  for (const id of order) {
    const node = nodeById.get(id) as ScheduleNode;
    const planned = overrides.has(id) ? (overrides.get(id) ?? null) : node.date;

    let scheduled = planned;
    let drivenBy: string | null = null;
    for (const p of preds.get(id) ?? []) {
      const predDate = result.get(p.id)?.scheduledDate;
      if (!predDate) continue;
      const constraint = addDays(predDate, p.lag);
      if (scheduled === null || maxDate(scheduled, constraint) !== scheduled) {
        scheduled = constraint;
        drivenBy = p.id;
      }
    }

    const baseline = node.baselineDate ?? node.date;
    result.set(id, {
      id,
      plannedDate: planned,
      scheduledDate: scheduled,
      slipDays: scheduled !== null && baseline ? diffDays(baseline, scheduled) : null,
      drivenBy: planned !== null && scheduled === planned ? null : drivenBy,
    });
  }
  return result;
}
