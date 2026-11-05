import type { ApiEdge, ApiObject, ReattachEdge } from "./api-types";
import { isEdgeAllowed } from "./edge-rules";
import type { ObjectType } from "./enums";

/**
 * What deleting an object means, worked out from the graph before anything is written.
 *
 * - `contains` edges form a forest: an object's contained objects (and theirs, all the way down)
 *   go with it when everything is deleted.
 * - Documents, notes and budgets (estimates) are tied to what they are about by `references` or
 *   `estimates` edges rather than contained. They go too when everything they point at goes and
 *   they point at nothing else: a note about two projects survives the deletion of one.
 * - Every other edge (dependencies, locations, memories…) simply disappears with the object: the
 *   database soft-deletes an object's edges with it, so none is left dangling.
 * - Keeping the children: only the object itself goes; what it contained is re-attached to its
 *   own parent when the model allows that edge, or left standing on its own when the type can
 *   live without a parent.
 */

/** Types that hang off what they are about instead of being contained, and go with it. */
export const ATTACHED_TYPES = ["document", "note", "estimate"] as const satisfies ObjectType[];
const ATTACH_KINDS = new Set(["references", "estimates"]);

/** Types that make no sense without a parent: they cannot be left standing alone. */
const NEEDS_PARENT = new Set<ObjectType>(["sub_project"]);

export interface DeletionCounts {
  plans: number;
  projects: number;
  subProjects: number;
  tasks: number;
  milestones: number;
  decisions: number;
  risks: number;
  notes: number;
  documents: number;
  budgets: number;
  others: number;
}

export type Reattach = ReattachEdge;

export interface DeletionPlan {
  root: ApiObject;
  /** The object's parent through `contains`, if any. */
  parentId: string | null;
  /** Everything a full deletion removes, the root first. */
  all: string[];
  /** What goes besides the root (contained objects and attached documents, notes, budgets). */
  others: ApiObject[];
  counts: DeletionCounts;
  /** Total of `others`: zero means the object is alone and can go without asking. */
  extra: number;
  /** Whether "only this one" is offered, and what it would re-attach. */
  canKeepChildren: boolean;
  keep: { ids: string[]; reattach: Reattach[] };
  /** Documents among everything that goes (their files are freed for good after the undo delay). */
  documents: ApiObject[];
}

const emptyCounts = (): DeletionCounts => ({
  plans: 0,
  projects: 0,
  subProjects: 0,
  tasks: 0,
  milestones: 0,
  decisions: 0,
  risks: 0,
  notes: 0,
  documents: 0,
  budgets: 0,
  others: 0,
});

const COUNT_KEY: Partial<Record<ObjectType, keyof DeletionCounts>> = {
  plan: "plans",
  project: "projects",
  sub_project: "subProjects",
  task: "tasks",
  milestone: "milestones",
  decision: "decisions",
  risk: "risks",
  note: "notes",
  document: "documents",
  estimate: "budgets",
};

export function countOf(objects: readonly ApiObject[]): DeletionCounts {
  const counts = emptyCounts();
  for (const o of objects) counts[COUNT_KEY[o.type] ?? "others"] += 1;
  return counts;
}

export function planDeletion(
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
  rootId: string,
): DeletionPlan | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = byId.get(rootId);
  if (!root) return null;

  const childrenOf = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  const outgoing = new Map<string, ApiEdge[]>();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (e.kind === "contains") {
      (childrenOf.get(e.from) ?? childrenOf.set(e.from, []).get(e.from)!).push(e.to);
      parentOf.set(e.to, e.from);
    }
    (outgoing.get(e.from) ?? outgoing.set(e.from, []).get(e.from)!).push(e);
  }

  // Everything contained, at any depth.
  const gone = new Set<string>([rootId]);
  const order = [rootId];
  for (let i = 0; i < order.length; i++) {
    for (const child of childrenOf.get(order[i]!) ?? []) {
      if (gone.has(child)) continue;
      gone.add(child);
      order.push(child);
    }
  }
  // Documents, notes and budgets that point only at what is going.
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (gone.has(n.id) || !(ATTACHED_TYPES as readonly ObjectType[]).includes(n.type)) continue;
      if (parentOf.has(n.id)) continue; // contained somewhere else
      const links = (outgoing.get(n.id) ?? []).filter((e) => ATTACH_KINDS.has(e.kind));
      if (links.length === 0) continue;
      if (links.every((e) => gone.has(e.to))) {
        gone.add(n.id);
        order.push(n.id);
        grew = true;
      }
    }
  }

  const others = order
    .slice(1)
    .map((id) => byId.get(id)!)
    .filter(Boolean);
  const parentId = parentOf.get(rootId) ?? null;
  const parent = parentId ? byId.get(parentId) : null;

  // "Only this one": what the root contains and what is attached to it directly.
  const keepIds = [rootId];
  const reattach: Reattach[] = [];
  let canKeepChildren = others.length > 0;
  const direct = [
    ...(childrenOf.get(rootId) ?? []),
    ...others
      .filter((o) => (ATTACHED_TYPES as readonly ObjectType[]).includes(o.type))
      .filter((o) =>
        (outgoing.get(o.id) ?? []).some((e) => ATTACH_KINDS.has(e.kind) && e.to === rootId),
      )
      .map((o) => o.id),
  ];
  if (canKeepChildren) {
    for (const id of new Set(direct)) {
      const child = byId.get(id)!;
      const contained = parentOf.get(id) === rootId;
      if (contained) {
        if (parent && isEdgeAllowed("contains", parent.type, child.type)) {
          reattach.push({ kind: "contains", from: parent.id, to: id });
        } else if (!parent && !NEEDS_PARENT.has(child.type)) {
          // stands on its own
        } else {
          canKeepChildren = false;
        }
      } else if (parent && isEdgeAllowed("references", child.type, parent.type)) {
        // a document or note that was about the root becomes about its parent
        reattach.push({ kind: "references", from: id, to: parent.id });
      }
      // Attached with no parent: it simply stays, about nothing.
    }
    // Deeper descendants are untouched: they stay under the child that stays.
    if (canKeepChildren && direct.length === 0) canKeepChildren = false;
  }

  return {
    root,
    parentId,
    all: order,
    others,
    counts: countOf(others),
    extra: others.length,
    canKeepChildren,
    keep: { ids: keepIds, reattach: canKeepChildren ? reattach : [] },
    documents: order.map((id) => byId.get(id)!).filter((o) => o.type === "document"),
  };
}

/**
 * A short sentence's worth of the counts, as `[count, key]` pairs for the types that are present,
 * in a stable order (the interface words them, singular or plural).
 */
export const COUNT_ORDER = [
  "plans",
  "projects",
  "subProjects",
  "tasks",
  "milestones",
  "decisions",
  "risks",
  "notes",
  "documents",
  "budgets",
  "others",
] as const satisfies (keyof DeletionCounts)[];

export function presentCounts(
  counts: DeletionCounts,
): { key: keyof DeletionCounts; count: number }[] {
  return COUNT_ORDER.filter((k) => counts[k] > 0).map((key) => ({ key, count: counts[key] }));
}
