import type { ApiEdge, ApiObject } from "./api-types";
import type { ObjectType } from "./enums";

/**
 * Where a Memory's display colour comes from (ADR 0002 §3, §5, approved decision).
 *
 * A memory never carries its own colour — it is derived, the same way `progress` or `riskLevel`
 * are derived elsewhere, so recolouring a project recolours everything associated with it without
 * a write. The source is exclusively a Project/Sub-project/Plan reached by an `about` edge:
 * Locations are deliberately excluded (they are shared across projects and must not become a
 * colour authority), and this module does not walk `contains`/`located_at` at all.
 *
 * A memory may be `about` more than one project (brief §15). The rule, made deterministic:
 *  - the `about` edge labelled "primary" wins, if one is marked;
 *  - otherwise the oldest live `about` edge to a colour-eligible type wins;
 *  - every other `about`-linked project is a secondary context (rendered as a muted indicator,
 *    never blended into the primary colour — the design system forbids soft-merged hues).
 */

const COLOR_CONTEXT_TYPES: readonly ObjectType[] = ["project", "sub_project", "plan"];
export const PRIMARY_CONTEXT_LABEL = "primary";

export interface ContextRef {
  id: string;
  type: ObjectType;
  title: string;
  /** The design-token key on the context object itself, or `null` if it has none set. */
  color: string | null;
}

export interface ResolvedContext {
  /** The colour a Memory should render with: the primary context's colour, or `null`. */
  color: string | null;
  primary: ContextRef | null;
  secondary: ContextRef[];
}

const EMPTY: ResolvedContext = { color: null, primary: null, secondary: [] };

/**
 * Every live `about` edge from `memoryId` to a colour-eligible object (project/sub_project),
 * oldest first.
 */
function aboutContexts(
  memoryId: string,
  edges: readonly ApiEdge[],
  byId: ReadonlyMap<string, ApiObject>,
): { edge: ApiEdge; object: ApiObject }[] {
  return edges
    .filter((e) => e.kind === "about" && e.from === memoryId)
    .flatMap((edge) => {
      const object = byId.get(edge.to);
      return object && COLOR_CONTEXT_TYPES.includes(object.type) ? [{ edge, object }] : [];
    })
    .sort((a, b) => a.edge.createdAt.localeCompare(b.edge.createdAt));
}

/** Resolves a memory's display colour and its primary/secondary project context. */
export function resolveMemoryContext(
  memoryId: string,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): ResolvedContext {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const contexts = aboutContexts(memoryId, edges, byId);
  if (contexts.length === 0) return EMPTY;

  const labelledPrimary = contexts.find((c) => c.edge.label === PRIMARY_CONTEXT_LABEL);
  const primary = labelledPrimary ?? contexts[0];
  const rest = contexts.filter((c) => c.object.id !== primary?.object.id);

  const ref = (o: ApiObject): ContextRef => ({
    id: o.id,
    type: o.type,
    title: o.title,
    color: o.color,
  });
  return {
    color: primary?.object.color ?? null,
    primary: primary ? ref(primary.object) : null,
    secondary: rest.map((c) => ref(c.object)),
  };
}
