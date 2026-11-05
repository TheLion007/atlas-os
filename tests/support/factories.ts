import type { RelationGroups, RelationItem } from "@/domain/api-types";
import { EDGE_KINDS, type EdgeKind } from "@/domain/enums";

export const emptyRelations = (): RelationGroups =>
  Object.fromEntries(
    EDGE_KINDS.map((k) => [k, { outgoing: [], incoming: [] }]),
  ) as unknown as RelationGroups;

let n = 0;
export function relation(
  type: RelationItem["object"]["type"],
  title: string,
  extra: Partial<RelationItem> = {},
): RelationItem {
  n += 1;
  return {
    edgeId: `edge-${n}`,
    label: null,
    dependencyType: null,
    lagDays: null,
    object: { id: `obj-${n}`, type, title, status: "active" },
    ...extra,
  };
}

export function relationsWith(
  kind: EdgeKind,
  direction: "outgoing" | "incoming",
  items: RelationItem[],
): RelationGroups {
  const groups = emptyRelations();
  groups[kind][direction] = items;
  return groups;
}
