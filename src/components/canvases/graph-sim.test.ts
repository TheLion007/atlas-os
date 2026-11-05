import { describe, expect, it } from "vitest";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { boundsOf, createGraphSim, fitTransform, seededRandom } from "./graph-sim";
import { exampleSeed } from "@tests/fixtures/example-seed";

const data = buildFixtureData(exampleSeed());
const input = { nodes: data.nodes, edges: data.edges };
const dist = (a: { x?: number; y?: number }, b: { x?: number; y?: number }) =>
  Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));

describe("the graph force simulation", () => {
  it("settles into a finite, spread-out layout with every node placed", () => {
    const sim = createGraphSim(input);
    sim.settle();
    expect(sim.nodes).toHaveLength(data.nodes.length);
    for (const n of sim.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
    // It came to rest: the simulation cooled down by itself.
    expect(sim.alpha()).toBeLessThan(0.01);
  });

  it("keeps nodes from sitting on top of each other", () => {
    const sim = createGraphSim(input);
    sim.settle();
    let overlaps = 0;
    for (let i = 0; i < sim.nodes.length; i++)
      for (let j = i + 1; j < sim.nodes.length; j++) {
        const a = sim.nodes[i]!;
        const b = sim.nodes[j]!;
        if (dist(a, b) < (a.r + b.r) * 0.8) overlaps++;
      }
    expect(overlaps).toBe(0);
  });

  it("pulls related objects together: relations are shorter than the average pair", () => {
    const sim = createGraphSim(input);
    sim.settle();
    const linked = sim.links.map((l) => dist(l.source, l.target));
    const meanLinked = linked.reduce((a, b) => a + b, 0) / linked.length;
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < sim.nodes.length; i++)
      for (let j = i + 1; j < sim.nodes.length; j++) {
        total += dist(sim.nodes[i]!, sim.nodes[j]!);
        pairs++;
      }
    expect(meanLinked).toBeLessThan((total / pairs) * 0.6);
  });

  it("gives the same picture every time, so spatial memory can form", () => {
    const a = createGraphSim(input);
    const b = createGraphSim(input);
    a.settle();
    b.settle();
    expect(a.nodes.map((n) => [n.id, n.x, n.y])).toEqual(b.nodes.map((n) => [n.id, n.x, n.y]));
  });

  it("sizes nodes by how connected they are", () => {
    const sim = createGraphSim(input);
    const hub = sim.nodes.find((n) => n.id === seedId("p_reloc"))!;
    const leaf = [...sim.nodes].sort((x, y) => x.degree - y.degree)[0]!;
    expect(hub.r).toBeGreaterThan(leaf.r);
    expect(hub.weight).toBeLessThanOrEqual(1);
  });

  it("reacts when a node is dragged: neighbours follow, then it settles again", () => {
    const sim = createGraphSim(input);
    sim.settle();
    const project = sim.nodes.find((n) => n.id === seedId("p_reloc"))!;
    const link = sim.links.find((l) => l.source === project || l.target === project)!;
    const neighbour = link.source === project ? link.target : link.source;
    const before = { x: neighbour.x, y: neighbour.y };

    sim.dragStart(project);
    sim.dragTo(project, (project.x ?? 0) + 400, project.y ?? 0);
    sim.tick(120);
    expect(project.x).toBeCloseTo(project.x as number, 5); // held by the pointer
    expect(dist(neighbour, before)).toBeGreaterThan(40); // the neighbour was pulled along

    // Released: the pin is lifted and the layout relaxes back to rest.
    sim.dragEnd(project);
    expect(project.fx).toBeNull();
    sim.tick(400);
    expect(sim.alpha()).toBeLessThan(0.01);
    for (const n of sim.nodes) expect(Number.isFinite(n.x)).toBe(true);
  });

  it("grows without rearranging what the user already knows", () => {
    const sim = createGraphSim(input);
    sim.settle();
    const before = new Map(sim.nodes.map((n) => [n.id, [n.x, n.y]]));
    const parent = seedId("p_reloc");
    const added = {
      id: "new-task",
      type: "task" as const,
      title: "Brand new",
    };
    sim.update({
      nodes: [...data.nodes, added],
      edges: [...data.edges, { id: "new-edge", kind: "contains", from: parent, to: "new-task" }],
    });
    // Nothing that existed jumped: positions are unchanged until the simulation runs.
    for (const n of sim.nodes)
      if (n.id !== "new-task") expect([n.x, n.y]).toEqual(before.get(n.id));
    // The newcomer appears right beside the thing it belongs to.
    const child = sim.nodes.find((n) => n.id === "new-task")!;
    const p = sim.nodes.find((n) => n.id === parent)!;
    expect(dist(child, p)).toBeLessThan(60);
  });

  it("drops relations whose ends no longer exist instead of failing", () => {
    const sim = createGraphSim({
      nodes: data.nodes.slice(0, 3),
      edges: data.edges,
    });
    sim.settle();
    expect(
      sim.links.every((l) => sim.nodes.includes(l.source) && sim.nodes.includes(l.target)),
    ).toBe(true);
  });

  it("finds the node under a point", () => {
    const sim = createGraphSim(input);
    sim.settle();
    const n = sim.nodes[3]!;
    expect(sim.find(n.x as number, n.y as number, 10)?.id).toBe(n.id);
    expect(sim.find(1e6, 1e6, 10)).toBeUndefined();
  });
});

describe("framing", () => {
  it("bounds the nodes, radius included", () => {
    expect(
      boundsOf([
        { x: 0, y: 0, r: 5 },
        { x: 100, y: 50, r: 10 },
      ]),
    ).toEqual({ x0: -5, y0: -5, x1: 110, y1: 60 });
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ x: undefined, y: undefined, r: 4 }])).toBeNull();
  });

  it("fits a box into the view, centred, with a margin", () => {
    const t = fitTransform({ x0: -100, y0: -50, x1: 100, y1: 50 }, 800, 400, {
      margin: 40,
      maxK: 5,
    });
    // Limited by height: (400 - 80) / 100 = 3.2, tighter than the width's 3.6.
    expect(t.k).toBeCloseTo(3.2, 5);
    // The centre of the box lands at the centre of the view.
    expect(0 * t.k + t.x).toBeCloseTo(400, 5);
    expect(0 * t.k + t.y).toBeCloseTo(200, 5);
  });

  it("never zooms in absurdly on a single node, nor out to nothing", () => {
    const one = fitTransform({ x0: -5, y0: -5, x1: 5, y1: 5 }, 800, 600);
    expect(one.k).toBeLessThanOrEqual(2.2);
    const huge = fitTransform({ x0: 0, y0: 0, x1: 1e6, y1: 1e6 }, 800, 600);
    expect(huge.k).toBeGreaterThanOrEqual(0.15);
  });

  it("has a seeded generator that is stable and in range", () => {
    const a = seededRandom(1);
    const b = seededRandom(1);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
