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
 * - A task reachable through several containers (e.g. both a project and its sub-project) counts
 *   once in each container above it, never twice.
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
  /** The live tasks beneath each container, by id: a task reachable by two paths counts once. */
  const taskSets = new Map<string, Map<string, { weight: number; done: boolean }>>();

  const visit = (id: string): Map<string, { weight: number; done: boolean }> => {
    const none = new Map<string, { weight: number; done: boolean }>();
    const node = byId.get(id);
    if (!node || node.status === "dropped") return none;

    if (node.type === "task") {
      return new Map([
        [id, { weight: node.effort ?? DEFAULT_TASK_EFFORT, done: node.status === "done" }],
      ]);
    }
    if (node.type !== "project" && node.type !== "sub_project") return none;

    const cached = taskSets.get(id);
    if (cached) return cached;
    if (visiting.has(id)) throw new CycleError([...visiting, id]);

    visiting.add(id);
    const tasks = new Map<string, { weight: number; done: boolean }>();
    for (const childId of children.get(id) ?? []) {
      for (const [taskId, t] of visit(childId)) tasks.set(taskId, t);
    }
    visiting.delete(id);

    let done = 0;
    let total = 0;
    for (const t of tasks.values()) {
      total += t.weight;
      if (t.done) done += t.weight;
    }
    results.set(id, {
      progress: total > 0 ? done / total : null,
      doneEffort: done,
      totalEffort: total,
    });
    taskSets.set(id, tasks);
    return tasks;
  };

  for (const n of nodes) {
    if (n.type === "project" || n.type === "sub_project") visit(n.id);
  }
  return results;
}
