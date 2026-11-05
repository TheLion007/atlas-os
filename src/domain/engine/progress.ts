import type { EdgeRef } from "../graph-validation";
import type { LifecycleStatus, ObjectType } from "../enums";

/** Weight of a task with no explicit effort. */
export const DEFAULT_TASK_EFFORT = 1;

export interface ProgressNode {
  id: string;
  type: ObjectType;
  status: LifecycleStatus;
  /** Task effort (weight). Ignored for non-tasks. */
  effort?: number | null;
}

export interface ProgressResult {
  /** 0–1, or `null` when there is no effort to measure ("no data"). */
  progress: number | null;
  doneEffort: number;
  totalEffort: number;
}

export class CycleError extends Error {
  constructor(public readonly nodeIds: readonly string[]) {
    super(`Cycle detected involving: ${nodeIds.join(", ")}`);
    this.name = "CycleError";
  }
}

/**
 * Progress of every project / sub-project, rolled up by weighted effort along `contains` edges.
 *
 * - Only tasks carry effort; a done task counts fully, any other live task counts as zero.
 * - Dropped tasks and dropped sub-projects are excluded from the total, not counted as failures.
 * - A container with no effort beneath it has `progress: null`, never 0 (no data ≠ no progress).
 * - Progress is derived and is never written back to the database.
 */
export function rollUpProgress(
  nodes: readonly ProgressNode[],
  edges: readonly EdgeRef[],
): Map<string, ProgressResult> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "contains") continue;
    const list = children.get(e.from);
    if (list) list.push(e.to);
    else children.set(e.from, [e.to]);
  }

  const results = new Map<string, ProgressResult>();
  const visiting = new Set<string>();

  const visit = (id: string): { done: number; total: number } => {
    const node = byId.get(id);
    if (!node || node.status === "dropped") return { done: 0, total: 0 };

    if (node.type === "task") {
      const weight = node.effort ?? DEFAULT_TASK_EFFORT;
      return { done: node.status === "done" ? weight : 0, total: weight };
    }
    if (node.type !== "project" && node.type !== "sub_project") return { done: 0, total: 0 };

    const cached = results.get(id);
    if (cached) return { done: cached.doneEffort, total: cached.totalEffort };
    if (visiting.has(id)) throw new CycleError([...visiting, id]);

    visiting.add(id);
    let done = 0;
    let total = 0;
    for (const childId of children.get(id) ?? []) {
      const c = visit(childId);
      done += c.done;
      total += c.total;
    }
    visiting.delete(id);

    results.set(id, {
      progress: total > 0 ? done / total : null,
      doneEffort: done,
      totalEffort: total,
    });
    return { done, total };
  };

  for (const n of nodes) {
    if (n.type === "project" || n.type === "sub_project") visit(n.id);
  }
  return results;
}
