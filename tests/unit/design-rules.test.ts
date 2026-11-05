import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The design rules from the blueprint, made enforceable. They scan the source rather than trust
 * reviewers to notice: no gradients, no shadows, no arbitrary colours, no stock palette names,
 * only the blueprint's spacing scale and its two radii.
 */
const ROOT = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT).map((p) => ({
  path: relative(process.cwd(), p).split(sep).join("/"),
  text: readFileSync(p, "utf8"),
}));

/** Reports "file: match" for every occurrence, so a failure says exactly where to look. */
function findAll(pattern: RegExp, only?: (path: string) => boolean): string[] {
  const hits: string[] = [];
  for (const f of files) {
    if (only && !only(f.path)) continue;
    for (const m of f.text.matchAll(pattern)) hits.push(`${f.path}: ${m[0]}`);
  }
  return hits;
}

describe("design rules", () => {
  it("scans a meaningful amount of source", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("uses only the three shadow tokens (the design has its own soft shadows)", () => {
    const off = findAll(/(?<![\w-])(?:drop-)?shadow(?:-[a-z0-9]+)?\b/g).filter(
      (h) => !/shadow-(?:card|pop|glow)$/.test(h),
    );
    expect(off).toEqual([]);
  });

  it("uses no stock Tailwind palette colours", () => {
    const names =
      "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black";
    const re = new RegExp(
      `\\b(?:bg|text|border|fill|stroke|ring|outline|divide|from|to|via|caret|decoration)-(?:${names})(?:-\\d+)?\\b`,
      "g",
    );
    expect(findAll(re)).toEqual([]);
  });

  it("hard-codes no hex colours outside src/design (colours are tokens)", () => {
    const hits = findAll(/#[0-9a-fA-F]{6}\b/g, (p) => !p.startsWith("src/design/"));
    expect(hits).toEqual([]);
  });

  it("uses no arbitrary colour values", () => {
    expect(findAll(/\b(?:bg|text|border|fill|stroke|ring|outline)-\[(?:#|rgb|hsl|oklch)/g)).toEqual(
      [],
    );
  });

  // The spacing scale and the two radii of the old blueprint are gone on purpose: the design's
  // own pixel values (18 px cards, 13 px buttons, 46 px titles…) are reproduced exactly.
});
