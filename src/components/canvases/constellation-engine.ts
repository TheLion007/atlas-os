import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  LineSegments,
  PerspectiveCamera,
  Points,
  RedFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from "three";
import {
  constellationNeighbours,
  type Constellation,
  type ConstellationCluster,
  type ConstellationNode,
} from "@/domain/memory-constellation";
import { BG, CONSTELLATION_COLORS, contextColorHex } from "@/design/tokens";
import { prefersReducedMotion } from "./graph-engine";
import { clusterRadius, hash01, type Point3 } from "./constellation-layout";

/**
 * The Memory Graph renderer: a WebGL (three.js) scene of glowing points, bundles of fine fibres
 * and a few slow particles of "information" travelling along them, with minimal HTML labels laid
 * over it. Like `GraphEngine`, it is a plain class the React component only feeds.
 *
 * Every mark is data (see `memory-constellation.ts`): one point per memory, project hub or
 * related object; one bundle of fibres per real or inferred relation, its strand count and
 * brightness set by the relation's strength; one faint light per cluster, sized by its members.
 *
 * Performance: all geometry is built once per data change into a few buffers (one draw call
 * each). Hover and selection never touch those buffers — emphasis lives in two small float
 * textures indexed by node and by link, eased on the CPU and re-uploaded only while changing.
 * The fibre budget is capped so thousands of memories stay interactive.
 */

export interface ConstellationText {
  /** The second line of a memory label, e.g. "FACT · FINANCE". */
  meta: (node: ConstellationNode, cluster: ConstellationCluster | undefined) => string;
  /** The label of a cluster; for the unfiled group, the translated word. */
  cluster: (cluster: ConstellationCluster) => string;
}

export interface ConstellationCallbacks {
  onSelect?: (id: string | null) => void;
  onOpen?: (id: string) => void;
}

type RGB = [number, number, number];

const FOV = 38;
const TAN = Math.tan(((FOV / 2) * Math.PI) / 180);
const MIN_DIST = 40;
const MAX_DIST = 9000;
/** Vertices of fibre geometry we allow ourselves; beyond it strands and segments are thinned. */
const FIBRE_VERTEX_BUDGET = 700_000;
const MAX_PARTICLES = 5000;
const TEX_W = 1024;
const CLICK_SLOP = 5;
const MAX_LABELS = 70;

// ── Colour ───────────────────────────────────────────────────────────────────────────────────

function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function rgbToHsl([r, g, b]: RGB): RGB {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: RGB): RGB {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/**
 * The light a cluster gives off: its project's own colour made luminous (same hue, lifted and
 * gently saturated), or a hue from the constellation's controlled set.
 */
export function clusterLight(cluster: ConstellationCluster): RGB {
  const hex =
    contextColorHex(cluster.color) ??
    CONSTELLATION_COLORS.hues[
      Math.floor(hash01(cluster.id) * CONSTELLATION_COLORS.hues.length) %
        CONSTELLATION_COLORS.hues.length
    ];
  if (cluster.source === "unfiled") return hexToRgb(CONSTELLATION_COLORS.neutral);
  const [h, s, l] = rgbToHsl(hexToRgb(hex ?? CONSTELLATION_COLORS.neutral));
  return hslToRgb([h, Math.min(0.72, Math.max(0.42, s * 1.15)), Math.min(0.7, Math.max(0.6, l))]);
}

const cssRgb = ([r, g, b]: RGB) =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;

// ── Shaders ──────────────────────────────────────────────────────────────────────────────────

const EMPH_FETCH = /* glsl */ `
  uniform sampler2D uEmph;
  float emph(float idx) {
    int i = int(idx + 0.5);
    return texelFetch(uEmph, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0).r;
  }
  uniform float uNear;
  uniform float uFar;
  float depthFade(float depth) { return mix(0.22, 1.0, smoothstep(uFar, uNear, depth)); }
`;

const POINT_VERT = /* glsl */ `
  attribute vec3 color;
  attribute float aSize;
  attribute float aMinPx;
  attribute float aPhase;
  attribute float aIndex;
  attribute float aAlpha;
  uniform float uTime;
  uniform float uPx;
  uniform float uTwinkle;
  ${EMPH_FETCH}
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float depth = -mv.z;
    float e = emph(aIndex);
    float tw = 1.0 + uTwinkle * 0.16 * sin(uTime * 0.00032 + aPhase * 6.2831);
    gl_PointSize = clamp(max(aSize * uPx / depth, aMinPx) * (0.8 + 0.28 * e), 1.0, 320.0);
    vColor = color;
    vAlpha = aAlpha * depthFade(depth) * tw * e;
  }
`;

const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float halo = exp(-d * 5.0) - exp(-5.0);
    float core = smoothstep(0.07, 0.0, d);
    vec3 c = vColor * halo + vec3(1.0) * core * 0.55;
    gl_FragColor = vec4(c, clamp(vAlpha, 0.0, 1.0) * (halo + core));
  }
`;

const GLOW_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float g = exp(-d * 3.2) - exp(-3.2);
    gl_FragColor = vec4(vColor, clamp(vAlpha, 0.0, 1.0) * g);
  }
`;

const FIBRE_VERT = /* glsl */ `
  attribute vec3 color;
  attribute float aAlpha;
  attribute float aIndex;
  ${EMPH_FETCH}
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vColor = color;
    vAlpha = aAlpha * emph(aIndex) * depthFade(-mv.z);
  }
`;

const FIBRE_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(vColor, clamp(vAlpha, 0.0, 1.0)); }
`;

const FLOW_VERT = /* glsl */ `
  attribute vec3 color;
  attribute vec3 aP1;
  attribute vec3 aP2;
  attribute float aSpeed;
  attribute float aPhase;
  attribute float aIndex;
  attribute float aBase;
  uniform float uTime;
  uniform float uPx;
  uniform float uFlow;
  ${EMPH_FETCH}
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float t = fract(uTime * aSpeed + aPhase);
    float u = 1.0 - t;
    vec3 p = u * u * position + 2.0 * u * t * aP1 + t * t * aP2;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float e = emph(aIndex);
    float visible = max(aBase, step(1.8, e));
    gl_PointSize = clamp(max(2.4 * uPx / -mv.z, 2.0), 1.0, 8.0);
    vColor = color;
    // Fade in and out at the ends, so nothing pops.
    vAlpha = uFlow * visible * sin(3.14159 * t) * 0.9 * min(e, 2.2) * depthFade(-mv.z);
  }
`;

// ── Engine ───────────────────────────────────────────────────────────────────────────────────

/** The camera looks at (x, y, z) from `dist` away. */
interface Camera3 {
  x: number;
  y: number;
  z: number;
  dist: number;
}

interface LabelEl {
  el: HTMLDivElement;
  w: number;
  h: number;
  shown: boolean;
  lastShown: number;
  /** Whether the secondary line was visible when `w`/`h` were measured. */
  detailed: boolean;
}

const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** A small, fast, seeded generator (per link, so a link always curves the same way). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

export class ConstellationEngine {
  width = 960;
  height = 600;
  cam: Camera3 = { x: 0, y: 0, z: 0, dist: 800 };

  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 16 / 10, 1, 40000);
  private canvas: HTMLCanvasElement | null = null;
  private labelLayer: HTMLDivElement | null = null;
  private cb: ConstellationCallbacks = {};
  private text: ConstellationText = { meta: () => "", cluster: (c) => c.title };

  private data: Constellation | null = null;
  private placed: Map<string, Point3> | undefined;
  private pos: Float32Array = new Float32Array(0);
  private nodeColor: RGB[] = [];
  private clusterById = new Map<string, ConstellationCluster>();
  private clusterIdx = new Map<string, number>();
  private clusterCentre: Point3[] = [];
  private clusterExtent: number[] = [];
  private idIndex = new Map<string, number>();
  private span = 400;

  private objects: { dispose: () => void }[] = [];
  private uniforms = {
    uTime: { value: 0 },
    uPx: { value: 1 },
    uTwinkle: { value: 1 },
    uFlow: { value: 1 },
    uNear: { value: 0 },
    uFar: { value: 1 },
  };
  private nodeEmph = {
    tex: null as DataTexture | null,
    cur: new Float32Array(0),
    to: new Float32Array(0),
  };
  private linkEmph = {
    tex: null as DataTexture | null,
    cur: new Float32Array(0),
    to: new Float32Array(0),
  };
  private glowEmph = {
    tex: null as DataTexture | null,
    cur: new Float32Array(0),
    to: new Float32Array(0),
  };
  private easing = false;

  private selectedId: string | null = null;
  private hover: number | null = null;
  private screen = new Float32Array(0); // x, y, depth per node
  private labels = new Map<string, LabelEl>();
  private tween: { from: Camera3; to: Camera3; start: number | null; ms: number } | null = null;
  private fitted = false;
  private raf = 0;
  private lastFrame = 0;
  private lastInput = 0;
  private start = typeof performance !== "undefined" ? performance.now() : 0;
  private detach: (() => void) | null = null;
  private tmp = new Vector3();

  configure(cb: ConstellationCallbacks, text: ConstellationText): void {
    this.cb = cb;
    this.text = text;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────────────────

  attach(canvas: HTMLCanvasElement, labelLayer: HTMLDivElement): boolean {
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    try {
      this.renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      this.renderer = null;
      return false;
    }
    this.renderer.setClearColor(BG, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.bindGestures(canvas);
    this.schedule();
    return true;
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.detach?.();
    this.detach = null;
    this.clearScene();
    this.renderer?.dispose();
    this.renderer = null;
    for (const l of this.labels.values()) l.el.remove();
    this.labels.clear();
    this.canvas = null;
    this.labelLayer = null;
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer?.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (!this.fitted && this.data) this.cam = this.fitCamera() ?? this.cam;
    this.schedule();
  }

  setSelected(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.refreshEmphasis();
  }

  // ── Data → geometry ───────────────────────────────────────────────────────────────────────

  /** Where every point was last placed (fed back to the next layout, so nothing moves). */
  get placedPositions(): ReadonlyMap<string, Point3> | undefined {
    return this.placed;
  }

  /** Show a constellation at the given (already laid out) positions. */
  setData(c: Constellation, positions: Map<string, Point3>): void {
    this.placed = positions;
    this.data = c;
    this.clearScene();
    this.idIndex = new Map(c.nodes.map((n, i) => [n.id, i]));
    this.clusterById = new Map(c.clusters.map((cl) => [cl.id, cl]));
    this.clusterIdx = new Map(c.clusters.map((cl, i) => [cl.id, i]));
    const clusterRgb = c.clusters.map(clusterLight);

    // Positions (layout y grows downward; world y grows upward).
    const n = c.nodes.length;
    this.pos = new Float32Array(n * 3);
    c.nodes.forEach((node, i) => {
      const p = positions.get(node.id) ?? { x: 0, y: 0, z: 0 };
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = -p.y;
      this.pos[i * 3 + 2] = p.z;
    });
    this.nodeColor = c.nodes.map((node) => {
      const base = clusterRgb[this.clusterIdx.get(node.clusterId) ?? 0] ?? [0.7, 0.75, 0.8];
      // Satellites are the same light, paler: they are context, not knowledge.
      return node.kind === "satellite"
        ? (base.map((v) => v * 0.55 + 0.35) as RGB)
        : node.kind === "hub"
          ? (base.map((v) => Math.min(1, v * 1.08 + 0.04)) as RGB)
          : base;
    });
    this.clusterCentre = c.clusters.map((cl) => {
      let x = 0;
      let y = 0;
      let z = 0;
      let k = 0;
      c.nodes.forEach((node, i) => {
        if (node.clusterId !== cl.id) return;
        x += this.pos[i * 3]!;
        y += this.pos[i * 3 + 1]!;
        z += this.pos[i * 3 + 2]!;
        k++;
      });
      return k ? { x: x / k, y: y / k, z: z / k } : { x: 0, y: 0, z: 0 };
    });
    // How far each cluster actually reaches, so its name sits just above its light.
    // (Most of its members, not its farthest outlier.)
    const reach: number[][] = c.clusters.map(() => []);
    c.nodes.forEach((node, i) => {
      const ci = this.clusterIdx.get(node.clusterId);
      if (ci === undefined) return;
      const cc = this.clusterCentre[ci]!;
      reach[ci]!.push(Math.hypot(this.pos[i * 3]! - cc.x, this.pos[i * 3 + 1]! - cc.y));
    });
    this.clusterExtent = reach.map((d) => {
      d.sort((a, b) => a - b);
      return d[Math.floor((d.length - 1) * 0.85)] ?? 0;
    });
    let span = 1;
    for (let i = 0; i < n; i++)
      span = Math.max(span, Math.abs(this.pos[i * 3]!), Math.abs(this.pos[i * 3 + 1]!));
    this.span = span;

    this.nodeEmph = this.emphasis(n);
    this.linkEmph = this.emphasis(c.links.length);
    this.glowEmph = this.emphasis(c.clusters.length);

    this.buildGlow(c, clusterRgb);
    this.buildFibres(c);
    this.buildFlow(c);
    this.buildNodes(c);

    this.screen = new Float32Array(n * 3);
    if (this.hover !== null && this.hover >= n) this.hover = null;
    for (const [id, l] of this.labels)
      if (!this.idIndex.has(id) && !id.startsWith("cluster:")) {
        l.el.remove();
        this.labels.delete(id);
      }
    // Labels carry text that may have changed (a renamed memory): rebuild them lazily.
    for (const l of this.labels.values()) l.el.remove();
    this.labels.clear();
    if (!this.fitted) {
      const cam = this.fitCamera();
      if (cam) this.cam = cam;
    }
    this.refreshEmphasis(true);
    this.schedule();
  }

  private emphasis(count: number) {
    const size = Math.max(1, count);
    const rows = Math.ceil(size / TEX_W);
    const cur = new Float32Array(TEX_W * rows).fill(1);
    const to = new Float32Array(TEX_W * rows).fill(1);
    const tex = new DataTexture(cur, TEX_W, rows, RedFormat, FloatType);
    tex.needsUpdate = true;
    return { tex, cur, to };
  }

  private material(vert: string, frag: string, emph: DataTexture | null): ShaderMaterial {
    return new ShaderMaterial({
      uniforms: { ...this.uniforms, uEmph: { value: emph } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
  }

  private add(
    obj: Points | LineSegments,
    geom: BufferGeometry,
    mat: ShaderMaterial,
    order: number,
  ) {
    obj.frustumCulled = false;
    obj.renderOrder = order;
    this.scene.add(obj);
    this.objects.push({
      dispose: () => {
        this.scene.remove(obj);
        geom.dispose();
        mat.dispose();
      },
    });
  }

  private clearScene(): void {
    for (const o of this.objects) o.dispose();
    this.objects = [];
    for (const e of [this.nodeEmph, this.linkEmph, this.glowEmph]) e.tex?.dispose();
  }

  /** One faint light per cluster, as wide as its members spread: the cluster, without a circle. */
  private buildGlow(c: Constellation, rgb: RGB[]): void {
    const k = c.clusters.length;
    const geom = new BufferGeometry();
    const position = new Float32Array(k * 3);
    const color = new Float32Array(k * 3);
    const size = new Float32Array(k);
    const minPx = new Float32Array(k);
    const phase = new Float32Array(k);
    const index = new Float32Array(k);
    const alpha = new Float32Array(k);
    c.clusters.forEach((cl, i) => {
      const cc = this.clusterCentre[i]!;
      position.set([cc.x, cc.y, cc.z], i * 3);
      color.set(rgb[i]!, i * 3);
      size[i] = clusterRadius(cl.size) * 3.2;
      minPx[i] = 0;
      phase[i] = hash01(cl.id);
      index[i] = i;
      alpha[i] = cl.source === "unfiled" ? 0.05 : 0.11;
    });
    geom.setAttribute("position", new BufferAttribute(position, 3));
    geom.setAttribute("color", new BufferAttribute(color, 3));
    geom.setAttribute("aSize", new BufferAttribute(size, 1));
    geom.setAttribute("aMinPx", new BufferAttribute(minPx, 1));
    geom.setAttribute("aPhase", new BufferAttribute(phase, 1));
    geom.setAttribute("aIndex", new BufferAttribute(index, 1));
    geom.setAttribute("aAlpha", new BufferAttribute(alpha, 1));
    const mat = this.material(POINT_VERT, GLOW_FRAG, this.glowEmph.tex);
    this.add(new Points(geom, mat), geom, mat, 0);
  }

  /** Strand paths, shared by the fibres and the particles that travel them. */
  private strandsOf(li: number, strands: number): { p0: Point3; p1: Point3; p2: Point3 }[] {
    const c = this.data!;
    const l = c.links[li]!;
    const P = this.pos;
    const a = { x: P[l.a * 3]!, y: P[l.a * 3 + 1]!, z: P[l.a * 3 + 2]! };
    const b = { x: P[l.b * 3]!, y: P[l.b * 3 + 1]!, z: P[l.b * 3 + 2]! };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.max(1, Math.hypot(dx, dy, b.z - a.z));
    const nx = -dy / len;
    const ny = dx / len;
    const rand = rng(Math.floor(hash01(l.id) * 4294967295));
    const out: { p0: Point3; p1: Point3; p2: Point3 }[] = [];
    // A bundle bows to one side, like a nerve, with each strand fanning out a little.
    const bow = (rand() - 0.5) * 0.35 * len;
    for (let s = 0; s < strands; s++) {
      const spread = (rand() - 0.5) * Math.min(26, len * 0.22);
      const lift = (rand() - 0.5) * len * 0.22;
      const jitter = () => (rand() - 0.5) * 3.2;
      out.push({
        p0: { x: a.x + jitter(), y: a.y + jitter(), z: a.z + jitter() },
        p1: {
          x: (a.x + b.x) / 2 + nx * (bow + spread),
          y: (a.y + b.y) / 2 + ny * (bow + spread),
          z: (a.z + b.z) / 2 + lift,
        },
        p2: { x: b.x + jitter(), y: b.y + jitter(), z: b.z + jitter() },
      });
    }
    return out;
  }

  private strandCount(li: number): number {
    const l = this.data!.links[li]!;
    if (l.reason === "explicit") return 5;
    if (l.reason === "about") return 2;
    return 1 + Math.round(l.strength * 3);
  }

  private buildFibres(c: Constellation): void {
    if (c.links.length === 0) return;
    let strandsTotal = 0;
    for (let i = 0; i < c.links.length; i++) strandsTotal += this.strandCount(i);
    // Thin the geometry, never the relations, when the budget is exceeded.
    let segs = Math.floor(FIBRE_VERTEX_BUDGET / (2 * strandsTotal));
    let strandScale = 1;
    if (segs < 4) {
      segs = 4;
      strandScale = Math.max(0.2, FIBRE_VERTEX_BUDGET / (2 * 4 * strandsTotal));
    }
    segs = Math.min(14, segs);
    const plan = c.links.map((l, i) => {
      // A bridge between two clusters is one fine strand; the bundles live inside clusters.
      if (c.nodes[l.a]!.clusterId !== c.nodes[l.b]!.clusterId) return 1;
      return Math.max(1, Math.round(this.strandCount(i) * strandScale));
    });
    // The more light there is, the less each strand gives, so dense regions glow instead of
    // burning out; a hub's many "about" fibres share its light the same way.
    const density = Math.min(1, Math.max(0.32, 1 / Math.sqrt(c.links.length / 180)));
    const hubLoad = new Map<number, number>();
    for (const l of c.links)
      if (l.reason === "about") hubLoad.set(l.b, (hubLoad.get(l.b) ?? 0) + 1);
    const verts = plan.reduce((s, k) => s + k * segs * 2, 0);
    const position = new Float32Array(verts * 3);
    const color = new Float32Array(verts * 3);
    const alpha = new Float32Array(verts);
    const index = new Float32Array(verts);
    let v = 0;
    const put = (x: number, y: number, z: number, rgb: RGB, al: number, li: number) => {
      position[v * 3] = x;
      position[v * 3 + 1] = y;
      position[v * 3 + 2] = z;
      color[v * 3] = rgb[0]!;
      color[v * 3 + 1] = rgb[1]!;
      color[v * 3 + 2] = rgb[2]!;
      alpha[v] = al;
      index[v] = li;
      v++;
    };
    c.links.forEach((l, li) => {
      const ca = this.nodeColor[l.a]!;
      const cb = this.nodeColor[l.b]!;
      const cross = c.nodes[l.a]!.clusterId !== c.nodes[l.b]!.clusterId;
      const load = l.reason === "about" ? Math.min(1, 3 / Math.sqrt(hubLoad.get(l.b) ?? 1)) : 1;
      const base = (0.05 + l.strength * 0.13) * (cross ? 0.4 : 1) * density * load;
      for (const s of this.strandsOf(li, plan[li]!)) {
        let px = s.p0.x;
        let py = s.p0.y;
        let pz = s.p0.z;
        let prgb: RGB = ca;
        let pal = base;
        for (let k = 1; k <= segs; k++) {
          const t = k / segs;
          const u = 1 - t;
          const x = u * u * s.p0.x + 2 * u * t * s.p1.x + t * t * s.p2.x;
          const y = u * u * s.p0.y + 2 * u * t * s.p1.y + t * t * s.p2.y;
          const z = u * u * s.p0.z + 2 * u * t * s.p1.z + t * t * s.p2.z;
          const rgb: RGB = [ca[0] * u + cb[0] * t, ca[1] * u + cb[1] * t, ca[2] * u + cb[2] * t];
          // Long bridges between clusters thin out in the middle, like light in the dark.
          const al = base * (cross ? 0.55 + 0.45 * Math.abs(1 - 2 * t) : 1);
          put(px, py, pz, prgb, pal, li);
          put(x, y, z, rgb, al, li);
          px = x;
          py = y;
          pz = z;
          prgb = rgb;
          pal = al;
        }
      }
    });
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(position, 3));
    geom.setAttribute("color", new BufferAttribute(color, 3));
    geom.setAttribute("aAlpha", new BufferAttribute(alpha, 1));
    geom.setAttribute("aIndex", new BufferAttribute(index, 1));
    const mat = this.material(FIBRE_VERT, FIBRE_FRAG, this.linkEmph.tex);
    this.add(new LineSegments(geom, mat), geom, mat, 1);
  }

  /** One slow particle per relation, travelling one of its strands. */
  private buildFlow(c: Constellation): void {
    const count = Math.min(MAX_PARTICLES, c.links.length);
    if (count === 0) return;
    // When there are more relations than particles, the strongest keep theirs.
    const order = c.links
      .map((l, i) => ({ i, s: l.strength }))
      .sort((a, b) => b.s - a.s)
      .slice(0, count);
    const p0 = new Float32Array(count * 3);
    const p1 = new Float32Array(count * 3);
    const p2 = new Float32Array(count * 3);
    const color = new Float32Array(count * 3);
    const speed = new Float32Array(count);
    const phase = new Float32Array(count);
    const index = new Float32Array(count);
    const base = new Float32Array(count);
    order.forEach(({ i: li }, k) => {
      const l = c.links[li]!;
      const s = this.strandsOf(li, 1)[0]!;
      // Information flows from the source towards what it is about or supports.
      const forward = hash01(`${l.id}:dir`) > 0.5 || l.reason !== "explicit";
      const [from, to] = forward ? [s.p0, s.p2] : [s.p2, s.p0];
      p0.set([from.x, from.y, from.z], k * 3);
      p1.set([s.p1.x, s.p1.y, s.p1.z], k * 3);
      p2.set([to.x, to.y, to.z], k * 3);
      const ca = this.nodeColor[l.a]!;
      color.set([ca[0] * 0.5 + 0.5, ca[1] * 0.5 + 0.5, ca[2] * 0.5 + 0.5], k * 3);
      const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      // Very slow: tens of seconds per journey, a little faster on short hops.
      speed[k] = 1 / (1000 * (14 + Math.min(26, len / 12)));
      phase[k] = hash01(`${l.id}:phase`);
      index[k] = li;
      // Only strong relations carry a visible flow at rest (about one in three).
      base[k] = l.strength >= 0.7 && hash01(`${l.id}:flow`) < 0.4 ? 1 : 0;
    });
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(p0, 3));
    geom.setAttribute("aP1", new BufferAttribute(p1, 3));
    geom.setAttribute("aP2", new BufferAttribute(p2, 3));
    geom.setAttribute("color", new BufferAttribute(color, 3));
    geom.setAttribute("aSpeed", new BufferAttribute(speed, 1));
    geom.setAttribute("aPhase", new BufferAttribute(phase, 1));
    geom.setAttribute("aIndex", new BufferAttribute(index, 1));
    geom.setAttribute("aBase", new BufferAttribute(base, 1));
    const mat = this.material(FLOW_VERT, POINT_FRAG, this.linkEmph.tex);
    this.add(new Points(geom, mat), geom, mat, 2);
  }

  private buildNodes(c: Constellation): void {
    const n = c.nodes.length;
    const color = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const minPx = new Float32Array(n);
    const phase = new Float32Array(n);
    const index = new Float32Array(n);
    const alpha = new Float32Array(n);
    const crowd = Math.min(1, Math.max(0.55, Math.pow(400 / Math.max(1, n), 0.25)));
    c.nodes.forEach((node, i) => {
      color.set(this.nodeColor[i]!, i * 3);
      phase[i] = hash01(node.id);
      index[i] = i;
      if (node.kind === "hub") {
        size[i] = 22 + node.weight * 18;
        minPx[i] = 9;
        alpha[i] = 0.8;
      } else if (node.kind === "memory") {
        size[i] = 11 + node.weight * 17;
        minPx[i] = 4.5;
        alpha[i] = (0.62 + node.weight * 0.38) * crowd;
      } else {
        size[i] = 6 + node.weight * 6;
        minPx[i] = 2.2;
        alpha[i] = 0.45;
      }
    });
    const geom = new BufferGeometry();
    geom.setAttribute("position", new BufferAttribute(this.pos.slice(), 3));
    geom.setAttribute("color", new BufferAttribute(color, 3));
    geom.setAttribute("aSize", new BufferAttribute(size, 1));
    geom.setAttribute("aMinPx", new BufferAttribute(minPx, 1));
    geom.setAttribute("aPhase", new BufferAttribute(phase, 1));
    geom.setAttribute("aIndex", new BufferAttribute(index, 1));
    geom.setAttribute("aAlpha", new BufferAttribute(alpha, 1));
    const mat = this.material(POINT_VERT, POINT_FRAG, this.nodeEmph.tex);
    this.add(new Points(geom, mat), geom, mat, 3);
  }

  // ── Emphasis (hover / selection) ──────────────────────────────────────────────────────────

  private focusIndex(): { i: number; selected: boolean } | null {
    const sel = this.selectedId !== null ? this.idIndex.get(this.selectedId) : undefined;
    if (sel !== undefined) return { i: sel, selected: true };
    return this.hover !== null ? { i: this.hover, selected: false } : null;
  }

  private neighbours: Set<number> = new Set();

  private refreshEmphasis(immediate = false): void {
    const c = this.data;
    if (!c) return;
    const focus = this.focusIndex();
    const hoverWithSelection =
      focus?.selected && this.hover !== null && this.hover !== focus.i ? this.hover : null;
    this.neighbours = focus ? constellationNeighbours(c, focus.i) : new Set();
    const cluster = focus ? c.nodes[focus.i]!.clusterId : null;
    const N = this.nodeEmph.to;
    const L = this.linkEmph.to;
    const G = this.glowEmph.to;
    if (!focus) {
      N.fill(1);
      L.fill(1);
      G.fill(1);
    } else {
      const sel = focus.selected;
      c.nodes.forEach((node, i) => {
        N[i] =
          i === focus.i
            ? 2.1
            : this.neighbours.has(i)
              ? 1.55
              : node.clusterId === cluster
                ? sel
                  ? 0.6
                  : 1.15
                : sel
                  ? 0.26
                  : 0.5;
      });
      if (hoverWithSelection !== null)
        N[hoverWithSelection] = Math.max(N[hoverWithSelection]!, 1.6);
      c.links.forEach((l, i) => {
        const touches = l.a === focus.i || l.b === focus.i;
        const inCluster =
          c.nodes[l.a]!.clusterId === cluster && c.nodes[l.b]!.clusterId === cluster;
        L[i] = touches ? (sel ? 3.4 : 2.6) : inCluster ? (sel ? 0.4 : 1.2) : sel ? 0.14 : 0.45;
      });
      c.clusters.forEach((cl, i) => {
        G[i] = cl.id === cluster ? (sel ? 1.2 : 1.7) : sel ? 0.45 : 0.65;
      });
    }
    if (immediate || prefersReducedMotion()) {
      for (const e of [this.nodeEmph, this.linkEmph, this.glowEmph]) {
        e.cur.set(e.to);
        if (e.tex) e.tex.needsUpdate = true;
      }
      this.easing = false;
    } else this.easing = true;
    this.schedule();
  }

  /** Ease the emphasis toward its target: light rises and falls, it never snaps. */
  private stepEmphasis(dt: number): void {
    if (!this.easing) return;
    const k = 1 - Math.exp(-dt / 110);
    let moving = false;
    for (const e of [this.nodeEmph, this.linkEmph, this.glowEmph]) {
      const { cur, to } = e;
      let changed = false;
      for (let i = 0; i < cur.length; i++) {
        const d = to[i]! - cur[i]!;
        if (d === 0) continue;
        if (Math.abs(d) < 0.004) cur[i] = to[i]!;
        else {
          cur[i] = cur[i]! + d * k;
          moving = true;
        }
        changed = true;
      }
      if (changed && e.tex) e.tex.needsUpdate = true;
    }
    this.easing = moving;
  }

  // ── Camera ────────────────────────────────────────────────────────────────────────────────

  /** Screen pixels per world unit at the focal plane. */
  pxPerUnit(dist = this.cam.dist): number {
    return this.height / (2 * dist * TAN);
  }

  private distFor(w: number, h: number): number {
    const aspect = this.width / this.height;
    return Math.max(h / 2 / TAN, w / 2 / (TAN * aspect));
  }

  private boxCamera(indices: number[] | null, margin = 1.18): Camera3 | null {
    const P = this.pos;
    const count = indices ? indices.length : P.length / 3;
    if (count === 0) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < count; k++) {
      const i = indices ? indices[k]! : k;
      x0 = Math.min(x0, P[i * 3]!);
      x1 = Math.max(x1, P[i * 3]!);
      y0 = Math.min(y0, P[i * 3 + 1]!);
      y1 = Math.max(y1, P[i * 3 + 1]!);
    }
    const w = Math.max(120, (x1 - x0) * margin + 80);
    const h = Math.max(120, (y1 - y0) * margin + 80);
    return {
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      z: 0,
      dist: Math.min(MAX_DIST, Math.max(MIN_DIST * 4, this.distFor(w, h))),
    };
  }

  private fitCamera(): Camera3 | null {
    return this.boxCamera(null);
  }

  private animateTo(to: Camera3, ms = 700): void {
    this.fitted = true;
    if (prefersReducedMotion()) {
      this.cam = to;
      this.tween = null;
    } else this.tween = { from: { ...this.cam }, to, start: null, ms };
    this.schedule();
  }

  fit(): void {
    const cam = this.fitCamera();
    if (cam) this.animateTo(cam);
  }

  zoomBy(factor: number): void {
    this.animateTo(
      { ...this.cam, dist: Math.min(MAX_DIST, Math.max(MIN_DIST, this.cam.dist / factor)) },
      260,
    );
  }

  /** Bring a node to the centre, close enough that its relations can be read. */
  focusOn(id: string): void {
    const i = this.idIndex.get(id);
    if (i === undefined || !this.data) return;
    const members = [i, ...constellationNeighbours(this.data, i)];
    const box = this.boxCamera(members, 1.5);
    const readable = this.distFor(this.width / 3.2, this.height / 3.2); // ≥ ~3.2 px per unit
    const dist = Math.min(box?.dist ?? readable, Math.max(readable, this.cam.dist * 0.6));
    this.animateTo({
      x: this.pos[i * 3]!,
      y: this.pos[i * 3 + 1]!,
      z: this.pos[i * 3 + 2]!,
      dist: Math.min(dist, this.cam.dist),
    });
  }

  private focusCluster(id: string): void {
    if (!this.data) return;
    const members = this.data.nodes.flatMap((n, i) => (n.clusterId === id ? [i] : []));
    const cam = this.boxCamera(members, 1.3);
    if (cam) this.animateTo(cam);
  }

  private placeCamera(now: number): void {
    const reduced = prefersReducedMotion();
    const t = (now - this.start) / 1000;
    // A slow sway of a few degrees: enough parallax to feel the depth, never a spin.
    const yaw = reduced ? 0 : 0.055 * Math.sin((t * 2 * Math.PI) / 74);
    const pitch = 0.11 + (reduced ? 0 : 0.035 * Math.sin((t * 2 * Math.PI) / 57));
    const { x, y, z, dist } = this.cam;
    this.camera.position.set(
      x + dist * Math.sin(yaw) * Math.cos(pitch),
      y - dist * Math.sin(pitch),
      z + dist * Math.cos(yaw) * Math.cos(pitch),
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(x, y, z);
    this.camera.updateMatrixWorld();
    this.uniforms.uNear.value = dist - this.span * 0.4;
    this.uniforms.uFar.value = dist + this.span * 1.1 + Math.abs(z);
    this.uniforms.uPx.value = (this.height / (2 * TAN)) * Math.min(window.devicePixelRatio || 1, 2);
  }

  // ── Loop ──────────────────────────────────────────────────────────────────────────────────

  schedule(): void {
    if (this.raf || !this.renderer) return;
    this.raf = requestAnimationFrame((now) => this.frame(now));
  }

  private frame(now: number): void {
    this.raf = 0;
    const renderer = this.renderer;
    if (!renderer) return;
    const reduced = prefersReducedMotion();
    const active = !!this.tween || this.easing || now - this.lastInput < 1200;
    // At rest the scene only breathes, so half the frame rate is plenty.
    if (!reduced && !active && now - this.lastFrame < 30) {
      this.schedule();
      return;
    }
    const dt = Math.min(64, now - (this.lastFrame || now));
    this.lastFrame = now;

    if (this.tween) {
      const tw = this.tween;
      tw.start ??= now;
      const p = Math.min(1, (now - tw.start) / tw.ms);
      const e = easeInOut(p);
      this.cam = {
        x: tw.from.x + (tw.to.x - tw.from.x) * e,
        y: tw.from.y + (tw.to.y - tw.from.y) * e,
        z: tw.from.z + (tw.to.z - tw.from.z) * e,
        dist: tw.from.dist * Math.pow(tw.to.dist / tw.from.dist, e),
      };
      if (p >= 1) this.tween = null;
    }
    this.stepEmphasis(dt);
    this.uniforms.uTime.value = reduced ? 0 : now - this.start;
    this.uniforms.uTwinkle.value = reduced ? 0 : 1;
    this.uniforms.uFlow.value = reduced ? 0 : 1;
    this.placeCamera(now);
    renderer.render(this.scene, this.camera);
    this.project();
    this.drawLabels(now);
    // Reduced motion: nothing moves on its own, so frames are drawn only on demand.
    if (!reduced || this.tween || this.easing) this.schedule();
  }

  /** Screen position and depth of every node, for labels and hit testing. */
  private project(): void {
    const n = this.data?.nodes.length ?? 0;
    const v = this.tmp;
    for (let i = 0; i < n; i++) {
      v.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
      v.applyMatrix4(this.camera.matrixWorldInverse);
      const depth = -v.z;
      v.applyMatrix4(this.camera.projectionMatrix);
      this.screen[i * 3] = (v.x * 0.5 + 0.5) * this.width;
      this.screen[i * 3 + 1] = (-v.y * 0.5 + 0.5) * this.height;
      this.screen[i * 3 + 2] = depth;
    }
  }

  /** The node under a screen point: memories win over hubs, hubs over related objects. */
  nodeAt(px: number, py: number): number | null {
    const c = this.data;
    if (!c) return null;
    let best: number | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < c.nodes.length; i++) {
      const depth = this.screen[i * 3 + 2]!;
      if (depth <= 0) continue;
      const d = Math.hypot(this.screen[i * 3]! - px, this.screen[i * 3 + 1]! - py);
      const kind = c.nodes[i]!.kind;
      const reach = kind === "hub" ? 18 : kind === "memory" ? 14 : 9;
      if (d > reach) continue;
      const score = d + (kind === "satellite" ? 6 : kind === "hub" ? 3 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  // ── Labels ────────────────────────────────────────────────────────────────────────────────

  /** How much the zoom reveals: 0 clusters only · 1 main memories · 2 every memory · 3 detail. */
  detailLevel(): number {
    const p = this.pxPerUnit();
    return p < 0.75 ? 0 : p < 1.7 ? 1 : p < 2.9 ? 2 : 3;
  }

  private label(key: string, build: () => HTMLDivElement): LabelEl {
    let l = this.labels.get(key);
    if (!l) {
      const el = build();
      this.labelLayer!.appendChild(el);
      l = { el, w: 0, h: 0, shown: false, lastShown: 0, detailed: false };
      this.measure(
        l,
        this.labelLayer!.dataset.detail === "2" || this.labelLayer!.dataset.detail === "3",
      );
      this.labels.set(key, l);
    }
    return l;
  }

  /** Measure a label as it currently reads (with or without its secondary line). */
  private measure(l: LabelEl, detailed = false): void {
    l.detailed = detailed;
    l.w = l.el.offsetWidth || 140;
    l.h = l.el.offsetHeight || 22;
  }

  private memoryLabel(i: number): HTMLDivElement {
    const node = this.data!.nodes[i]!;
    const el = document.createElement("div");
    el.className = "cst-label";
    el.dataset.kind = node.kind;
    el.setAttribute("aria-hidden", "true");
    const dot = document.createElement("span");
    dot.className = "cst-dot";
    dot.style.setProperty("--cst-c", cssRgb(this.nodeColor[i]!));
    const body = document.createElement("span");
    body.className = "cst-body";
    const title = document.createElement("span");
    title.className = "cst-title";
    title.textContent = node.title.length > 42 ? `${node.title.slice(0, 41)}…` : node.title;
    const meta = document.createElement("span");
    meta.className = "cst-meta";
    meta.textContent = this.text.meta(node, this.clusterById.get(node.clusterId));
    body.append(title, meta);
    el.append(dot, body);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      this.select(i);
    });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.cb.onOpen?.(node.id);
    });
    return el;
  }

  private clusterLabel(ci: number): HTMLDivElement {
    const cl = this.data!.clusters[ci]!;
    const el = document.createElement("div");
    el.className = "cst-cluster";
    el.setAttribute("aria-hidden", "true");
    el.textContent = this.text.cluster(cl);
    const count = document.createElement("span");
    count.className = "cst-count";
    count.textContent = ` ${cl.size}`;
    el.append(count);
    el.style.setProperty("--cst-c", cssRgb(clusterLight(cl)));
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      this.focusCluster(cl.id);
    });
    return el;
  }

  private drawLabels(now: number): void {
    const c = this.data;
    const layer = this.labelLayer;
    if (!c || !layer) return;
    const level = this.detailLevel();
    layer.dataset.detail = String(level);
    const focus = this.focusIndex();
    const placed: [number, number, number, number][] = [];
    const free = (x0: number, y0: number, x1: number, y1: number) =>
      !placed.some((p) => x0 < p[2] && x1 > p[0] && y0 < p[3] && y1 > p[1]);
    const inFrame = (x: number, y: number) =>
      x > -20 && y > -20 && x < this.width + 20 && y < this.height + 20;
    const want = new Set<string>();
    const show = (key: string, l: LabelEl, x: number, y: number) => {
      want.add(key);
      l.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      if (!l.shown) {
        l.shown = true;
        l.el.classList.add("is-shown");
      }
      l.lastShown = now;
    };

    // Memories first in priority order; each takes its box only if it is free.
    const candidates: number[] = [];
    if (focus) candidates.push(focus.i);
    if (this.hover !== null && this.hover !== focus?.i) candidates.push(this.hover);
    if (focus) for (const j of this.neighbours) candidates.push(j);
    const rest = c.nodes
      .map((n, i) => ({ n, i }))
      .filter(({ n, i }) => {
        if (candidates.includes(i)) return false;
        if (n.kind === "hub") return false; // hubs are named by their cluster label
        if (n.kind === "satellite") return level >= 3;
        return level >= 2 || (level === 1 && n.weight >= 0.45);
      })
      .sort((a, b) => b.n.weight - a.n.weight)
      .map(({ i }) => i);
    const strong = new Set(candidates);
    let count = 0;
    // Cluster names go in before the lesser memories at a distance, after them up close.
    // From afar only the clusters that shape the landscape are named; small ones on approach.
    const largest = c.clusters.reduce((m, cl) => Math.max(m, cl.size), 0);
    const minSize = level === 0 ? Math.max(2, largest * 0.06) : 1;
    const clusterPass = () => {
      if (level >= 3) return;
      c.clusters.forEach((cl, ci) => {
        if (cl.size < minSize) return;
        const cc = this.clusterCentre[ci]!;
        this.tmp.set(cc.x, cc.y + this.clusterExtent[ci]!, cc.z).project(this.camera);
        if (this.tmp.z > 1) return;
        const x = (this.tmp.x * 0.5 + 0.5) * this.width;
        const y = (-this.tmp.y * 0.5 + 0.5) * this.height;
        if (!inFrame(x, y)) return;
        const key = `cluster:${cl.id}`;
        const l = this.label(key, () => this.clusterLabel(ci));
        const x0 = x - l.w / 2;
        const y0 = y - l.h - 14;
        if (!free(x0, y0, x0 + l.w, y0 + l.h)) return;
        placed.push([x0 - 4, y0 - 2, x0 + l.w + 4, y0 + l.h + 2]);
        show(key, l, x0, y0);
      });
    };
    // The focus and the hovered point always get their label; their relations take the next
    // free places, so labels never pile up.
    candidates.forEach((i, k) => {
      const x = this.screen[i * 3]!;
      const y = this.screen[i * 3 + 1]!;
      if (this.screen[i * 3 + 2]! <= 0 || !inFrame(x, y)) return;
      const key = c.nodes[i]!.id;
      const l = this.label(key, () => this.memoryLabel(i));
      const x0 = x + 11;
      const y0 = y - l.h / 2;
      const forced = k === 0 || i === this.hover;
      if (!forced && !free(x0 - 3, y0 - 2, x0 + l.w + 3, y0 + l.h + 2)) return;
      placed.push([x0 - 3, y0 - 2, x0 + l.w + 3, y0 + l.h + 2]);
      show(key, l, x0, y0);
      count++;
    });
    if (level <= 1) clusterPass();
    for (const i of rest) {
      if (count >= MAX_LABELS) break;
      const x = this.screen[i * 3]!;
      const y = this.screen[i * 3 + 1]!;
      if (this.screen[i * 3 + 2]! <= 0 || !inFrame(x, y)) continue;
      const key = c.nodes[i]!.id;
      const existing = this.labels.get(key);
      const w = existing?.w ?? 150;
      const h = existing?.h ?? 34;
      const x0 = x + 11;
      const y0 = y - h / 2;
      if (!free(x0 - 4, y0 - 3, x0 + w + 4, y0 + h + 3)) continue;
      const l = existing ?? this.label(key, () => this.memoryLabel(i));
      placed.push([x0 - 4, y0 - 3, x0 + l.w + 4, y0 + l.h + 3]);
      show(key, l, x0, y0);
      count++;
    }
    if (level === 2) clusterPass();

    for (const [key, l] of this.labels) {
      const node = this.idIndex.get(key);
      const isFocus = node !== undefined && node === focus?.i;
      const isNear = node !== undefined && strong.has(node) && !isFocus;
      l.el.classList.toggle("is-focus", isFocus);
      l.el.classList.toggle("is-near", isNear);
      // Its second line comes and goes with the zoom and the focus: keep the box true to it.
      const detailed = node !== undefined && (level >= 2 || isFocus || isNear);
      if (detailed !== l.detailed) this.measure(l, detailed);
      if (want.has(key)) continue;
      if (l.shown) {
        l.shown = false;
        l.el.classList.remove("is-shown");
      } else if (now - l.lastShown > 4000) {
        l.el.remove();
        this.labels.delete(key);
      }
    }
  }

  // ── Gestures ──────────────────────────────────────────────────────────────────────────────

  private select(i: number | null): void {
    const id = i === null ? null : this.data!.nodes[i]!.id;
    this.cb.onSelect?.(id !== null && id === this.selectedId ? null : id);
    if (id !== null && id !== this.selectedId) this.focusOn(id);
  }

  private bindGestures(canvas: HTMLCanvasElement): void {
    type Pt = { x: number; y: number };
    const pointers = new Map<number, Pt>();
    let downAt: { x: number; y: number } | null = null;
    let travelled = 0;
    let pinch: number | null = null;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const touch = () => {
      this.lastInput = performance.now();
      this.tween = null;
      this.fitted = true;
      this.schedule();
    };
    const zoomAt = (px: number, py: number, factor: number) => {
      const p = this.pxPerUnit();
      const wx = this.cam.x + (px - this.width / 2) / p;
      const wy = this.cam.y - (py - this.height / 2) / p;
      const dist = Math.min(MAX_DIST, Math.max(MIN_DIST, this.cam.dist / factor));
      const q = this.pxPerUnit(dist);
      this.cam = {
        x: wx - (px - this.width / 2) / q,
        y: wy + (py - this.height / 2) / q,
        z: this.cam.z,
        dist,
      };
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) {
        downAt = local(e);
        travelled = 0;
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [Pt, Pt];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      touch();
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        // Hover.
        const i = this.nodeAt(p.x, p.y);
        if (i !== this.hover) {
          this.hover = i;
          canvas.style.cursor = i !== null ? "pointer" : "grab";
          this.refreshEmphasis();
        }
        return;
      }
      pointers.set(e.pointerId, p);
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()] as [Pt, Pt];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
        pinch = d;
      } else if (pointers.size === 1) {
        const ppu = this.pxPerUnit();
        this.cam = {
          ...this.cam,
          x: this.cam.x - (p.x - prev.x) / ppu,
          y: this.cam.y + (p.y - prev.y) / ppu,
        };
        if (downAt) travelled = Math.max(travelled, Math.hypot(p.x - downAt.x, p.y - downAt.y));
        if (travelled > CLICK_SLOP) canvas.style.cursor = "grabbing";
      }
      touch();
    };
    const onUp = (e: PointerEvent) => {
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (wasSingle && downAt && travelled <= CLICK_SLOP && e.type === "pointerup") {
        const p = local(e);
        this.select(this.nodeAt(p.x, p.y));
      }
      if (pointers.size === 0) downAt = null;
      canvas.style.cursor = this.hover !== null ? "pointer" : "grab";
      touch();
    };
    const onLeave = () => {
      if (this.hover !== null) {
        this.hover = null;
        this.refreshEmphasis();
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * scale * 0.0016));
      touch();
    };
    const onDouble = (e: MouseEvent) => {
      const p = local(e);
      const i = this.nodeAt(p.x, p.y);
      if (i !== null) {
        this.cb.onOpen?.(this.data!.nodes[i]!.id);
        return;
      }
      const from = { ...this.cam };
      zoomAt(p.x, p.y, 1.8);
      const to = this.cam;
      this.cam = from;
      this.animateTo(to, 320);
    };
    const onLost = (e: Event) => e.preventDefault();

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDouble);
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.style.cursor = "grab";
    this.detach = () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDouble);
      canvas.removeEventListener("webglcontextlost", onLost);
    };
  }
}
