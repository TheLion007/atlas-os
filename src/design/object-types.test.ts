import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OBJECT_TYPES } from "@/domain/enums";
import { chroma, colorDistance, contrastRatio, toOklab } from "./color";
import { OBJECT_TYPE_STYLE } from "./object-types";
import { BLUEPRINT_TOKENS } from "./tokens";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const DARK_AT = css.indexOf(':root[data-theme="dark"]');
const THEME_AT = css.indexOf("@theme static");
const LIGHT_BLOCK = css.slice(css.indexOf(":root {"), DARK_AT);
const DARK_BLOCK = css.slice(DARK_AT, THEME_AT);
const read = (block: string, name: string): string => {
  const m = new RegExp(`--c-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(block);
  if (!m) throw new Error(`token --c-${name} not found`);
  return (m[1] as string).toLowerCase();
};
const token = (name: string): string => read(DARK_BLOCK, name);
const lightToken = (name: string): string => read(LIGHT_BLOCK, name);

const BG = token("bg");
const SURFACE = token("surface");
const RESERVED = {
  accent: token("accent"),
  positive: token("positive"),
  critical: token("critical"),
};

describe("design tokens", () => {
  it("dark values match the TypeScript token data used by tooling and canvases", () => {
    for (const t of BLUEPRINT_TOKENS) expect(token(t.name)).toBe(t.hex);
  });

  it("the two themes define the same palette", () => {
    const names = (block: string) =>
      [...block.matchAll(/--c-([a-z0-9_-]+):/g)].map((m) => m[1]).sort();
    expect(names(LIGHT_BLOCK)).toEqual(names(DARK_BLOCK));
  });

  it("light is the cool neutral of the design", () => {
    expect(lightToken("bg")).toBe("#f4f6fa");
    expect(lightToken("surface")).toBe("#ffffff");
    expect(lightToken("accent")).toBe("#4f60e8");
  });

  it("follow the design's geometry and motion rules", () => {
    expect(css).toMatch(/--radius-control:\s*12px/);
    expect(css).toMatch(/--radius-card:\s*20px/);
    expect(css).toMatch(/--duration-hover:\s*120ms/);
    expect(css).toMatch(/--duration-panel:\s*220ms/);
    expect(css).toMatch(/--sidebar-w:\s*248px/);
    expect(css).toMatch(/--sidebar-w-collapsed:\s*56px/);
    expect(css).toMatch(/--topbar-h:\s*64px/);
    expect(css).toMatch(/--peek-w:\s*440px/);
  });

  it("removes the stock palette, shadows and radii so only Atlas tokens exist", () => {
    expect(css).toMatch(/--color-\*:\s*initial/);
    expect(css).toMatch(/--shadow-\*:\s*initial/);
    expect(css).toMatch(/--radius-\*:\s*initial/);
  });
});

describe("object-type palette", () => {
  const entries = OBJECT_TYPES.map((t) => [t, OBJECT_TYPE_STYLE[t].color] as const);

  it("defines every object type", () => {
    expect(Object.keys(OBJECT_TYPE_STYLE).sort()).toEqual([...OBJECT_TYPES].sort());
  });

  it.each(entries)("%s: the dark CSS token matches the TypeScript colour", (type, color) => {
    expect(token(`type-${type}`)).toBe(color);
  });

  it.each(entries)("%s: the light variant is legible on paper (>= 3:1)", (type) => {
    const light = lightToken(`type-${type}`);
    expect(contrastRatio(light, lightToken("bg"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(light, lightToken("surface"))).toBeGreaterThanOrEqual(3);
  });

  it.each(entries)("%s: is muted (low chroma), not a bright categorical colour", (_t, color) => {
    expect(chroma(color)).toBeLessThanOrEqual(0.08);
  });

  it.each(entries)("%s: is legible on both surfaces (>= 3:1)", (_t, color) => {
    expect(contrastRatio(color, BG)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color, SURFACE)).toBeGreaterThanOrEqual(3);
  });

  it.each(entries)("%s: stays clear of sand and the status colours", (_t, color) => {
    for (const [name, reserved] of Object.entries(RESERVED)) {
      expect(colorDistance(color, reserved), `vs ${name}`).toBeGreaterThanOrEqual(9);
    }
  });

  it("keeps every pair of types visibly distinct", () => {
    const tooClose: string[] = [];
    for (let i = 0; i < entries.length; i++)
      for (let j = i + 1; j < entries.length; j++) {
        const [a, ca] = entries[i] as readonly [string, string];
        const [b, cb] = entries[j] as readonly [string, string];
        if (colorDistance(ca, cb) < 3) tooClose.push(`${a}~${b}`);
      }
    expect(tooClose).toEqual([]);
  });

  it("avoids the warm sand, red and green zones reserved for the accent and status colours", () => {
    // OKLCH hue in degrees: red-orange 10–50, sand 60–100, green 135–175.
    for (const [type, color] of entries) {
      if (chroma(color) < 0.02) continue; // near-grey has no meaningful hue
      const [, a, b] = toOklab(color);
      const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
      const reserved =
        (hue >= 10 && hue <= 50) || (hue >= 60 && hue <= 100) || (hue >= 135 && hue <= 175);
      expect(reserved, `${type} hue ${hue.toFixed(0)}`).toBe(false);
    }
  });
});
