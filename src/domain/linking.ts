import { isEdgeAllowed } from "./edge-rules";
import { OBJECT_TYPES, type EdgeKind, type ObjectType } from "./enums";

/**
 * How two existing objects are linked when the person says "link this to that". They never pick
 * an edge kind: the most specific relation the rules allow is chosen, in this order —
 *  - a memory backed by a document: `supported_by` (memory → document);
 *  - a memory and anything else: `about` (memory → it);
 *  - a financial value and what it values (a project, a property, a transaction…): `estimates`;
 *  - otherwise a plain `references` from the object being worked on.
 * Pure and built on the same edge matrix the database enforces.
 */
export interface LinkPlan {
  kind: EdgeKind;
  from: string;
  to: string;
  label?: string | null;
}

export function linkPlan(
  a: { id: string; type: ObjectType },
  b: { id: string; type: ObjectType },
  opts: { label?: string | null; alreadyLocated?: (id: string) => boolean } = {},
): LinkPlan | null {
  if (a.id === b.id) return null;
  const tryKind = (kind: EdgeKind, from: typeof a, to: typeof a): LinkPlan | null =>
    isEdgeAllowed(kind, from.type, to.type)
      ? { kind, from: from.id, to: to.id, ...(opts.label ? { label: opts.label } : {}) }
      : null;
  const [memory, other] =
    a.type === "memory" ? [a, b] : b.type === "memory" ? [b, a] : [null, null];
  if (memory && other) {
    return (
      (other.type === "document" ? tryKind("supported_by", memory, other) : null) ??
      tryKind("about", memory, other) ??
      tryKind("references", a, b)
    );
  }
  // A document never "estimates" anything: it is evidence, referenced.
  const [estimate, valued] =
    a.type === "estimate" ? [a, b] : b.type === "estimate" ? [b, a] : [null, null];
  if (estimate && valued && valued.type !== "document" && valued.type !== "estimate") {
    const plan = tryKind("estimates", estimate, valued);
    if (plan) return plan;
  }
  // Either side is a place, and the other one has no place yet: it is located there, not merely
  // "referencing" it — the same edge a project's own Location field would create, so it shows up
  // on the globe too. Once something already has a place, linking it to a second one is a
  // relationship between the two places, not a relocation — a `references` edge, drawn as a
  // connecting arc on the globe instead of silently adding a second location.
  const [locatable, place] =
    a.type === "location" ? [b, a] : b.type === "location" ? [a, b] : [null, null];
  if (locatable && place && !opts.alreadyLocated?.(locatable.id)) {
    const plan = tryKind("located_at", locatable, place);
    if (plan) return plan;
  }
  return tryKind("references", a, b);
}

/** Types the "Link to…" control may pick as the other end — every type, so any two objects in
 *  Atlas can be related the same easy way, regardless of what either of them is. */
export const LINKABLE_TYPES: readonly ObjectType[] = OBJECT_TYPES;
