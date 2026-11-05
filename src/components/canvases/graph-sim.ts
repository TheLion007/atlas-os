import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { ApiEdge, ApiObject } from "@/domain/api-types";
import type { EdgeKind, ObjectType } from "@/domain/enums";

/**
 * The force simulation behind the Graph. It is a thin, DOM-free wrapper around d3-force so the
 * behaviour (settling, dragging, growing the graph without reshuffling it) is testable in Node.
 *
 * The goal is "alive but controlled": nodes glide into place, the layout settles and stops, a
 * dragged node pulls its neighbours along and the graph relaxes again, and adding an object
 * does not rearrange the world the user already knows. There is no grid and no snapping.
 */
export interface SimNode extends SimulationNodeDatum {
  id: string;
  type: ObjectType;
  title: string;
  /** Number of relations: drives size. */
  degree: number;
  /** 0..1 within the graph. */
  weight: number;
  /** Drawn radius in graph units. */
  r: number;
  /** The project it belongs to: nodes of one project gather in one group. */
  group: string | null;
  /** Its colour (the project's), or none to use its type's. */
  color: string | null;
  /** 0..1: how important or how far along it is; drives size. */
  size: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string;
  kind: EdgeKind;
  source: SimNode;
  target: SimNode;
}

/** Resting length of each relation: hierarchy is tight, references are loose. */
const LINK_DISTANCE: Record<EdgeKind, number> = {
  contains: 54,
  depends_on: 84,
  estimates: 72,
  funded_by: 84,
  located_at: 104,
  references: 116,
  about: 116,
  supported_by: 96,
  derived_from: 96,
};
const LINK_STRENGTH: Record<EdgeKind, number> = {
  contains: 0.8,
  depends_on: 0.55,
  estimates: 0.5,
  funded_by: 0.45,
  located_at: 0.35,
  references: 0.2,
  about: 0.2,
  supported_by: 0.3,
  derived_from: 0.3,
};

export const radiusOf = (weight: number): number => 5 + weight * 9;

/** Projects are the big anchors, sub-projects the middle size, everything else small. */
export function radiusFor(type: ObjectType, size: number): number {
  const s = Math.min(1, Math.max(0, size));
  return type === "project" ? 15 + s * 9 : type === "sub_project" ? 10 + s * 6 : 5 + s * 6;
}

/** A small seeded generator, so the same graph always settles into the same picture. */
export function seededRandom(seed = 0x9e3779b9): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface SimInput {
  nodes: readonly (Pick<ApiObject, "id" | "type" | "title"> & {
    group?: string | null;
    color?: string | null;
    size?: number;
  })[];
  edges: readonly Pick<ApiEdge, "id" | "kind" | "from" | "to">[];
}

export interface GraphSim {
  nodes: SimNode[];
  links: SimLink[];
  /** Replace the data. Existing nodes keep their positions; new ones appear beside a neighbour. */
  update: (input: SimInput) => void;
  /** Advance by hand (tests, reduced motion). */
  tick: (count?: number) => void;
  /** Warm the layout up before the first paint. */
  settle: () => void;
  /** A node is being dragged: it follows the pointer and the rest react. */
  dragStart: (node: SimNode) => void;
  dragTo: (node: SimNode, x: number, y: number) => void;
  dragEnd: (node: SimNode) => void;
  /** Wake the simulation gently, e.g. after a filter changes. */
  reheat: (alpha?: number) => void;
  /** Nearest node within `radius` of a point in graph space. */
  find: (x: number, y: number, radius: number) => SimNode | undefined;
  alpha: () => number;
  stop: () => void;
  on: (event: "tick" | "end", listener: () => void) => void;
  simulation: Simulation<SimNode, SimLink>;
}

/** Nodes with `fx`/`fy` set are held; everything else is free to move. */
export function createGraphSim(input: SimInput, opts: { seed?: number } = {}): GraphSim {
  const random = seededRandom(opts.seed);
  let nodes: SimNode[] = [];
  let links: SimLink[] = [];
  const listeners: { tick: (() => void)[]; end: (() => void)[] } = { tick: [], end: [] };
  let anchors = new Map<string, { x: number; y: number }>();
  const anchorOf = (n: SimNode): { x: number; y: number } =>
    (n.group ? anchors.get(n.group) : undefined) ?? { x: 0, y: 0 };

  const simulation = forceSimulation<SimNode, SimLink>([])
    .randomSource(random)
    .alphaMin(0.004)
    .alphaDecay(0.032)
    .velocityDecay(0.42)
    .force(
      "link",
      forceLink<SimNode, SimLink>([])
        .id((d) => d.id)
        .distance((l) => LINK_DISTANCE[l.kind])
        .strength((l) => LINK_STRENGTH[l.kind]),
    )
    .force(
      "charge",
      forceManyBody<SimNode>()
        .strength((d) => -120 - d.r * 9)
        .distanceMax(360),
    )
    .force(
      "collide",
      forceCollide<SimNode>()
        .radius((d) => d.r + 7)
        .strength(0.9),
    )
    // Each project gathers its own nodes around an anchor; the anchors sit on a spiral so the
    // groups share one room. Nodes with no project drift to the middle.
    .force(
      "x",
      forceX<SimNode>((d) => anchorOf(d).x).strength((d) => (d.group ? 0.11 : 0.03)),
    )
    .force(
      "y",
      forceY<SimNode>((d) => anchorOf(d).y).strength((d) => (d.group ? 0.11 : 0.03)),
    )
    .stop();

  const emit = (event: "tick" | "end") => {
    for (const l of listeners[event]) l();
  };
  simulation.on("tick.graph", () => emit("tick"));
  simulation.on("end.graph", () => emit("end"));

  const update = ({ nodes: apiNodes, edges: apiEdges }: SimInput) => {
    const known = new Map(nodes.map((n) => [n.id, n]));
    const degree = new Map<string, number>();
    for (const e of apiEdges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const maxDegree = Math.max(1, ...degree.values());

    const next: SimNode[] = apiNodes.map((n) => {
      const existing = known.get(n.id);
      const d = degree.get(n.id) ?? 0;
      const weight = d / maxDegree;
      const size = n.size ?? weight;
      const group = n.group ?? null;
      const color = n.color ?? null;
      if (existing) {
        existing.title = n.title;
        existing.type = n.type;
        existing.degree = d;
        existing.weight = weight;
        existing.size = size;
        existing.group = group;
        existing.color = color;
        existing.r = radiusFor(n.type, size);
        return existing;
      }
      return {
        id: n.id,
        type: n.type,
        title: n.title,
        degree: d,
        weight,
        size,
        group,
        color,
        r: radiusFor(n.type, size),
      };
    });

    // New nodes appear next to something they are related to, not at a random place.
    const byId = new Map(next.map((n) => [n.id, n]));
    for (const n of next) {
      if (n.x !== undefined && n.y !== undefined) continue;
      const anchor = apiEdges
        .filter((e) => e.from === n.id || e.to === n.id)
        .map((e) => byId.get(e.from === n.id ? e.to : e.from))
        .find((o) => o && o.x !== undefined && o.y !== undefined);
      if (anchor) {
        const angle = random() * Math.PI * 2;
        n.x = (anchor.x as number) + Math.cos(angle) * 40;
        n.y = (anchor.y as number) + Math.sin(angle) * 40;
      }
    }

    // Anchors: the biggest group in the middle, the others on a golden spiral around it.
    const counts = new Map<string, number>();
    for (const n of next) if (n.group) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    const order = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    anchors = new Map(
      order.map(([id], i) => {
        const angle = i * 2.399963;
        const dist = i === 0 ? 0 : 210 * Math.sqrt(i);
        return [id, { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist }] as const;
      }),
    );

    const nextLinks: SimLink[] = apiEdges.flatMap((e) => {
      const source = byId.get(e.from);
      const target = byId.get(e.to);
      return source && target ? [{ id: e.id, kind: e.kind, source, target }] : [];
    });

    nodes = next;
    links = nextLinks;
    simulation.nodes(nodes);
    (simulation.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>>).links(links);
    api.nodes = nodes;
    api.links = links;
  };

  const api: GraphSim = {
    nodes,
    links,
    update,
    tick: (count = 1) => {
      simulation.tick(count);
    },
    settle: () => {
      simulation.alpha(1);
      const rounds = Math.ceil(Math.log(0.004) / Math.log(1 - 0.032));
      simulation.tick(rounds);
    },
    dragStart: (node) => {
      simulation.alphaTarget(0.22).restart();
      node.fx = node.x;
      node.fy = node.y;
    },
    dragTo: (node, x, y) => {
      node.fx = x;
      node.fy = y;
    },
    dragEnd: (node) => {
      simulation.alphaTarget(0);
      node.fx = null;
      node.fy = null;
    },
    reheat: (alpha = 0.3) => {
      simulation.alpha(Math.max(simulation.alpha(), alpha)).restart();
    },
    find: (x, y, radius) => simulation.find(x, y, radius),
    alpha: () => simulation.alpha(),
    stop: () => {
      simulation.stop();
    },
    on: (event, listener) => {
      listeners[event].push(listener);
    },
    simulation,
  };

  update(input);
  return api;
}

/** The smallest box around the given nodes, padded by their radius. */
export function boundsOf(
  nodes: readonly Pick<SimNode, "x" | "y" | "r">[],
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    x0 = Math.min(x0, n.x - n.r);
    y0 = Math.min(y0, n.y - n.r);
    x1 = Math.max(x1, n.x + n.r);
    y1 = Math.max(y1, n.y + n.r);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** The pan/zoom that fits a box inside a viewport with a margin; never zooms in past `maxK`. */
export function fitTransform(
  box: { x0: number; y0: number; x1: number; y1: number },
  width: number,
  height: number,
  opts: { margin?: number; maxK?: number; minK?: number } = {},
): { k: number; x: number; y: number } {
  const margin = opts.margin ?? 56;
  const w = Math.max(1, box.x1 - box.x0);
  const h = Math.max(1, box.y1 - box.y0);
  const k = Math.min(
    opts.maxK ?? 2.2,
    Math.max(opts.minK ?? 0.15, Math.min((width - margin * 2) / w, (height - margin * 2) / h)),
  );
  return {
    k,
    x: width / 2 - ((box.x0 + box.x1) / 2) * k,
    y: height / 2 - ((box.y0 + box.y1) / 2) * k,
  };
}
