import { contextColorHex } from "./tokens";

/** Colours of the confetti: the five project colours of the design. */
export const CONFETTI_COLORS = ["#dd5530", "#e8ac3e", "#5d7e4c", "#4f7fae", "#8a5784"] as const;

/** The identity colours a project can wear in the new design (a curated, warm set of five). */
export const PROJECT_COLORS = ["#dd5530", "#5d7e4c", "#4f7fae", "#c98f22", "#8a5784"] as const;

/**
 * A project's identity colour: the one it was given, or a stable pick from the design's five so a
 * project without a colour still always looks the same.
 */
export function projectColor(token: string | null | undefined, id: string): string {
  const own = contextColorHex(token);
  if (own) return own;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PROJECT_COLORS[h % PROJECT_COLORS.length] as string;
}

/** The three colour pairs on offer: page and card in light and dark, and the one shared accent. */
export const PAIR_SWATCH = {
  indigo: { light: ["#f4f6fa", "#ffffff"], dark: ["#121419", "#1c1f27"], accent: "#5b6cf0" },
  teal: { light: ["#f2f7f8", "#ffffff"], dark: ["#0c1322", "#162033"], accent: "#0f9d9a" },
  violet: { light: ["#f6f5fa", "#ffffff"], dark: ["#14131a", "#1d1c26"], accent: "#8b5cf6" },
} as const;

/** A colour with its saturation raised a little (and a touch darker), for places that need it to carry. */
export function enrich(hex: string, boost = 1.3): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1] as string, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  const s2 = Math.min(1, s * boost);
  const l2 = Math.max(0, l - 0.04);
  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const k = l2 - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const to = (v: number) =>
    Math.round((v + k) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}
