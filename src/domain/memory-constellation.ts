import type { ApiEdge, ApiObject } from "./api-types";
import type { EdgeKind, MemoryType, ObjectType } from "./enums";
import type { MemoryRow } from "./memory-model";

/**
 * The data behind the Memory Graph "constellation": which memories sit together (clusters),
 * and which pairs are related and how strongly (links). Pure and deterministic, derived only from
 * the shared object graph and the `MemoryRow`s the rest of Memory Storage already reads — every
 * point, fibre and glow the renderer draws maps back to something in here, and everything in
 * here maps back to real data:
 *
 *  - a **memory** node is a memory; a **hub** is a project/sub-project at least one shown memory
 *    is `about`; a **satellite** is any other object a memory is directly related to (its source
 *    material, a decision it is about, …);
 *  - a **cluster** is a project context (a memory's primary context, else its first secondary
 *    one). Memories with no project context group by a tag they share with other unfiled
 *    memories; the rest form one "unfiled" cluster;
 *  - a **link** is either a stored edge (strength by relation kind) or an inferred affinity
 *    between two memories — shared project context, shared tags (Jaccard), shared source. Inferred
 *    links are kept only above a threshold and only among each memory's strongest few, so the
 *    picture never becomes "everything connected to everything".
 */

export type ConstellationNodeKind = "memory" | "hub" | "satellite";
export type ConstellationLinkReason = "explicit" | "about" | "source" | "context" | "tags";

export interface ConstellationNode {
  id: string;
  kind: ConstellationNodeKind;
  type: ObjectType;
  title: string;
  memoryType: MemoryType | null;
  clusterId: string;
  /** Sum of link strengths touching the node. */
  degree: number;
  /** 0..1 within the constellation: drives size, brightness and label priority. */
  weight: number;
}

export interface ConstellationLink {
  id: string;
  /** Node indices into `nodes`. */
  a: number;
  b: number;
  /** 0..1: drives the number of strands, their brightness and whether information "flows". */
  strength: number;
  reason: ConstellationLinkReason;
  /** The stored edge kind, for explicit/about/source links. */
  kind: EdgeKind | null;
}

export interface ConstellationCluster {
  id: string;
  /** The project/sub-project title, the shared tag, or "" for the unfiled group. */
  title: string;
  source: "context" | "tag" | "unfiled";
  /** The context's colour token (e.g. "purple"), when it has one. */
  color: string | null;
  /** Number of memories in it. */
  size: number;
  /** Index of the hub node (the project itself), if any. */
  hub: number | null;
}

export interface Constellation {
  nodes: ConstellationNode[];
  links: ConstellationLink[];
  clusters: ConstellationCluster[];
}

/** How strongly a stored relation ties two things together. */
const EDGE_STRENGTH: Partial<Record<EdgeKind, number>> = {
  references: 0.9,
  derived_from: 0.75,
  supported_by: 0.7,
  about: 0.8,
  contains: 0.85,
};
const MEMORY_EDGE_KINDS: ReadonlySet<EdgeKind> = new Set([
  "about",
  "supported_by",
  "derived_from",
  "references",
]);
const HUB_TYPES: ReadonlySet<ObjectType> = new Set(["project", "sub_project", "plan"]);

export const UNFILED_CLUSTER = "~unfiled";
const TAG_CLUSTER_PREFIX = "~tag:";

export interface ConstellationOptions {
  /** Inferred links weaker than this are dropped. */
  threshold?: number;
  /** Each memory keeps at most this many inferred links (the union over both ends is kept). */
  maxInferredPerNode?: number;
  /**
   * Which related object types may join the constellation as satellites (a memory's documents,
   * the financial values or transactions it is about…). Default: every type. This is the
   * extension point for growing the knowledge graph beyond memories without overloading it:
   * a view can admit, say, only documents and financial objects.
   */
  satelliteTypes?: readonly ObjectType[];
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function buildConstellation(
  rows: readonly MemoryRow[],
  objects: readonly ApiObject[],
  edges: readonly ApiEdge[],
  opts: ConstellationOptions = {},
): Constellation {
  const threshold = opts.threshold ?? 0.3;
  const maxInferred = opts.maxInferredPerNode ?? 6;
  const byId = new Map(objects.map((o) => [o.id, o]));
  const rowIds = new Set(rows.map((r) => r.id));
  // A stable order, so the same data always produces the same picture.
  const memories = [...rows].sort((a, b) => a.id.localeCompare(b.id));

  // ── Clusters ──────────────────────────────────────────────────────────────────────────────
  const clusterOf = new Map<string, string>();
  const clusters = new Map<string, ConstellationCluster>();
  const ensureCluster = (c: Omit<ConstellationCluster, "size" | "hub">) => {
    if (!clusters.has(c.id)) clusters.set(c.id, { ...c, size: 0, hub: null });
    return clusters.get(c.id)!;
  };
  // Every project/sub-project/plan gets its own cluster up front, even with zero memories yet —
  // the Memory graph doubles as a map of what exists to attach knowledge (and documents) to, not
  // only a picture of what has already been annotated. A dropped (archived) one is left out.
  for (const o of objects) {
    if (!HUB_TYPES.has(o.type) || o.status === "dropped") continue;
    ensureCluster({ id: o.id, title: o.title, source: "context", color: o.color });
  }
  const unfiled: MemoryRow[] = [];
  for (const r of memories) {
    const ctx = r.primary ?? r.secondary[0] ?? null;
    if (!ctx) {
      unfiled.push(r);
      continue;
    }
    ensureCluster({ id: ctx.id, title: ctx.title, source: "context", color: ctx.color });
    clusterOf.set(r.id, ctx.id);
  }
  // Unfiled memories gather around the tag most of them share; a tag held by one memory is not
  // a group.
  const tagCount = new Map<string, number>();
  for (const r of unfiled) for (const t of r.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  for (const r of unfiled) {
    const best = r.tags
      .filter((t) => (tagCount.get(t) ?? 0) >= 2)
      .sort((a, b) => (tagCount.get(b) ?? 0) - (tagCount.get(a) ?? 0) || a.localeCompare(b))[0];
    const id = best ? `${TAG_CLUSTER_PREFIX}${best}` : UNFILED_CLUSTER;
    ensureCluster({
      id,
      title: best ?? "",
      source: best ? "tag" : "unfiled",
      color: null,
    });
    clusterOf.set(r.id, id);
  }
  for (const r of memories) clusters.get(clusterOf.get(r.id)!)!.size++;
  // A tag group that ended up with a single memory is not a group after all.
  for (const r of unfiled) {
    const cl = clusters.get(clusterOf.get(r.id)!)!;
    if (cl.source !== "tag" || cl.size > 1) continue;
    clusters.delete(cl.id);
    ensureCluster({ id: UNFILED_CLUSTER, title: "", source: "unfiled", color: null }).size++;
    clusterOf.set(r.id, UNFILED_CLUSTER);
  }

  // ── Nodes ─────────────────────────────────────────────────────────────────────────────────
  const nodes: ConstellationNode[] = [];
  const index = new Map<string, number>();
  const addNode = (n: Omit<ConstellationNode, "degree" | "weight">) => {
    index.set(n.id, nodes.length);
    nodes.push({ ...n, degree: 0, weight: 0 });
  };
  for (const r of memories)
    addNode({
      id: r.id,
      kind: "memory",
      type: "memory",
      title: r.title,
      memoryType: r.memoryType,
      clusterId: clusterOf.get(r.id)!,
    });

  // Every stored relation touching a shown memory, in a stable order.
  const touching = edges
    .filter((e) => MEMORY_EDGE_KINDS.has(e.kind) && (rowIds.has(e.from) || rowIds.has(e.to)))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const e of touching) {
    for (const [end, other] of [
      [e.from, e.to],
      [e.to, e.from],
    ] as const) {
      if (rowIds.has(end) || index.has(end)) continue;
      const o = byId.get(end);
      if (!o || o.type === "memory") continue; // a memory filtered out stays out
      if (opts.satelliteTypes && !HUB_TYPES.has(o.type) && !opts.satelliteTypes.includes(o.type))
        continue;
      const isHub = HUB_TYPES.has(o.type) && clusters.has(o.id);
      addNode({
        id: o.id,
        kind: isHub ? "hub" : "satellite",
        type: o.type,
        title: o.title,
        memoryType: null,
        clusterId: isHub ? o.id : (clusterOf.get(other) ?? UNFILED_CLUSTER),
      });
      if (isHub) clusters.get(o.id)!.hub = index.get(o.id)!;
    }
  }
  // A project whose memories are all only `about` it via secondary contexts still anchors its
  // cluster, as long as the object exists.
  for (const c of clusters.values()) {
    if (c.hub !== null || c.source !== "context") continue;
    const o = byId.get(c.id);
    if (!o) continue;
    addNode({
      id: o.id,
      kind: "hub",
      type: o.type,
      title: o.title,
      memoryType: null,
      clusterId: o.id,
    });
    c.hub = index.get(o.id)!;
  }

  // ── Links ─────────────────────────────────────────────────────────────────────────────────
  const links: ConstellationLink[] = [];
  const seen = new Set<string>();
  const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const addLink = (l: ConstellationLink) => {
    const key = pairKey(l.a, l.b);
    if (l.a === l.b || seen.has(key)) return;
    seen.add(key);
    links.push(l);
  };

  for (const e of touching) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined) continue;
    const bothMemories = nodes[a]!.kind === "memory" && nodes[b]!.kind === "memory";
    addLink({
      id: e.id,
      a,
      b,
      strength: EDGE_STRENGTH[e.kind] ?? 0.6,
      reason: bothMemories ? "explicit" : nodes[b]!.kind === "hub" ? "about" : "source",
      kind: e.kind,
    });
  }
  // Nested projects: a sub-project's cluster sits against its parent's.
  const hubIds = new Set(nodes.filter((n) => n.kind === "hub").map((n) => n.id));
  for (const e of edges) {
    if (e.kind !== "contains" || !hubIds.has(e.from) || !hubIds.has(e.to)) continue;
    addLink({
      id: e.id,
      a: index.get(e.from)!,
      b: index.get(e.to)!,
      strength: EDGE_STRENGTH.contains!,
      reason: "explicit",
      kind: "contains",
    });
  }

  // Inferred affinities, found through an inverted index (shared context / tag / source) so the
  // cost grows with actual overlap, not with the square of the number of memories.
  const contextsOf = (r: MemoryRow) =>
    [r.primary, ...r.secondary].flatMap((c) => (c ? [c.id] : []));
  const sourcesOf = (r: MemoryRow) => [...r.derivedFrom, ...r.supportedBy].map((c) => c.id);
  const buckets = new Map<string, number[]>();
  const put = (key: string, i: number) => {
    const list = buckets.get(key);
    if (list) list.push(i);
    else buckets.set(key, [i]);
  };
  memories.forEach((r, i) => {
    for (const c of contextsOf(r)) put(`c:${c}`, i);
    for (const t of r.tags) put(`t:${t}`, i);
    for (const s of sourcesOf(r)) put(`s:${s}`, i);
  });
  const candidates = new Map<number, Set<number>>();
  for (const list of buckets.values()) {
    // A key shared by very many memories (a huge project) says little about any one pair; the
    // hub fibres already express it, so it does not seed pairwise candidates on its own.
    if (list.length < 2 || list.length > 400) continue;
    for (const i of list)
      for (const j of list)
        if (i < j) {
          const set = candidates.get(i) ?? new Set<number>();
          set.add(j);
          candidates.set(i, set);
        }
  }
  const scored: { i: number; j: number; score: number; reason: ConstellationLinkReason }[] = [];
  const jaccard = (a: readonly string[], b: readonly string[]) => {
    if (a.length === 0 || b.length === 0) return 0;
    const sb = new Set(b);
    const shared = a.filter((t) => sb.has(t)).length;
    return shared / (a.length + b.length - shared);
  };
  for (const [i, js] of candidates) {
    const ri = memories[i]!;
    const ci = contextsOf(ri);
    const si = sourcesOf(ri);
    for (const j of js) {
      const rj = memories[j]!;
      const sharedContexts = contextsOf(rj).filter((c) => ci.includes(c)).length;
      const tags = jaccard(ri.tags, rj.tags);
      const sharedSources = sourcesOf(rj).filter((s) => si.includes(s)).length;
      const context = Math.min(0.6, sharedContexts * 0.35);
      const tag = tags * 0.6;
      const source = Math.min(0.5, sharedSources * 0.35);
      let score = context + tag + source;
      if (score > 0 && ri.memoryType === rj.memoryType) score += 0.08;
      if (score < threshold) continue;
      const reason: ConstellationLinkReason =
        tag >= context && tag >= source ? "tags" : source > context ? "source" : "context";
      scored.push({ i, j, score: Math.min(1, score), reason });
    }
  }
  // Keep each memory's strongest few; a pair survives if it is among the best of either end.
  const best = new Map<number, typeof scored>();
  for (const s of scored)
    for (const end of [s.i, s.j]) {
      const list = best.get(end) ?? [];
      list.push(s);
      best.set(end, list);
    }
  const keep = new Set<(typeof scored)[number]>();
  for (const list of best.values()) {
    list.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);
    for (const s of list.slice(0, maxInferred)) keep.add(s);
  }
  for (const s of scored) {
    if (!keep.has(s)) continue;
    const a = index.get(memories[s.i]!.id)!;
    const b = index.get(memories[s.j]!.id)!;
    addLink({
      id: `~${memories[s.i]!.id}~${memories[s.j]!.id}`,
      a,
      b,
      strength: round(s.score),
      reason: s.reason,
      kind: null,
    });
  }

  // ── Weights ───────────────────────────────────────────────────────────────────────────────
  for (const l of links) {
    nodes[l.a]!.degree += l.strength;
    nodes[l.b]!.degree += l.strength;
  }
  // Each kind is weighed against its own kind: a project collecting a hundred memories must not
  // make every memory look minor.
  for (const kind of ["memory", "hub", "satellite"] as const) {
    const ofKind = nodes.filter((n) => n.kind === kind);
    const maxDegree = Math.max(1e-6, ...ofKind.map((n) => n.degree));
    for (const n of ofKind) n.weight = round(Math.sqrt(n.degree / maxDegree));
  }

  const clusterList = [...clusters.values()].sort(
    (a, b) => b.size - a.size || a.id.localeCompare(b.id),
  );
  return { nodes, links, clusters: clusterList };
}

/** Indices of the nodes directly linked to `i` (for hover and selection emphasis). */
export function constellationNeighbours(c: Constellation, i: number): Set<number> {
  const out = new Set<number>();
  for (const l of c.links) {
    if (l.a === i) out.add(l.b);
    else if (l.b === i) out.add(l.a);
  }
  return out;
}
