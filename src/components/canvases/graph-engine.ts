import { drag, type D3DragEvent } from "d3-drag";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import type { ApiEdge, ApiObject } from "@/domain/api-types";
import type { ObjectType } from "@/domain/enums";
import { OBJECT_TYPE_STYLE } from "@/design/object-types";
import { CANVAS_COLORS as C, typeColor } from "@/design/tokens";
import { EDGE_STYLE, SHAPE_OF, traceShape, type EdgeStyle } from "./graph-shapes";
import { neighbourhood } from "./graph-view";
import {
  boundsOf,
  createGraphSim,
  fitTransform,
  type GraphSim,
  type SimLink,
  type SimNode,
} from "./graph-sim";

/**
 * Everything about the Graph canvas that is not React: the camera, the draw loop, hit testing,
 * and the pointer gestures (pan, zoom toward the cursor, drag a node, select, open). The React
 * component only feeds it data and props and forwards its callbacks. Keeping it a plain class
 * means the draw loop never waits on a render. A slow drift of particles along every relation
 * keeps it running at all times (never for someone who prefers reduced motion), the same trade
 * the Memory constellation makes; at rest it halves its own frame rate, so idle still costs
 * little even though it never fully stops.
 */
export type GraphState = "settling" | "settled" | "node-selected" | "path-mode" | "filtered";

/** A graph point (gx, gy) is drawn at (k·gx + x, k·gy + y). */
export interface Camera {
  k: number;
  x: number;
  y: number;
}

export type GraphNodeInput = Pick<ApiObject, "id" | "type" | "title"> & {
  /** The project it belongs to (nodes of a project gather together). */
  group?: string | null;
  /** The project's colour; without one the node takes its type's. */
  color?: string | null;
  /** 0..1: importance or progress, drives size. */
  size?: number;
};
export type GraphEdgeInput = Pick<ApiEdge, "id" | "kind" | "from" | "to">;

export interface GraphView {
  selectedId: string | null;
  path: { nodeIds: ReadonlySet<string>; edgeIds: ReadonlySet<string> } | null;
  focusMode: boolean;
  accent: boolean;
  hiddenCount: number;
}

export interface GraphCallbacks {
  onSelect?: (id: string | null) => void;
  onOpen?: (id: string) => void;
  onState?: (state: GraphState) => void;
  /** The zoom, in percent, whenever it changes. */
  onZoom?: (percent: number) => void;
  /** Interface text drawn on the canvas (relation names, type names). */
  edgeName: (kind: ApiEdge["kind"]) => string;
  typeName: (type: ObjectType) => string;
}

export const MIN_K = 0.12;
export const MAX_K = 8;
const HIT_RADIUS = 20;
const CLICK_SLOP = 4;
const LABEL_PX = 12;

const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Causes flow into their effects; containment, place and references flow outward. */
const flowsFromTarget = (l: SimLink): boolean => l.kind === "depends_on";

export class GraphEngine {
  sim: GraphSim | null = null;
  camera: Camera = { k: 1, x: 0, y: 0 };
  width = 960;
  height = 600;

  private canvas: HTMLCanvasElement | null = null;
  private minimap: HTMLCanvasElement | null = null;
  private zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown> | null = null;
  private mode: "force" | "fixed" = "force";
  private view: GraphView = {
    selectedId: null,
    path: null,
    focusMode: false,
    accent: false,
    hiddenCount: 0,
  };
  private cb: GraphCallbacks;
  private near1: Set<string> | null = null;
  private near2: Set<string> | null = null;
  private hover: string | null = null;
  private hoverNear: Set<string> | null = null;
  private hoverEdge: SimLink | null = null;
  /** Current (animated) opacity of every node and link: hover changes ease in, never snap. */
  private fadeNode = new Map<string, number>();
  private fadeEdge = new Map<string, number>();
  private fading = false;
  /** Coasting after a pan, and the zoom target a wheel gesture is easing towards. */
  private inertia: { vx: number; vy: number } | null = null;
  private smooth: Camera | null = null;
  private samples: { t: number; x: number; y: number }[] = [];
  private lastNow = 0;
  private dragging = false;
  /** Once the person has taken the camera, it no longer follows the layout on its own. */
  private interacted = false;
  /** `start` is stamped on the first frame, so it always shares the frame clock. */
  private tween: { from: Camera; to: Camera; start: number | null; ms: number } | null = null;
  private raf = 0;
  private lastFrame = 0;
  private labelFont = "system-ui, sans-serif";
  private lastState = "";
  private signature = "";
  private detach: (() => void) | null = null;
  private disposed = false;

  constructor(cb: GraphCallbacks) {
    this.cb = cb;
  }

  configure(cb: GraphCallbacks): void {
    this.cb = cb;
  }

  // ── Data and view ─────────────────────────────────────────────────────────────────────────

  setData(
    nodes: readonly GraphNodeInput[],
    edges: readonly GraphEdgeInput[],
    mode: "force" | "fixed",
    fixed?: ReadonlyMap<string, { x: number; y: number }>,
  ): void {
    this.mode = mode;
    // A refetch that changed nothing must not stir the layout.
    const signature = `${nodes.map((n) => `${n.id}:${n.type}:${n.title}`).join("|")}#${edges.map((e) => `${e.id}:${e.from}:${e.to}`).join("|")}`;
    const changed = signature !== this.signature;
    this.signature = signature;
    if (!this.sim) {
      const sim = createGraphSim({ nodes, edges });
      this.sim = sim;
      sim.on("tick", () => this.schedule());
      sim.on("end", () => this.schedule());
      if (mode === "fixed") sim.stop();
      else if (prefersReducedMotion())
        sim.settle(); // no motion without a reason
      else sim.simulation.alpha(1).restart();
    } else {
      this.sim.update({ nodes, edges });
      if (mode === "force" && changed) this.sim.reheat(0.55);
    }
    if (mode === "fixed" && fixed) {
      for (const n of this.sim.nodes) {
        const p = fixed.get(n.id);
        if (!p) continue;
        n.x = n.fx = p.x;
        n.y = n.fy = p.y;
      }
      this.sim.stop();
      const cam = this.fitCamera();
      if (cam) this.camera = cam;
      this.syncZoom();
    }
    this.refreshNeighbourhood();
    this.schedule();
  }

  setView(view: GraphView): void {
    this.view = view;
    this.refreshNeighbourhood();
    this.schedule();
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const canvas = this.canvas;
    if (canvas) {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      this.labelFont = getComputedStyle(canvas).fontFamily || this.labelFont;
    }
    if (!this.interacted) {
      // Frame the graph in whatever room it now has.
      this.camera = this.fitCamera() ?? { k: 1, x: width / 2, y: height / 2 };
      this.syncZoom();
    }
    this.schedule();
  }

  private refreshNeighbourhood(): void {
    const id = this.view.selectedId;
    const links = (this.sim?.links ?? []).map((l) => ({ from: l.source.id, to: l.target.id }));
    this.near1 = id ? neighbourhood(links, id, 1) : null;
    this.near2 = id ? neighbourhood(links, id, 2) : null;
  }

  // ── Camera ────────────────────────────────────────────────────────────────────────────────

  private fitCamera(margin = 56): Camera | null {
    const box = this.sim ? boundsOf(this.sim.nodes) : null;
    return box ? fitTransform(box, this.width, this.height, { margin }) : null;
  }

  /** Keep d3-zoom's own idea of the transform in step, so the next wheel tick starts from here. */
  private syncZoom(): void {
    if (this.canvas)
      (this.canvas as unknown as { __zoom: unknown }).__zoom = zoomIdentity
        .translate(this.camera.x, this.camera.y)
        .scale(this.camera.k);
  }

  animateTo(to: Camera, ms = 520): void {
    this.smooth = null;
    this.inertia = null;
    if (prefersReducedMotion()) {
      this.camera = to;
      this.tween = null;
      this.syncZoom();
    } else {
      this.tween = { from: { ...this.camera }, to, start: null, ms };
    }
    this.schedule();
  }

  fit(): void {
    this.interacted = true;
    const cam = this.fitCamera();
    if (cam) this.animateTo(cam);
  }

  reset(): void {
    this.interacted = false;
    const cam = this.fitCamera();
    if (cam) this.animateTo(cam);
    this.sim?.reheat(0.5);
  }

  zoomBy(factor: number): void {
    this.interacted = true;
    const c = this.camera;
    const k = Math.min(MAX_K, Math.max(MIN_K, c.k * factor));
    const cx = this.width / 2;
    const cy = this.height / 2;
    this.animateTo({ k, x: cx - ((cx - c.x) / c.k) * k, y: cy - ((cy - c.y) / c.k) * k }, 220);
  }

  focusOn(id: string, opts: { neighbours?: boolean } = {}): void {
    const sim = this.sim;
    const node = sim?.nodes.find((n) => n.id === id);
    if (!sim || !node || node.x === undefined || node.y === undefined) return;
    this.interacted = true;
    if (opts.neighbours) {
      const ids = neighbourhood(
        sim.links.map((l) => ({ from: l.source.id, to: l.target.id })),
        id,
        1,
      );
      const box = boundsOf(sim.nodes.filter((n) => ids.has(n.id)));
      if (box) {
        this.animateTo(fitTransform(box, this.width, this.height, { margin: 96, maxK: 1.8 }));
        return;
      }
    }
    const k = Math.max(this.camera.k, 1.1);
    this.animateTo({ k, x: this.width / 2 - node.x * k, y: this.height / 2 - node.y * k });
  }

  /** Jump straight to where a wheel gesture is easing (tests, and anyone who wants no easing). */
  finishSmooth(): void {
    if (!this.smooth) return;
    this.camera = this.smooth;
    this.smooth = null;
    this.syncZoom();
  }

  /** The node at a screen point, for tests and hit testing. */
  nodeAt(px: number, py: number): SimNode | undefined {
    if (!this.sim) return undefined;
    const gx = (px - this.camera.x) / this.camera.k;
    const gy = (py - this.camera.y) / this.camera.k;
    return this.sim.find(gx, gy, HIT_RADIUS / Math.max(this.camera.k, 0.4));
  }

  /** Where a node is on screen right now (for tests and tooltips). */
  screenOf(id: string): { x: number; y: number } | null {
    const n = this.sim?.nodes.find((m) => m.id === id);
    if (!n || n.x === undefined || n.y === undefined) return null;
    return { x: n.x * this.camera.k + this.camera.x, y: n.y * this.camera.k + this.camera.y };
  }

  // ── Loop ──────────────────────────────────────────────────────────────────────────────────

  private settling(): boolean {
    const sim = this.sim;
    return !!sim && this.mode === "force" && sim.alpha() > sim.simulation.alphaMin();
  }

  private lit(): boolean {
    return !!this.view.selectedId || (!!this.view.path && this.view.path.nodeIds.size > 0);
  }

  private keepAlive(): boolean {
    if (
      this.tween ||
      this.dragging ||
      this.settling() ||
      this.fading ||
      this.smooth ||
      this.inertia
    )
      return true;
    // The ambient flow along every relation runs for as long as motion is welcome at all.
    return !prefersReducedMotion();
  }

  schedule(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  private frame(now: number): void {
    this.raf = 0;
    const active =
      !!this.tween ||
      this.dragging ||
      this.settling() ||
      this.lit() ||
      this.fading ||
      !!this.smooth ||
      !!this.inertia ||
      !!this.hover;
    // Nothing but the ambient drift needs a redraw at rest: half the frame rate is smooth enough
    // for that, so an idle graph left open still costs little (the same trade the Memory
    // constellation makes for its own always-on sway).
    if (!active && !prefersReducedMotion() && now - this.lastFrame < 45) {
      this.schedule();
      return;
    }
    this.lastFrame = now;
    if (this.tween) {
      const tw = this.tween;
      tw.start ??= now;
      const { from, to, start, ms } = tw;
      const p = Math.min(1, Math.max(0, (now - start) / ms));
      const e = easeInOut(p);
      this.camera = {
        k: from.k + (to.k - from.k) * e,
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
      };
      this.syncZoom();
      if (p >= 1) this.tween = null;
    } else if (!this.interacted && this.mode === "force" && this.settling()) {
      // Until the person takes the camera, it follows the graph as it settles.
      const target = this.fitCamera();
      if (target) {
        const c = this.camera;
        this.camera = {
          k: c.k + (target.k - c.k) * 0.12,
          x: c.x + (target.x - c.x) * 0.12,
          y: c.y + (target.y - c.y) * 0.12,
        };
        this.syncZoom();
      }
    }
    // A wheel gesture eases the camera to its target; a released pan coasts to a stop.
    const dt = Math.min(48, this.lastNow ? now - this.lastNow : 16);
    this.lastNow = now;
    if (this.smooth) {
      const c = this.camera;
      const t = this.smooth;
      const f = prefersReducedMotion() ? 1 : 0.24;
      const next = { k: c.k + (t.k - c.k) * f, x: c.x + (t.x - c.x) * f, y: c.y + (t.y - c.y) * f };
      const close =
        Math.abs(t.k - next.k) < 0.002 &&
        Math.abs(t.x - next.x) < 0.4 &&
        Math.abs(t.y - next.y) < 0.4;
      this.camera = close ? t : next;
      if (close) this.smooth = null;
      this.syncZoom();
    }
    if (this.inertia) {
      const c = this.camera;
      this.camera = { k: c.k, x: c.x + this.inertia.vx * dt, y: c.y + this.inertia.vy * dt };
      const decay = Math.pow(0.93, dt / 16);
      this.inertia = { vx: this.inertia.vx * decay, vy: this.inertia.vy * decay };
      if (Math.hypot(this.inertia.vx, this.inertia.vy) < 0.02) this.inertia = null;
      this.syncZoom();
    }
    this.stepFade();
    this.draw(now);
    this.drawMinimap();
    this.reportState();
    if (this.keepAlive()) this.schedule();
  }

  private lastZoom = -1;

  private reportState(): void {
    const pct = Math.round(this.camera.k * 100);
    if (pct !== this.lastZoom) {
      this.lastZoom = pct;
      this.cb.onZoom?.(pct);
    }
    const { path, selectedId, hiddenCount } = this.view;
    const state: GraphState = this.settling()
      ? "settling"
      : path && path.nodeIds.size > 0
        ? "path-mode"
        : selectedId
          ? "node-selected"
          : hiddenCount > 0
            ? "filtered"
            : "settled";
    if (state !== this.lastState) {
      this.lastState = state;
      this.cb.onState?.(state);
    }
  }

  // ── Minimap ───────────────────────────────────────────────────────────────────────────────

  /** A small overview of the whole graph with the visible window outlined; click to jump. */
  attachMinimap(canvas: HTMLCanvasElement | null): void {
    this.minimap = canvas;
    this.schedule();
  }

  /** The mapping between graph space and the minimap's pixels. */
  private minimapFrame(w: number, h: number) {
    const box = this.sim ? boundsOf(this.sim.nodes) : null;
    if (!box) return null;
    const pad = 12;
    const bw = Math.max(1, box.x1 - box.x0);
    const bh = Math.max(1, box.y1 - box.y0);
    // Include the current window so it never leaves the minimap.
    const cam = this.camera;
    const vx0 = -cam.x / cam.k;
    const vy0 = -cam.y / cam.k;
    const vx1 = vx0 + this.width / cam.k;
    const vy1 = vy0 + this.height / cam.k;
    const x0 = Math.min(box.x0, vx0);
    const y0 = Math.min(box.y0, vy0);
    const x1 = Math.max(box.x0 + bw, vx1);
    const y1 = Math.max(box.y0 + bh, vy1);
    const k = Math.min((w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0));
    const ox = (w - (x1 - x0) * k) / 2 - x0 * k;
    const oy = (h - (y1 - y0) * k) / 2 - y0 * k;
    return { k, ox, oy, vx0, vy0, vx1, vy1 };
  }

  /** Move the camera so the given minimap point is the centre of the view; `instant` follows a drag. */
  minimapJump(px: number, py: number, instant = false): void {
    const m = this.minimap;
    if (!m) return;
    const f = this.minimapFrame(m.clientWidth, m.clientHeight);
    if (!f) return;
    this.interacted = true;
    const gx = (px - f.ox) / f.k;
    const gy = (py - f.oy) / f.k;
    const k = this.camera.k;
    const to = { k, x: this.width / 2 - gx * k, y: this.height / 2 - gy * k };
    if (instant) {
      this.smooth = null;
      this.inertia = null;
      this.tween = null;
      this.camera = to;
      this.syncZoom();
      this.schedule();
    } else this.animateTo(to, 260);
  }

  private drawMinimap(): void {
    const m = this.minimap;
    const sim = this.sim;
    const ctx = m?.getContext("2d");
    if (!m || !ctx || !sim) return;
    const dpr = window.devicePixelRatio || 1;
    const w = m.clientWidth;
    const h = m.clientHeight;
    if (m.width !== Math.round(w * dpr) || m.height !== Math.round(h * dpr)) {
      m.width = Math.round(w * dpr);
      m.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const f = this.minimapFrame(w, h);
    if (!f) return;
    for (const n of sim.nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      ctx.globalAlpha = Math.max(0.25, this.nodeAlpha(n.id));
      ctx.fillStyle = n.color ?? typeColor(n.type, OBJECT_TYPE_STYLE[n.type].color);
      ctx.beginPath();
      ctx.arc(n.x * f.k + f.ox, n.y * f.k + f.oy, Math.max(1.4, n.r * f.k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The window you are looking at: a tinted, outlined rectangle you can drag.
    const rx = f.vx0 * f.k + f.ox;
    const ry = f.vy0 * f.k + f.oy;
    const rw = (f.vx1 - f.vx0) * f.k;
    const rh = (f.vy1 - f.vy0) * f.k;
    ctx.fillStyle = C.accent;
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = C.accent;
    ctx.beginPath();
    ctx.roundRect(rx, ry, rw, rh, 4);
    ctx.stroke();
  }

  // ── Drawing ───────────────────────────────────────────────────────────────────────────────

  private nodeAlpha(id: string): number {
    const { path, selectedId, focusMode } = this.view;
    if (path && path.nodeIds.size > 0) return path.nodeIds.has(id) ? 1 : 0.14;
    if (selectedId) {
      if (focusMode) return this.near1?.has(id) ? 1 : 0.07;
      return this.near2?.has(id) ? 1 : 0.2;
    }
    return 1;
  }

  private edgeAlpha(l: SimLink): number {
    const { path, selectedId, focusMode } = this.view;
    const a = l.source.id;
    const b = l.target.id;
    if (path && path.nodeIds.size > 0) return path.edgeIds.has(l.id) ? 1 : 0.06;
    if (selectedId) {
      if (a === selectedId || b === selectedId) return 1;
      if (focusMode) return 0.03;
      return this.near2?.has(a) && this.near2.has(b) ? 0.5 : 0.07;
    }
    return 1;
  }

  private pathOn(): boolean {
    return !!this.view.path && this.view.path.nodeIds.size > 0;
  }

  /** Where a node's opacity is heading: hover lights its neighbourhood, the selection its own. */
  private targetNode(id: string): number {
    if (this.hover && this.hoverNear && !this.pathOn()) return this.hoverNear.has(id) ? 1 : 0.13;
    return this.nodeAlpha(id);
  }

  private targetEdge(l: SimLink): number {
    if (this.hover && !this.pathOn())
      return l.source.id === this.hover || l.target.id === this.hover ? 1 : 0.05;
    return this.edgeAlpha(l);
  }

  private fa(id: string): number {
    return this.fadeNode.get(id) ?? this.targetNode(id);
  }

  private ea(l: SimLink): number {
    return this.fadeEdge.get(l.id) ?? this.targetEdge(l);
  }

  /** One step of the easing every node and link takes towards its target opacity. */
  private stepFade(): void {
    const sim = this.sim;
    if (!sim) return;
    const k = prefersReducedMotion() ? 1 : 0.2;
    let moving = false;
    for (const n of sim.nodes) {
      const t = this.targetNode(n.id);
      const c = this.fadeNode.get(n.id) ?? t;
      const v = Math.abs(t - c) < 0.012 ? t : c + (t - c) * k;
      if (v !== t) moving = true;
      this.fadeNode.set(n.id, v);
    }
    for (const l of sim.links) {
      const t = this.targetEdge(l);
      const c = this.fadeEdge.get(l.id) ?? t;
      const v = Math.abs(t - c) < 0.012 ? t : c + (t - c) * k;
      if (v !== t) moving = true;
      this.fadeEdge.set(l.id, v);
    }
    this.fading = moving;
  }

  private tone(style: EdgeStyle): string {
    const t = style.tone;
    if (t === "muted") return C.fgMuted;
    if (t === "accent") return C.accent;
    if (t === "positive") return C.positive;
    return typeColor(t.type, OBJECT_TYPE_STYLE[t.type].color);
  }

  /** The link under a screen point, within a few pixels. */
  edgeAt(px: number, py: number): SimLink | undefined {
    const sim = this.sim;
    if (!sim) return undefined;
    const c = this.camera;
    let best: SimLink | undefined;
    let bestD = 6;
    for (const l of sim.links) {
      const { x: ax, y: ay } = l.source;
      const { x: bx, y: by } = l.target;
      if (ax === undefined || ay === undefined || bx === undefined || by === undefined) continue;
      const x1 = ax * c.k + c.x;
      const y1 = ay * c.k + c.y;
      const x2 = bx * c.k + c.x;
      const y2 = by * c.k + c.y;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
      const d = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    return best;
  }

  private setHover(id: string | null, edge: SimLink | null): void {
    if (id === this.hover && edge === this.hoverEdge) return;
    this.hover = id;
    this.hoverEdge = id ? null : edge;
    const sim = this.sim;
    this.hoverNear =
      id && sim
        ? neighbourhood(
            sim.links.map((l) => ({ from: l.source.id, to: l.target.id })),
            id,
            1,
          )
        : null;
    if (this.canvas) this.canvas.style.cursor = id ? "pointer" : "grab";
    this.schedule();
  }

  private isLit(l: SimLink): boolean {
    if (this.hover && !this.pathOn())
      return l.source.id === this.hover || l.target.id === this.hover;
    if (this.hoverEdge && this.hoverEdge.id === l.id) return true;
    const { path, selectedId } = this.view;
    if (path && path.nodeIds.size > 0) return path.edgeIds.has(l.id);
    return !!selectedId && (l.source.id === selectedId || l.target.id === selectedId);
  }

  private draw(now: number): void {
    const canvas = this.canvas;
    const ctx = canvas?.getContext("2d");
    const sim = this.sim;
    if (!canvas || !ctx || !sim) return;
    const cam = this.camera;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const { selectedId: selected, path, accent } = this.view;
    const pathOn = !!path && path.nodeIds.size > 0;
    const reduced = prefersReducedMotion();

    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.k, cam.k);

    // Links: each kind has its own width, dash and colour; the ones touching the hovered or
    // selected node are raised, the rest recede (opacity eases, never snaps).
    for (const l of sim.links) {
      const { x: x1, y: y1 } = l.source;
      const { x: x2, y: y2 } = l.target;
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) continue;
      const style = EDGE_STYLE[l.kind];
      const lit = this.isLit(l);
      const color = this.tone(style);
      ctx.globalAlpha = this.ea(l) * (lit ? Math.min(1, style.alpha + 0.35) : style.alpha);
      ctx.lineWidth = (style.width * (lit ? 1.45 : 1)) / cam.k;
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.setLineDash(style.dash ? style.dash.map((d) => (d * (lit ? 1.2 : 1)) / cam.k) : []);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      if (style.arrow) {
        // The arrow points at what is depended on, funded by or derived from.
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const tip = l.target.r * 1.15 + 2;
        const ax = x2 - Math.cos(angle) * tip;
        const ay = y2 - Math.sin(angle) * tip;
        const sz = (lit ? 8 : 6.5) / cam.k;
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - Math.cos(angle - 0.45) * sz, ay - Math.sin(angle - 0.45) * sz);
        ctx.lineTo(ax - Math.cos(angle + 0.45) * sz, ay - Math.sin(angle + 0.45) * sz);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.setLineDash([]);

    // Flow: small particles drift along every relation, in the direction it acts — quietly by
    // default, brighter and faster along the one relation under investigation (a selection or a
    // path), so the graph reads as a live network even at rest, not a static diagram.
    if (!reduced) {
      for (const l of sim.links) {
        const base = this.ea(l);
        if (base <= 0.02) continue; // dimmed out of visibility already; skip the work
        const from = flowsFromTarget(l) ? l.target : l.source;
        const to = flowsFromTarget(l) ? l.source : l.target;
        if (
          from.x === undefined ||
          from.y === undefined ||
          to.x === undefined ||
          to.y === undefined
        )
          continue;
        const lit = this.isLit(l);
        const len = Math.hypot(to.x - from.x, to.y - from.y);
        // One ambient particle regardless of length: the fixed period already scales its speed
        // to the edge (short hop or long haul, it still crosses in the same 7s), so there is no
        // short-edge case where it would look like a flicker instead of a drift.
        const count = lit ? Math.max(1, Math.min(4, Math.round(len / 70))) : 1;
        const period = lit ? 2600 : 7000; // ambient drift is slow: a pulse, not a stream
        const peak = lit ? 0.85 : 0.32; // matches the quiet edge's own resting alpha
        const radius = (lit ? 1.9 : 1.5) / cam.k;
        const phase = (now / period) % 1;
        ctx.fillStyle = lit ? C.fg : C.fgMuted;
        for (let i = 0; i < count; i++) {
          const tt = (phase + i / count) % 1;
          ctx.globalAlpha = base * peak * Math.sin(Math.PI * tt); // fade at the ends: no popping
          ctx.beginPath();
          ctx.arc(
            from.x + (to.x - from.x) * tt,
            from.y + (to.y - from.y) * tt,
            radius,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    }

    // Nodes: the shape says what it is, the colour says which project it belongs to, the size how
    // important or how far along it is.
    for (const n of sim.nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      const isSel = n.id === selected;
      const isHover = n.id === this.hover;
      const ring = 5 / Math.max(cam.k, 0.6);
      const shape = SHAPE_OF[n.type];
      const fill = n.color ?? typeColor(n.type, OBJECT_TYPE_STYLE[n.type].color);
      ctx.globalAlpha = this.fa(n.id);
      if (n.type === "project") {
        // A soft halo marks the anchor of a group.
        ctx.globalAlpha = this.fa(n.id) * 0.18;
        ctx.fillStyle = fill;
        traceShape(ctx, "circle", n.x, n.y, n.r + 9);
        ctx.fill();
        ctx.globalAlpha = this.fa(n.id);
      }
      if (isSel) {
        ctx.lineWidth = 2 / cam.k;
        ctx.strokeStyle = accent ? C.accent : C.fg;
        traceShape(ctx, shape, n.x, n.y, n.r + ring);
        ctx.stroke();
      } else if (pathOn && path!.nodeIds.has(n.id)) {
        ctx.lineWidth = 1.5 / cam.k;
        ctx.strokeStyle = C.fg;
        traceShape(ctx, shape, n.x, n.y, n.r + ring * 0.6);
        ctx.stroke();
      }
      ctx.fillStyle = fill;
      ctx.strokeStyle = C.surface;
      ctx.lineWidth = 2 / cam.k;
      traceShape(ctx, shape, n.x, n.y, n.r + (isHover ? 2 : 0));
      ctx.fill();
      ctx.stroke();
      if (isHover && !isSel) {
        ctx.strokeStyle = fill;
        ctx.lineWidth = 1.5 / cam.k;
        traceShape(ctx, shape, n.x, n.y, n.r + ring);
        ctx.stroke();
      }
    }
    ctx.restore();
    this.drawLabels(ctx);
    ctx.globalAlpha = 1;
  }

  /**
   * Labels and relation names are set in screen space so they keep their size at any zoom, and
   * are placed greedily so none prints over another.
   */
  private drawLabels(ctx: CanvasRenderingContext2D): void {
    const sim = this.sim as GraphSim;
    const cam = this.camera;
    const { selectedId: selected, path } = this.view;
    const pathOn = !!path && path.nodeIds.size > 0;
    ctx.font = `${LABEL_PX}px ${this.labelFont}`;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const take = (box: (typeof placed)[number], force = false): boolean => {
      if (
        !force &&
        placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)
      )
        return false;
      placed.push(box);
      return true;
    };
    const sx = (n: SimNode) => (n.x as number) * cam.k + cam.x;
    const sy = (n: SimNode) => (n.y as number) * cam.k + cam.y;
    const inFrame = (x: number, y: number) =>
      x > -40 && y > -20 && x < this.width + 40 && y < this.height + 20;

    // Projects and sub-projects are always named; everything else when it is hovered, close to
    // the hovered or selected node, or once you have zoomed in far enough to have room.
    const isHead = (n: SimNode) => n.type === "project" || n.type === "sub_project";
    const wanted = sim.nodes
      .filter((n) => n.x !== undefined && n.y !== undefined)
      .filter((n) => {
        if (isHead(n) || n.id === selected || n.id === this.hover || pathOn) return true;
        if (this.hover) return !!this.hoverNear?.has(n.id);
        if (selected) return !!this.near1?.has(n.id);
        return cam.k >= 1.7;
      })
      .sort(
        (a, b) =>
          Number(b.id === this.hover) - Number(a.id === this.hover) ||
          Number(b.id === selected) - Number(a.id === selected) ||
          Number(b.type === "project") - Number(a.type === "project") ||
          Number(isHead(b)) - Number(isHead(a)) ||
          b.weight - a.weight,
      );
    for (const n of wanted) {
      const x = sx(n);
      const y = sy(n);
      if (!inFrame(x, y)) continue;
      const head = isHead(n);
      const strong = n.id === selected || n.id === this.hover;
      const size = n.type === "project" ? 14 : head ? 12.5 : LABEL_PX;
      ctx.font = `${head || strong ? 600 : 400} ${size}px ${this.labelFont}`;
      const text = n.title.length > 34 ? `${n.title.slice(0, 33)}…` : n.title;
      const w = ctx.measureText(text).width;
      const rx = x + n.r * cam.k + 8;
      // Heads are never dropped for lack of room; the rest wait their turn.
      if (!take({ x0: rx - 2, x1: rx + w + 2, y0: y - 9, y1: y + 9 }, strong || head)) continue;
      ctx.globalAlpha = Math.max(this.fa(n.id), head ? 0.45 : 0);
      ctx.lineWidth = 4;
      ctx.strokeStyle = C.bg;
      ctx.strokeText(text, rx, y);
      ctx.fillStyle = strong || head ? C.fg : C.fgMuted;
      ctx.fillText(text, rx, y);
    }
    ctx.globalAlpha = 1;

    // The name of each relation touching the hovered (or selected) node, and of a hovered link.
    const focus = this.hover ?? selected;
    if ((focus || this.hoverEdge) && cam.k >= 0.4) {
      ctx.font = `11px ${this.labelFont}`;
      ctx.textAlign = "center";
      let shown = 0;
      const shownLinks = this.hoverEdge ? [this.hoverEdge] : [];
      for (const l of sim.links)
        if (focus && (l.source.id === focus || l.target.id === focus) && l !== this.hoverEdge)
          shownLinks.push(l);
      for (const l of shownLinks) {
        if (shown >= 12) break;
        if (l.source.x === undefined || l.target.x === undefined) continue;
        const mx = ((l.source.x + l.target.x) / 2) * cam.k + cam.x;
        const my = (((l.source.y ?? 0) + (l.target.y ?? 0)) / 2) * cam.k + cam.y;
        if (!inFrame(mx, my)) continue;
        const text = this.cb.edgeName(l.kind);
        ctx.fillStyle = C.fgMuted;
        const w = ctx.measureText(text).width;
        if (
          !take(
            { x0: mx - w / 2 - 3, x1: mx + w / 2 + 3, y0: my - 8, y1: my + 8 },
            l === this.hoverEdge,
          )
        )
          continue;
        ctx.lineWidth = 4;
        ctx.strokeStyle = C.bg;
        ctx.strokeText(text, mx, my);
        ctx.fillStyle = this.tone(EDGE_STYLE[l.kind]);
        ctx.fillText(text, mx, my);
        shown++;
      }
      ctx.textAlign = "start";
    }

    // Hover card: the type, because colour alone must not carry it.
    const hovered = this.hover ? sim.nodes.find((n) => n.id === this.hover) : undefined;
    if (hovered && hovered.x !== undefined && !this.dragging) {
      ctx.font = `11px ${this.labelFont}`;
      const text = this.cb.typeName(hovered.type).toUpperCase();
      const w = ctx.measureText(text).width;
      const x = sx(hovered) - w / 2 - 6;
      const y = sy(hovered) - hovered.r * cam.k - 28;
      ctx.fillStyle = C.surface;
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, w + 12, 18, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.fgMuted;
      ctx.fillText(text, x + 6, y + 9);
    }
  }

  // ── Gestures ──────────────────────────────────────────────────────────────────────────────

  attach(canvas: HTMLCanvasElement): void {
    this.detach?.();
    this.disposed = false;
    this.canvas = canvas;
    this.labelFont = getComputedStyle(canvas).fontFamily || this.labelFont;
    const el = select(canvas);
    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };

    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([MIN_K, MAX_K])
      .filter((event: Event) => {
        if (event.type === "wheel") return false; // handled below, with easing
        if (event.type === "dblclick") return false;
        const e = event as MouseEvent;
        if (e.button) return false;
        const point = event.type.startsWith("touch") ? (event as TouchEvent).touches[0] : e;
        if (!point) return true;
        const [px, py] = local(point);
        return !this.nodeAt(px, py); // a press on a node drags the node, not the canvas
      })
      .on("start", () => {
        this.interacted = true;
        this.tween = null;
        this.smooth = null;
        this.inertia = null;
        this.samples = [];
      })
      .on("zoom", (event) => {
        const tr = event.transform as { k: number; x: number; y: number };
        this.camera = { k: tr.k, x: tr.x, y: tr.y };
        if (event.sourceEvent) {
          this.samples.push({ t: performance.now(), x: tr.x, y: tr.y });
          if (this.samples.length > 6) this.samples.shift();
        }
        this.schedule();
      })
      .on("end", (event) => {
        // Let go of a pan while still moving and the graph coasts on, slowing down.
        const last = this.samples[this.samples.length - 1];
        const first = this.samples.find((p) => last && last.t - p.t < 90);
        this.samples = [];
        if (!event.sourceEvent || !last || !first || last.t === first.t) return;
        if (performance.now() - last.t > 60 || prefersReducedMotion()) return;
        const vx = (last.x - first.x) / (last.t - first.t);
        const vy = (last.y - first.y) / (last.t - first.t);
        if (Math.hypot(vx, vy) > 0.15) {
          this.inertia = { vx: Math.max(-4, Math.min(4, vx)), vy: Math.max(-4, Math.min(4, vy)) };
          this.schedule();
        }
      });
    this.zoomBehavior = zoomBehavior;
    el.call(zoomBehavior).on("dblclick.zoom", null);
    this.syncZoom();

    // Dragging a node: it follows the pointer, its neighbours are pulled along, and when it is
    // let go the layout relaxes again.
    let downAt: readonly [number, number] = [0, 0];
    let moved = 0;
    const dragBehavior = drag<
      HTMLCanvasElement,
      unknown,
      { node: SimNode; x: number; y: number } | undefined
    >()
      .subject((event: D3DragEvent<HTMLCanvasElement, unknown, unknown>) => {
        const node = this.nodeAt(event.x, event.y);
        return node && node.x !== undefined && node.y !== undefined
          ? {
              node,
              x: node.x * this.camera.k + this.camera.x,
              y: node.y * this.camera.k + this.camera.y,
            }
          : undefined;
      })
      .on("start", (event) => {
        const s = event.subject as { node: SimNode };
        downAt = [event.sourceEvent.clientX ?? 0, event.sourceEvent.clientY ?? 0];
        moved = 0;
        this.interacted = true;
        this.tween = null;
        this.dragging = true;
        if (this.mode === "force") this.sim?.dragStart(s.node);
        this.schedule();
      })
      .on("drag", (event) => {
        const s = event.subject as { node: SimNode };
        moved = Math.max(
          moved,
          Math.hypot(
            (event.sourceEvent.clientX ?? 0) - downAt[0],
            (event.sourceEvent.clientY ?? 0) - downAt[1],
          ),
        );
        if (this.mode === "force")
          this.sim?.dragTo(
            s.node,
            (event.x - this.camera.x) / this.camera.k,
            (event.y - this.camera.y) / this.camera.k,
          );
        this.schedule();
      })
      .on("end", (event) => {
        const s = event.subject as { node: SimNode };
        this.dragging = false;
        if (this.mode === "force") this.sim?.dragEnd(s.node);
        // A press that barely moved is a click: select, or clear when it is already selected.
        if (moved < CLICK_SLOP)
          this.cb.onSelect?.(s.node.id === this.view.selectedId ? null : s.node.id);
        this.schedule();
      });
    el.call(dragBehavior);

    // Hover, click on empty space, and double-click.
    let pressed: readonly [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      pressed = [e.clientX, e.clientY];
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return;
      const [px, py] = local(e);
      const id = this.nodeAt(px, py)?.id ?? null;
      this.setHover(id, id ? null : (this.edgeAt(px, py) ?? null));
    };
    const onLeave = () => this.setHover(null, null);
    // The wheel zooms towards the cursor, easing to its target instead of jumping.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [px, py] = local(e);
      const base = this.smooth ?? this.camera;
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0016;
      const k = Math.min(MAX_K, Math.max(MIN_K, base.k * Math.exp(-e.deltaY * unit)));
      const gx = (px - base.x) / base.k;
      const gy = (py - base.y) / base.k;
      this.interacted = true;
      this.tween = null;
      this.inertia = null;
      this.smooth = { k, x: px - gx * k, y: py - gy * k };
      this.schedule();
    };
    const onClick = (e: MouseEvent) => {
      const travelled = pressed ? Math.hypot(e.clientX - pressed[0], e.clientY - pressed[1]) : 0;
      if (travelled > CLICK_SLOP) return; // that was a pan
      const [px, py] = local(e);
      if (!this.nodeAt(px, py)) this.cb.onSelect?.(null);
    };
    const onDouble = (e: MouseEvent) => {
      const [px, py] = local(e);
      const node = this.nodeAt(px, py);
      if (node) {
        this.cb.onOpen?.(node.id);
        return;
      }
      // Double-click on empty space zooms in toward it.
      const c = this.camera;
      const k = Math.min(MAX_K, c.k * 1.8);
      const gx = (px - c.x) / c.k;
      const gy = (py - c.y) / c.k;
      this.interacted = true;
      this.animateTo({ k, x: px - gx * k, y: py - gy * k }, 260);
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("dblclick", onDouble);
    canvas.style.cursor = "grab";

    this.detach = () => {
      el.on(".zoom", null).on(".drag", null);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("dblclick", onDouble);
    };
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    this.detach?.();
    this.detach = null;
    this.sim?.stop();
    this.sim = null;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas = null;
    this.minimap = null;
    this.zoomBehavior = null;
  }
}
