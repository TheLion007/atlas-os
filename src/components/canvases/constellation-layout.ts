import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { Constellation } from "@/domain/memory-constellation";
import { seededRandom } from "./graph-sim";

/**
 * Where every point of the constellation sits in space. The layout is computed once, synchronously
 * and deterministically (seeded), then frozen: the renderer never runs a live simulation, so the
 * memories do not drift about. When the data changes, points already placed keep their exact
 * position and only new ones are settled around them.
 *
 * Depth is real layout, not a filter: each cluster gets its own depth, and its members spread
 * around it in z in proportion to the cluster's size, so a large cluster reads as a volume and
 * a slow camera sway reveals parallax between clusters.
 */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

interface LNode extends SimulationNodeDatum {
  i: number;
  cx: number;
  cy: number;
  pinned: boolean;
}
type LLink = SimulationLinkDatum<LNode> & { strength: number; intra: boolean };

/** A cheap stable hash of a string to [0, 1). */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** World units per memory-sized step; the renderer's camera is fitted to whatever results. */
const UNIT = 26;

export function clusterRadius(size: number): number {
  return UNIT * (1.2 + Math.sqrt(size) * 0.62);
}

export function layoutConstellation(
  c: Constellation,
  previous?: ReadonlyMap<string, Point3>,
  opts: { seed?: number } = {},
): Map<string, Point3> {
  const random = seededRandom(opts.seed ?? 0x51f15e);
  const out = new Map<string, Point3>();
  if (c.nodes.length === 0) return out;

  // ── 1. Cluster centres: a tiny force layout of the clusters themselves ────────────────────
  const clusterIndex = new Map(c.clusters.map((cl, i) => [cl.id, i]));
  const cross = new Map<string, number>();
  for (const l of c.links) {
    const ca = clusterIndex.get(c.nodes[l.a]!.clusterId);
    const cb = clusterIndex.get(c.nodes[l.b]!.clusterId);
    if (ca === undefined || cb === undefined || ca === cb) continue;
    const key = ca < cb ? `${ca}:${cb}` : `${cb}:${ca}`;
    cross.set(key, (cross.get(key) ?? 0) + l.strength);
  }
  // Where the clusters were last time (from their members), so they stay put across updates.
  const prevCentre = new Map<string, { x: number; y: number; n: number }>();
  if (previous)
    for (const n of c.nodes) {
      const p = previous.get(n.id);
      if (!p) continue;
      const acc = prevCentre.get(n.clusterId) ?? { x: 0, y: 0, n: 0 };
      acc.x += p.x;
      acc.y += p.y;
      acc.n++;
      prevCentre.set(n.clusterId, acc);
    }
  const golden = Math.PI * (3 - Math.sqrt(5));
  const cNodes = c.clusters.map((cl, i) => {
    const prev = prevCentre.get(cl.id);
    const r = clusterRadius(cl.size);
    const node = {
      id: cl.id,
      r,
      x: prev ? prev.x / prev.n : Math.cos(i * golden) * UNIT * 4 * Math.sqrt(i + 1),
      y: prev ? prev.y / prev.n : Math.sin(i * golden) * UNIT * 4 * Math.sqrt(i + 1),
    } as SimulationNodeDatum & { id: string; r: number };
    if (prev) {
      node.fx = node.x;
      node.fy = node.y;
    }
    return node;
  });
  type CNode = (typeof cNodes)[number];
  type CLink = SimulationLinkDatum<CNode> & { w: number };
  const cLinks: CLink[] = [...cross.entries()].map(([key, w]) => {
    const [a, b] = key.split(":").map(Number) as [number, number];
    return { source: a, target: b, w };
  });
  const maxCross = Math.max(1, ...cLinks.map((l) => l.w));
  const cSim = forceSimulation(cNodes)
    .randomSource(random)
    .force("charge", forceManyBody().strength(-UNIT * 6))
    .force(
      "link",
      forceLink<CNode, CLink>(cLinks)
        .distance((l) => (l.source as { r: number }).r + (l.target as { r: number }).r + UNIT)
        .strength((l) => 0.08 + 0.5 * (l.w / maxCross)),
    )
    .force(
      "collide",
      forceCollide<CNode>()
        .radius((d) => d.r * 1.12 + UNIT)
        .strength(1),
    )
    .force("x", forceX(0).strength(0.06))
    .force("y", forceY(0).strength(0.06))
    .stop();
  cSim.tick(260);

  // Depth per cluster: spread over a band about as deep as the layout is wide, largest clusters
  // nearest the middle so the main structure stays in the sharp, bright zone.
  let span = 0;
  for (const n of cNodes) span = Math.max(span, Math.hypot(n.x ?? 0, n.y ?? 0) + n.r);
  const centre = new Map<string, Point3>();
  c.clusters.forEach((cl, i) => {
    const n = cNodes[i]!;
    const depthSlot = (hash01(cl.id) - 0.5) * 2; // -1..1, stable per cluster
    const z = depthSlot * Math.max(UNIT * 2, span * 0.45) * (i === 0 ? 0.3 : 1);
    centre.set(cl.id, { x: n.x ?? 0, y: n.y ?? 0, z });
  });

  // ── 2. Members around their centre ────────────────────────────────────────────────────────
  const nodes: LNode[] = c.nodes.map((n, i) => {
    const cc = centre.get(n.clusterId) ?? { x: 0, y: 0, z: 0 };
    const prev = previous?.get(n.id);
    const angle = random() * Math.PI * 2;
    const rad = random() * clusterRadius(1);
    const d: LNode = {
      i,
      cx: cc.x,
      cy: cc.y,
      pinned: !!prev,
      x: prev ? prev.x : cc.x + Math.cos(angle) * rad,
      y: prev ? prev.y : cc.y + Math.sin(angle) * rad,
    };
    if (prev) {
      d.fx = prev.x;
      d.fy = prev.y;
    } else if (n.kind === "hub") {
      // The project sits at the heart of its own cluster.
      d.fx = cc.x;
      d.fy = cc.y;
    }
    return d;
  });
  if (nodes.every((n) => n.pinned)) {
    c.nodes.forEach((n) => out.set(n.id, previous!.get(n.id)!));
    return out;
  }
  const links: LLink[] = c.links.map((l) => ({
    source: l.a,
    target: l.b,
    strength: l.strength,
    intra: c.nodes[l.a]!.clusterId === c.nodes[l.b]!.clusterId,
  }));
  const big = nodes.length > 1500;
  const sim = forceSimulation(nodes)
    .randomSource(random)
    .force(
      "link",
      forceLink<LNode, LLink>(links)
        .distance((l) => (l.intra ? UNIT * 2.3 : UNIT * 5) * (1.3 - l.strength * 0.5))
        // Links across clusters are shown, but must not tear the clusters apart.
        .strength((l) => (l.intra ? 0.12 + l.strength * 0.3 : 0.01)),
    )
    .force(
      "charge",
      forceManyBody<LNode>()
        .strength(-UNIT * 2.4)
        .distanceMax(UNIT * 8)
        .theta(big ? 1.2 : 0.9),
    )
    // Past a thousand or so points, charge alone keeps them apart; collision is the costly part.
    .force("collide", big ? null : forceCollide<LNode>(UNIT * 0.55).strength(0.8))
    .force("x", forceX<LNode>((d) => d.cx).strength(0.045))
    .force("y", forceY<LNode>((d) => d.cy).strength(0.045))
    .stop();
  sim.tick(big ? 90 : 280);

  // ── 3. Depth ──────────────────────────────────────────────────────────────────────────────
  const size = new Map(c.clusters.map((cl) => [cl.id, cl.size]));
  c.nodes.forEach((n, i) => {
    const prev = previous?.get(n.id);
    if (prev) {
      out.set(n.id, prev);
      return;
    }
    const cc = centre.get(n.clusterId) ?? { x: 0, y: 0, z: 0 };
    const d = nodes[i]!;
    const x = d.x ?? cc.x;
    const y = d.y ?? cc.y;
    if (n.kind === "hub") {
      out.set(n.id, { x, y, z: cc.z });
      return;
    }
    // Members bulge towards the viewer near the middle of the cluster and recede at its rim, so
    // each cluster reads as a volume, not a disc; a stable per-node hash picks front or back.
    const r = clusterRadius(size.get(n.clusterId) ?? 1);
    const dist = Math.min(1, Math.hypot(x - cc.x, y - cc.y) / r);
    const h = hash01(n.id);
    const thickness = r * 0.7 * Math.sqrt(1 - dist * dist);
    const z = cc.z + (h - 0.5) * 2 * thickness * (n.kind === "satellite" ? 0.6 : 1);
    out.set(n.id, { x, y, z });
  });
  return out;
}
