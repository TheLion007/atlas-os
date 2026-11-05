import type { ApiObject } from "./api-types";
import { isEdgeAllowed } from "./edge-rules";
import type { EdgeKind, ObjectType } from "./enums";

/**
 * How objects are created from a context. The user never picks an edge kind: creating a task
 * inside a project relates them through the one edge the rules allow between those types.
 * Pure, and built on the same edge matrix the database enforces.
 */

/**
 * Types a person can create by hand. Scenarios stay out (they are the model's fixed variants);
 * a document can be recorded by hand, but is usually created by importing its file.
 */
export const CREATABLE_TYPES = [
  "plan",
  "project",
  "sub_project",
  "task",
  "milestone",
  "decision",
  "risk",
  "note",
  "property",
  "location",
  "person",
  "event",
  "memory",
  "estimate",
  "transaction",
  "document",
] as const satisfies readonly ObjectType[];
export type CreatableType = (typeof CREATABLE_TYPES)[number];

export const isCreatable = (type: ObjectType): type is CreatableType =>
  (CREATABLE_TYPES as readonly ObjectType[]).includes(type);

/** Types an object's category may be changed between ("change category"): comparable structure
 *  containers only. Shared by the client (to offer the picker) and the server (`convertObjectType`
 *  in src/server/objects/service.ts) — kept in exactly one place. */
export const CONVERTIBLE_TYPES = [
  "project",
  "sub_project",
  "plan",
] as const satisfies readonly ObjectType[];
export type ConvertibleType = (typeof CONVERTIBLE_TYPES)[number];
export const isConvertible = (type: ObjectType): type is ConvertibleType =>
  (CONVERTIBLE_TYPES as readonly ObjectType[]).includes(type);

/** Which end of the new edge the created object is, as the API names it. */
export interface ContextRelation {
  kind: EdgeKind;
  /** `in`: the new object is the target (`other → new`). `out`: the source (`new → other`). */
  direction: "in" | "out";
}

/**
 * The relation that ties a new `child` to an existing `parent`, or `null` if none is allowed.
 * Preference order: containment (a project holds its tasks), place (something is located at a
 * location), about (a memory concerns the project it was created in), then a plain reference
 * (a note references what it is about).
 */
export function relationForChild(parent: ObjectType, child: ObjectType): ContextRelation | null {
  if (isEdgeAllowed("contains", parent, child)) return { kind: "contains", direction: "in" };
  if (isEdgeAllowed("located_at", child, parent)) return { kind: "located_at", direction: "out" };
  if (isEdgeAllowed("located_at", parent, child)) return { kind: "located_at", direction: "in" };
  if (isEdgeAllowed("about", child, parent)) return { kind: "about", direction: "out" };
  if (isEdgeAllowed("references", child, parent)) return { kind: "references", direction: "out" };
  return null;
}

/** Types that make sense to create inside `parent`, most useful first. */
export function childTypesFor(parent: ObjectType): CreatableType[] {
  return CREATABLE_TYPES.filter(
    (c) =>
      relationForChild(parent, c) !== null &&
      // A project is created at the top, at a place or inside a plan; inside a project it is a
      // sub-project.
      !(c === "project" && parent !== "location" && parent !== "plan"),
  );
}

/** The few creations offered as buttons on an object; everything else is under "More". */
export const QUICK_CHILDREN: Partial<Record<ObjectType, readonly CreatableType[]>> = {
  plan: ["project"],
  project: ["task", "milestone", "decision", "risk", "memory"],
  sub_project: ["task", "milestone", "decision", "risk", "memory"],
  location: ["location", "project", "property"],
  property: ["note", "event"],
  estimate: ["transaction"],
};
const DEFAULT_QUICK: readonly CreatableType[] = ["note"];

export function quickChildren(parent: ObjectType): CreatableType[] {
  const allowed = new Set(childTypesFor(parent));
  return (QUICK_CHILDREN[parent] ?? DEFAULT_QUICK).filter((t) => allowed.has(t));
}

/**
 * Example data is ordinary data carrying a reserved tag, so demo content and the user's own
 * objects live in one model and can be told apart (and removed) without special tables.
 */
export const EXAMPLE_TAG = "atlas:example";
const RESERVED_PREFIX = "atlas:";

export const isExample = (node: Pick<ApiObject, "tags">): boolean =>
  node.tags.includes(EXAMPLE_TAG);

/** Tags a person sees: reserved tags are bookkeeping and never displayed. */
export const visibleTags = (tags: readonly string[]): string[] =>
  tags.filter((t) => !t.startsWith(RESERVED_PREFIX));
