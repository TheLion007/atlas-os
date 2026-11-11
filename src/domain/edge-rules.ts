import { OBJECT_TYPES, type EdgeKind, type ObjectType } from "./enums";

/**
 * Which (kind, fromType, toType) combinations are legal. Mirrors the database trigger in
 * db/migrations so the app rejects early and the DB is the backstop. See docs/DATABASE.md.
 */
interface EdgeRule {
  from: readonly ObjectType[];
  to: readonly ObjectType[];
}

const ANY: readonly ObjectType[] = OBJECT_TYPES;
const SCOPED: readonly ObjectType[] = ["project", "sub_project", "task", "milestone", "decision"];
/** A memory has no physical location: its visual context comes from a Project, never a Location
 * (ADR 0002 §3, approved decision). */
const LOCATABLE: readonly ObjectType[] = OBJECT_TYPES.filter(
  (t) => t !== "location" && t !== "memory",
);
const NOT_MEMORY: readonly ObjectType[] = OBJECT_TYPES.filter((t) => t !== "memory");

export const EDGE_RULES: Readonly<Record<EdgeKind, readonly EdgeRule[]>> = {
  contains: [
    {
      from: ["project", "sub_project"],
      to: ["sub_project", "task", "milestone", "risk", "decision", "property", "event"],
    },
    { from: ["location"], to: ["location"] },
    // A task may be cut into sub-tasks.
    { from: ["task"], to: ["task"] },
    // A plan groups several standalone projects (never sub-projects/tasks directly).
    { from: ["plan"], to: ["project"] },
  ],
  depends_on: [{ from: [...SCOPED, "estimate"], to: [...SCOPED, "estimate"] }],
  estimates: [{ from: ["estimate"], to: ANY }],
  funded_by: [{ from: ["project", "sub_project", "property", "estimate"], to: ["estimate"] }],
  located_at: [{ from: LOCATABLE, to: ["location"] }],
  references: [{ from: ANY, to: ANY }],
  // What a memory concerns. Any object except another memory (that is a `references` edge
  // instead, keeping "about" crisp — ADR 0002 §3).
  about: [{ from: ["memory"], to: NOT_MEMORY }],
  // The source material backing a memory's statement.
  supported_by: [{ from: ["memory"], to: ["document"] }],
  // What a memory was extracted from — may be another memory (a synthesised insight).
  derived_from: [{ from: ["memory"], to: ANY }],
};

export function isEdgeAllowed(kind: EdgeKind, from: ObjectType, to: ObjectType): boolean {
  return EDGE_RULES[kind].some((r) => r.from.includes(from) && r.to.includes(to));
}

/** Kinds that must form a forest/DAG (no cycles). */
export const ACYCLIC_KINDS: readonly EdgeKind[] = ["contains", "depends_on"];

/** Kinds where an object may have at most one incoming edge (a single parent). */
export const SINGLE_PARENT_KINDS: readonly EdgeKind[] = ["contains"];
