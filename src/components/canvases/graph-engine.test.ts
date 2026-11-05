// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { GraphEngine } from "./graph-engine";
import { exampleSeed } from "@tests/fixtures/example-seed";

/*
 * The Graph's interaction, exercised the way a person does it: wheel over the canvas, press and
 * drag, click, double-click. jsdom has no pixels, so this checks behaviour (the camera, the
 * simulation, the callbacks); the picture itself is checked in a real browser.
 */
const data = buildFixtureData(exampleSeed());
const W = 900;
const H = 600;

interface Rig {
  engine: GraphEngine;
  canvas: HTMLCanvasElement;
  onSelect: ReturnType<typeof vi.fn>;
  onOpen: ReturnType<typeof vi.fn>;
}

let rig: Rig;

function setup(): Rig {
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const onSelect = vi.fn();
  const onOpen = vi.fn();
  const engine = new GraphEngine({
    onSelect,
    onOpen,
    edgeName: (k) => k,
    typeName: (t) => t,
  });
  engine.attach(canvas);
  engine.setSize(W, H);
  engine.setData(data.nodes, data.edges, "force");
  // Settle now, so positions are stable and the tests do not wait on animation.
  engine.sim!.settle();
  engine.reset();
  // Hold the physics still: these tests are about the camera and gestures, not the layout.
  engine.sim!.stop();
  engine.sim!.simulation.alpha(0);
  return { engine, canvas, onSelect, onOpen };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const view = () => document.defaultView as Window & typeof globalThis;
const mouse = (type: string, x: number, y: number, extra: MouseEventInit = {}) => {
  const e = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === "mouseup" ? 0 : 1,
    ...extra,
  });
  // d3 attaches its move/up listeners to `event.view`; jsdom will not accept it in the init dict.
  Object.defineProperty(e, "view", { value: view() });
  return e;
};

/** A screen point with no node near it, for pressing on empty space. */
function emptySpot(engine: GraphEngine): { x: number; y: number } {
  for (let y = 20; y < H; y += 20)
    for (let x = 20; x < W; x += 20) if (!engine.nodeAt(x, y)) return { x, y };
  throw new Error("no empty spot");
}

beforeEach(async () => {
  rig = setup();
  await wait(700); // let the reset tween land
});
afterEach(() => {
  rig.engine.dispose();
  rig.canvas.remove();
});

describe("Graph: the camera", () => {
  it("frames the whole graph inside the canvas once it has settled", () => {
    const { engine } = rig;
    for (const n of engine.sim!.nodes) {
      const p = engine.screenOf(n.id)!;
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(W);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(H);
    }
  });

  it("zooms toward the cursor: the point under the pointer stays put", () => {
    const { engine, canvas } = rig;
    const px = 300;
    const py = 200;
    const before = engine.camera;
    const gx = (px - before.x) / before.k;
    const gy = (py - before.y) / before.k;
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -240,
        clientX: px,
        clientY: py,
        bubbles: true,
        cancelable: true,
      }),
    );
    engine.finishSmooth();
    const after = engine.camera;
    expect(after.k).toBeGreaterThan(before.k); // zoomed in
    expect((px - after.x) / after.k).toBeCloseTo(gx, 4);
    expect((py - after.y) / after.k).toBeCloseTo(gy, 4);
    // and out again
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 480,
        clientX: px,
        clientY: py,
        bubbles: true,
        cancelable: true,
      }),
    );
    engine.finishSmooth();
    expect(engine.camera.k).toBeLessThan(after.k);
  });

  it("pans when the canvas is dragged on empty space", () => {
    const { engine, canvas } = rig;
    const { x, y } = emptySpot(engine);
    const before = { ...engine.camera };
    canvas.dispatchEvent(mouse("mousedown", x, y));
    view().dispatchEvent(mouse("mousemove", x + 70, y + 40));
    view().dispatchEvent(mouse("mouseup", x + 70, y + 40));
    expect(engine.camera.x).toBeCloseTo(before.x + 70, 3);
    expect(engine.camera.y).toBeCloseTo(before.y + 40, 3);
    expect(engine.camera.k).toBeCloseTo(before.k, 5); // moved, not zoomed
  });

  it("never zooms past its limits", () => {
    const { engine, canvas } = rig;
    for (let i = 0; i < 30; i++)
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -600,
          clientX: 450,
          clientY: 300,
          bubbles: true,
          cancelable: true,
        }),
      );
    expect(engine.camera.k).toBeLessThanOrEqual(8);
    for (let i = 0; i < 60; i++)
      canvas.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 600,
          clientX: 450,
          clientY: 300,
          bubbles: true,
          cancelable: true,
        }),
      );
    expect(engine.camera.k).toBeGreaterThanOrEqual(0.12);
  });

  it("zooms by button and fits back to the screen", async () => {
    const { engine } = rig;
    const k0 = engine.camera.k;
    engine.zoomBy(2);
    await wait(320);
    expect(engine.camera.k).toBeCloseTo(k0 * 2, 3);
    engine.zoomBy(1 / 2);
    await wait(320);
    engine.fit();
    await wait(620);
    expect(engine.camera.k).toBeCloseTo(k0, 2);
  });

  it("flies to a node and to its neighbourhood", async () => {
    const { engine } = rig;
    const id = seedId("p_marina");
    engine.focusOn(id);
    await wait(620);
    const p = engine.screenOf(id)!;
    expect(p.x).toBeCloseTo(W / 2, 0);
    expect(p.y).toBeCloseTo(H / 2, 0);
    engine.focusOn(id, { neighbours: true });
    await wait(620);
    // Everything directly related to it is on screen.
    for (const l of engine.sim!.links) {
      if (l.source.id !== id && l.target.id !== id) continue;
      for (const n of [l.source, l.target]) {
        const s = engine.screenOf(n.id)!;
        expect(s.x).toBeGreaterThan(0);
        expect(s.x).toBeLessThan(W);
        expect(s.y).toBeGreaterThan(0);
        expect(s.y).toBeLessThan(H);
      }
    }
  });

  it("double-clicking empty space zooms in there, and a node opens", async () => {
    const { engine, canvas, onOpen } = rig;
    const { x, y } = emptySpot(engine);
    const k0 = engine.camera.k;
    canvas.dispatchEvent(mouse("dblclick", x, y));
    await wait(320);
    expect(engine.camera.k).toBeGreaterThan(k0 * 1.5);

    const target = engine.sim!.nodes[0]!;
    engine.fit();
    await wait(620);
    const p = engine.screenOf(target.id)!;
    canvas.dispatchEvent(mouse("dblclick", p.x, p.y));
    expect(onOpen).toHaveBeenCalledWith(target.id);
  });
});

describe("Graph: nodes", () => {
  const pick = () => {
    const id = seedId("p_marina");
    const p = rig.engine.screenOf(id)!;
    return { id, ...p };
  };

  it("selects a node on click, and clears it on a second click", () => {
    const { canvas, onSelect } = rig;
    const { id, x, y } = pick();
    canvas.dispatchEvent(mouse("mousedown", x, y));
    view().dispatchEvent(mouse("mouseup", x, y));
    expect(onSelect).toHaveBeenLastCalledWith(id);

    rig.engine.setView({
      selectedId: id,
      path: null,
      focusMode: false,
      accent: true,
      hiddenCount: 0,
    });
    canvas.dispatchEvent(mouse("mousedown", x, y));
    view().dispatchEvent(mouse("mouseup", x, y));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("clears the selection on a click in empty space, but not after a pan", () => {
    const { canvas, onSelect, engine } = rig;
    const { x, y } = emptySpot(engine);
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(mouse("click", x, y));
    expect(onSelect).toHaveBeenCalledWith(null);

    onSelect.mockClear();
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: x, clientY: y, bubbles: true }));
    canvas.dispatchEvent(mouse("click", x + 80, y + 10)); // released far away: that was a pan
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("drags a node with the pointer, pulls its neighbours along, then lets it go", () => {
    const { canvas, engine, onSelect } = rig;
    const { id, x, y } = pick();
    const node = engine.sim!.nodes.find((n) => n.id === id)!;
    const neighbour = engine
      .sim!.links.filter((l) => l.source === node || l.target === node)
      .map((l) => (l.source === node ? l.target : l.source))[0]!;
    const start = { x: node.x!, y: node.y!, nx: neighbour.x!, ny: neighbour.y! };
    const k = engine.camera.k;

    canvas.dispatchEvent(mouse("mousedown", x, y));
    view().dispatchEvent(mouse("mousemove", x + 60, y + 30));
    view().dispatchEvent(mouse("mousemove", x + 200, y + 90));
    // The node is held at the pointer (in graph space), not merely nudged.
    expect(node.fx).toBeCloseTo(start.x + 200 / k, 1);
    expect(node.fy).toBeCloseTo(start.y + 90 / k, 1);

    engine.sim!.tick(80); // the rest of the graph reacts
    expect(Math.hypot(neighbour.x! - start.nx, neighbour.y! - start.ny)).toBeGreaterThan(10);

    view().dispatchEvent(mouse("mouseup", x + 200, y + 90));
    expect(node.fx).toBeNull(); // released: physics owns it again
    expect(onSelect).not.toHaveBeenCalled(); // a drag is not a click
  });

  it("does not pan the canvas while a node is dragged", () => {
    const { canvas, engine } = rig;
    const { x, y } = pick();
    const before = { ...engine.camera };
    canvas.dispatchEvent(mouse("mousedown", x, y));
    view().dispatchEvent(mouse("mousemove", x + 120, y));
    view().dispatchEvent(mouse("mouseup", x + 120, y));
    expect(engine.camera.x).toBeCloseTo(before.x, 5);
    expect(engine.camera.y).toBeCloseTo(before.y, 5);
  });

  it("reports what state it is in: settling, then selected, path, filtered", async () => {
    const states: string[] = [];
    rig.engine.configure({
      onState: (s) => states.push(s),
      edgeName: (k) => k,
      typeName: (t) => t,
    });
    rig.engine.setView({
      selectedId: seedId("p_marina"),
      path: null,
      focusMode: false,
      accent: false,
      hiddenCount: 0,
    });
    await wait(60);
    expect(states.at(-1)).toBe("node-selected");
    rig.engine.setView({
      selectedId: seedId("p_marina"),
      path: { nodeIds: new Set([seedId("p_marina")]), edgeIds: new Set() },
      focusMode: false,
      accent: false,
      hiddenCount: 0,
    });
    await wait(60);
    expect(states.at(-1)).toBe("path-mode");
    rig.engine.setView({
      selectedId: null,
      path: null,
      focusMode: false,
      accent: false,
      hiddenCount: 2,
    });
    await wait(60);
    expect(states.at(-1)).toBe("filtered");
  });
});

describe("Graph: a growing world", () => {
  it("adds an object without rearranging the rest, and does not stir on an identical refetch", () => {
    const { engine } = rig;
    engine.sim!.settle();
    const before = new Map(engine.sim!.nodes.map((n) => [n.id, [n.x, n.y]]));
    engine.setData(data.nodes, data.edges, "force"); // same data again: a refetch
    for (const n of engine.sim!.nodes) expect([n.x, n.y]).toEqual(before.get(n.id));
    expect(engine.sim!.alpha()).toBeLessThan(0.01); // it did not wake up

    const added = { id: "n1", type: "task" as const, title: "New" };
    engine.setData(
      [...data.nodes, added],
      [...data.edges, { id: "e1", kind: "contains" as const, from: seedId("p_reloc"), to: "n1" }],
      "force",
    );
    for (const n of engine.sim!.nodes)
      if (n.id !== "n1") expect([n.x, n.y]).toEqual(before.get(n.id));
    expect(engine.sim!.alpha()).toBeGreaterThan(0.3); // it woke to make room
  });
});
