import { ACYCLIC_KINDS, SINGLE_PARENT_KINDS, isEdgeAllowed } from "./edge-rules";
import type { EdgeKind, ObjectType } from "./enums";

export interface EdgeRef {
  kind: EdgeKind;
  from: string;
  to: string;
}

export interface CandidateEdge extends EdgeRef {
  fromType: ObjectType;
  toType: ObjectType;
}

export type EdgeViolationCode =
  "self_edge" | "type_not_allowed" | "duplicate" | "multiple_parents" | "cycle";

export interface EdgeViolation {
  code: EdgeViolationCode;
  message: string;
}

/** True when following `kind` edges from `start` can reach `target`. */
export function canReach(
  edges: readonly EdgeRef[],
  kind: EdgeKind,
  start: string,
  target: string,
): boolean {
  const next = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== kind) continue;
    const list = next.get(e.from);
    if (list) list.push(e.to);
    else next.set(e.from, [e.to]);
  }
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of next.get(id) ?? []) stack.push(n);
  }
  return false;
}

/**
 * Every reason a new edge is illegal against the existing edges. Empty array = acceptable.
 * `existing` must contain only live (non-deleted) edges.
 */
export function validateNewEdge(
  candidate: CandidateEdge,
  existing: readonly EdgeRef[],
): EdgeViolation[] {
  const out: EdgeViolation[] = [];
  const { kind, from, to } = candidate;

  if (from === to) {
    out.push({ code: "self_edge", message: "An object cannot relate to itself." });
    return out;
  }
  if (!isEdgeAllowed(kind, candidate.fromType, candidate.toType)) {
    out.push({
      code: "type_not_allowed",
      message: `A ${candidate.fromType} cannot ${kind} a ${candidate.toType}.`,
    });
  }
  if (existing.some((e) => e.kind === kind && e.from === from && e.to === to)) {
    out.push({ code: "duplicate", message: `This ${kind} relation already exists.` });
  }
  if (SINGLE_PARENT_KINDS.includes(kind) && existing.some((e) => e.kind === kind && e.to === to)) {
    out.push({ code: "multiple_parents", message: "An object can have only one parent." });
  }
  if (ACYCLIC_KINDS.includes(kind) && canReach(existing, kind, to, from)) {
    out.push({ code: "cycle", message: `This ${kind} relation would create a cycle.` });
  }
  return out;
}
