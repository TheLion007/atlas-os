/**
 * The dark theme's palette as data, for tooling, the design gallery and canvases that are always
 * dark (the 3D globe, the Memory constellation). The CSS custom properties in globals.css are
 * what components use, per theme; a test asserts the two never differ.
 */
export const BLUEPRINT_TOKENS = [
  { name: "bg", hex: "#121419", note: "Background" },
  { name: "surface", hex: "#1c1f27", note: "Cards, panels" },
  { name: "border", hex: "#2f3440", note: "Hairlines" },
  { name: "accent", hex: "#4f60e8", note: "Indigo: the one thing that matters" },
  { name: "positive", hex: "#5bd08f", note: "On track" },
  { name: "critical", hex: "#ff7a8a", note: "Shortfall, overrun" },
] as const;

export const BG = BLUEPRINT_TOKENS[0].hex;
export const SURFACE = BLUEPRINT_TOKENS[1].hex;

/** The always-dark palette: scenes that are "space" in either theme (the globe). */
export const SPACE_COLORS = {
  bg: BLUEPRINT_TOKENS[0].hex,
  surface: BLUEPRINT_TOKENS[1].hex,
  border: BLUEPRINT_TOKENS[2].hex,
  accent: BLUEPRINT_TOKENS[3].hex,
  positive: BLUEPRINT_TOKENS[4].hex,
  critical: BLUEPRINT_TOKENS[5].hex,
  fg: "#e9ecf2",
  fgMuted: "#a3a9b8",
} as const;

const CANVAS_VARS = {
  bg: "--c-bg",
  surface: "--c-surface",
  border: "--c-border",
  accent: "--c-accent",
  positive: "--c-positive",
  critical: "--c-critical",
  fg: "--c-fg",
  fgMuted: "--c-fg-muted",
} as const;

type CanvasKey = keyof typeof CANVAS_VARS;
let canvasCache: { theme: string; colors: Record<CanvasKey, string> } | null = null;

function readCanvasColors(): Record<CanvasKey, string> {
  if (typeof document === "undefined") return SPACE_COLORS;
  const theme = `${document.documentElement.dataset.theme ?? "light"}|${document.documentElement.dataset.pair ?? ""}`;
  if (canvasCache?.theme === theme) return canvasCache.colors;
  const style = getComputedStyle(document.documentElement);
  const colors: Record<CanvasKey, string> = { ...SPACE_COLORS };
  for (const key of Object.keys(CANVAS_VARS) as CanvasKey[]) {
    const v = style.getPropertyValue(CANVAS_VARS[key]).trim();
    if (v) colors[key] = v;
  }
  canvasCache = { theme, colors };
  return colors;
}

/**
 * Colours for 2D canvases, which cannot read CSS custom properties per frame. Each property reads
 * the live theme (cached per theme), so a canvas repaints in the right palette after a switch.
 */
export const CANVAS_COLORS = {
  get bg() {
    return readCanvasColors().bg;
  },
  get surface() {
    return readCanvasColors().surface;
  },
  get border() {
    return readCanvasColors().border;
  },
  get accent() {
    return readCanvasColors().accent;
  },
  get positive() {
    return readCanvasColors().positive;
  },
  get critical() {
    return readCanvasColors().critical;
  },
  get fg() {
    return readCanvasColors().fg;
  },
  get fgMuted() {
    return readCanvasColors().fgMuted;
  },
};

let typeCache: { key: string; map: Map<string, string> } | null = null;

/** An object type's colour in the current theme (the canvas twin of the `type-*` CSS tokens). */
export function typeColor(type: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const key = `${document.documentElement.dataset.theme ?? "light"}|${document.documentElement.dataset.pair ?? ""}`;
  if (typeCache?.key !== key) typeCache = { key, map: new Map() };
  const hit = typeCache.map.get(type);
  if (hit) return hit;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--c-type-${type}`).trim();
  typeCache.map.set(type, v || fallback);
  return v || fallback;
}

/**
 * Colours specific to the 3D globe (`src/components/canvases/globe`), which — like the flat
 * canvases above — cannot read a CSS custom property. `sun` is the one warm note in the whole
 * app: daylight, not a brand colour, so it stays out of `CANVAS_COLORS`.
 */
export const GLOBE_COLORS = {
  /** The night side's faint self-illumination: a warm neutral, not real city-light data. */
  nightLand: "#3a2e22",
  nightCoast: "#5a4630",
  nightBase: "#000000",
  /** The directional light standing in for the sun. */
  sun: "#fff4e6",
} as const;

/**
 * The Memory Graph constellation's light (see `constellation-engine.ts`). These are shades of
 * the network, not interface colours: a cluster whose project has a context colour glows in a
 * luminous version of *that* colour, and only clusters without one (tag groups, unfiled) take a
 * hue from this short, controlled set — cyan, blue, violet, green, magenta, kept soft so the
 * whole reads as fibres of light in a dark space, never a rainbow.
 */
export const CONSTELLATION_COLORS = {
  hues: ["#6fd3e6", "#6f93f2", "#a08af0", "#72d6a4", "#d98ad0"],
  /** The faint, colourless light of fibres far from any cluster core. */
  neutral: "#a9b4c8",
} as const;

/**
 * Chart series colours (Finance). The object-type hues are deliberately too quiet to tell four
 * series apart, so charts get their own categorical set, in this fixed order and never cycled:
 * blue, magenta, cyan, violet — cool hues only, clear of the sand accent and the status colours.
 * Validated for the dark surface (lightness band, chroma, contrast, colour-vision separation);
 * slots 3–4 sit in the colour-vision warning band, so a chart using them always labels directly.
 * `reference` is the neutral for a comparison baseline (e.g. invested capital).
 */
export const CHART_COLORS = {
  series: ["#3987e5", "#d55181", "#1fa3b8", "#9085e9"],
  reference: "#8b9099",
  grid: "#20242a",
} as const;

/**
 * Context colours: a small, curated palette a Project/Sub-project can carry (ADR 0002 §5).
 * Everything associated with it — today, only a Memory's display colour (§3) — derives from
 * this rather than duplicating it. Deliberately its own, more saturated palette from the
 * object-type colours above: those are quiet categorical labels the app assigns; these are an
 * identity colour the *user* chooses for something they built, and are allowed to be a little
 * more vivid so "Dorsel Relocation is purple" actually reads as a colour, not a label.
 *
 * `objects.color`/`tags.color` store the **key** (e.g. `"purple"`), never a hex — adding a ninth
 * colour later is a one-line addition here, not a migration. This exact set of eight hues is a
 * provisional starting palette (verified against the same contrast/distinctness maths as the
 * object-type palette, see the script noted in ADR 0002's implementation notes) and is explicitly
 * open to revision in the design phase (ADR 0002 §4/decision point 4).
 */
export const CONTEXT_COLORS = {
  purple: "#9275ac",
  teal: "#267d94",
  amber: "#8d6b31",
  rose: "#d791a1",
  slate: "#619cc6",
  sage: "#a1d09c",
  clay: "#c18b61",
  indigo: "#9ca2de",
} as const;

export type ContextColorToken = keyof typeof CONTEXT_COLORS;

const CONTEXT_COLOR_KEYS = new Set(Object.keys(CONTEXT_COLORS));
const isContextColorToken = (v: string): v is ContextColorToken => CONTEXT_COLOR_KEYS.has(v);

/**
 * The hex for a stored colour token (e.g. `objects.color`, `tags.color`), or `null` for no
 * colour / a token this build doesn't recognise (never throws on unknown data — a colour the UI
 * doesn't know yet degrades to "no colour", not an error).
 */
export function contextColorHex(token: string | null | undefined): string | null {
  return token && isContextColorToken(token) ? CONTEXT_COLORS[token] : null;
}
