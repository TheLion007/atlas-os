import type { ApiEdge, ApiObject } from "@/domain/api-types";
import type { EdgeKind, ObjectType } from "@/domain/enums";

/**
 * Pure helpers for the graph lens: neighbourhoods, cause chains and the mobile ego-view layout.
 * The live layout on wide screens comes from the force simulation in `graph-sim.ts`.
 */
export interface GraphNodeView {
  id: string;
  type: ObjectType;
  title: string;
  x: number;
  y: number;
  /** 0..1: weight in the plan (here, connectedness). Drives node size. */
  weight: number;
}

export interface GraphEdgeView {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function degrees(edges: readonly Pick<ApiEdge, "from" | "to">[]): Map<string, number> {
  const d = new Map<string, number>();
  for (const e of edges) {
    d.set(e.from, (d.get(e.from) ?? 0) + 1);
    d.set(e.to, (d.get(e.to) ?? 0) + 1);
  }
  return d;
}

/** The node and everything within `hops` relations of it (ignoring direction). */
export function neighbourhood(
  edges: readonly Pick<ApiEdge, "from" | "to">[],
  id: string,
  hops: number,
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    push(adj, e.from, e.to);
    push(adj, e.to, e.from);
  }
  const seen = new Set([id]);
  let frontier = [id];
  for (let h = 0; h < hops; h++) {
    const next: string[] = [];
    for (const n of frontier)
      for (const m of adj.get(n) ?? []) {
        if (seen.has(m)) continue;
        seen.add(m);
        next.push(m);
      }
    frontier = next;
  }
  return seen;
}

/**
 * Everything `id` transitively depends on, with the depends_on edges between them: the cause
 * chain, from an effect back to its origins. This is what path mode lights up.
 */
export function causeChain(
  edges: readonly ApiEdge[],
  id: string,
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const preds = new Map<string, ApiEdge[]>();
  for (const e of edges) {
    if (e.kind !== "depends_on") continue;
    push(preds, e.from, e);
  }
  const nodeIds = new Set([id]);
  const edgeIds = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const e of preds.get(cur) ?? []) {
      edgeIds.add(e.id);
      if (!nodeIds.has(e.to)) {
        nodeIds.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return { nodeIds, edgeIds };
}

/**
 * Mobile: a radial ego-view. The focus sits in the middle, its direct relations on a circle
 * around it. Deterministic, ordered by type then title.
 */
export function egoLayout(
  focusId: string,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
  width: number,
  height: number,
): { nodes: GraphNodeView[]; edges: GraphEdgeView[] } {
  const keep = neighbourhood(edges, focusId, 1);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const others = [...keep]
    .filter((id) => id !== focusId)
    .flatMap((id) => {
      const n = byId.get(id);
      return n ? [n] : [];
    })
    .sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title));
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 48;
  const focus = byId.get(focusId);
  const views: GraphNodeView[] = [];
  if (focus)
    views.push({ id: focus.id, type: focus.type, title: focus.title, x: cx, y: cy, weight: 1 });
  others.forEach((n, i) => {
    const angle = (i / Math.max(1, others.length)) * 2 * Math.PI - Math.PI / 2;
    views.push({
      id: n.id,
      type: n.type,
      title: n.title,
      // Rounded so a re-render (e.g. hydration) produces byte-identical coordinates.
      x: r2(cx + Math.cos(angle) * radius),
      y: r2(cy + Math.sin(angle) * radius),
      weight: 0.4,
    });
  });
  const ids = new Set(views.map((v) => v.id));
  return {
    nodes: views,
    edges: edges.filter(
      (e) => ids.has(e.from) && ids.has(e.to) && (e.from === focusId || e.to === focusId),
    ),
  };
}
