import type {
  ApiEdge,
  ApiObject,
  ApiObjectWithRelations,
  RelationGroups,
  RelationItem,
} from "./api-types";
import { EDGE_KINDS } from "./enums";

/**
 * Builds an object's relations, grouped by edge verb, from the full node and edge lists. The
 * server does the equivalent in SQL for single-object reads; this pure version lets in-memory
 * sources (fixtures, tests, the client cache) produce identical shapes.
 */
export function groupRelations(
  id: string,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): RelationGroups {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = {} as RelationGroups;
  for (const kind of EDGE_KINDS) groups[kind] = { outgoing: [], incoming: [] };

  for (const e of edges) {
    if (e.from !== id && e.to !== id) continue;
    const outgoing = e.from === id;
    const other = byId.get(outgoing ? e.to : e.from);
    if (!other) continue;
    const item: RelationItem = {
      edgeId: e.id,
      label: e.label,
      dependencyType: e.dependencyType,
      lagDays: e.lagDays,
      object: { id: other.id, type: other.type, title: other.title, status: other.status },
    };
    groups[e.kind][outgoing ? "outgoing" : "incoming"].push(item);
  }
  for (const kind of EDGE_KINDS)
    for (const dir of ["outgoing", "incoming"] as const)
      groups[kind][dir].sort((a, b) => a.object.title.localeCompare(b.object.title));
  return groups;
}

export function withRelations(
  node: ApiObject,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): ApiObjectWithRelations {
  return { ...node, relations: groupRelations(node.id, nodes, edges) };
}
