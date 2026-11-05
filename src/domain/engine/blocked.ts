import type { LifecycleStatus, ObjectType } from "../enums";
import type { EdgeRef } from "../graph-validation";

/**
 * Only schedulable work can be blocked. A `depends_on` between estimates (an actual figure that
 * rests on an assumption) is a data dependency, not a precedence: nothing is "waiting" there.
 */
export const BLOCKABLE_TYPES: readonly ObjectType[] = [
  "project",
  "sub_project",
  "task",
  "milestone",
  "decision",
];

export function isBlockable(type: ObjectType): boolean {
  return BLOCKABLE_TYPES.includes(type);
}

export interface BlockableNode {
  id: string;
  status: LifecycleStatus;
}

export interface BlockedInfo {
  /** Unfinished hard predecessors (draft or active). */
  blockedBy: string[];
  /** Predecessors that were dropped: the dependency can never be satisfied. */
  broken: string[];
}

/**
 * Derived blocked state. `X depends_on Y` means Y must finish before X.
 * Only live objects (draft/active) can be blocked. Objects with neither blockers nor broken
 * dependencies are omitted from the result.
 */
export function computeBlocked(
  nodes: readonly BlockableNode[],
  edges: readonly EdgeRef[],
): Map<string, BlockedInfo> {
  const status = new Map(nodes.map((n) => [n.id, n.status]));
  const out = new Map<string, BlockedInfo>();

  for (const e of edges) {
    if (e.kind !== "depends_on") continue;
    const own = status.get(e.from);
    const pred = status.get(e.to);
    if (own === undefined || pred === undefined) continue;
    if (own === "done" || own === "dropped") continue;
    if (pred === "done") continue;

    const info = out.get(e.from) ?? { blockedBy: [], broken: [] };
    (pred === "dropped" ? info.broken : info.blockedBy).push(e.to);
    out.set(e.from, info);
  }
  return out;
}
