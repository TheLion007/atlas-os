import { describe, expect, it } from "vitest";
import { scanTree } from "../support/scan-strings";

/**
 * Interface copy lives in the message catalogue, never in components. This scans every TSX file
 * for JSX text, text-bearing attributes and string literals inside JSX expressions.
 * `PENDING` lists files still being migrated; it only ever shrinks.
 */
const norm = (p: string): string => p.split(String.fromCharCode(92)).join("/");

const EXEMPT = ["/design/"]; // the developer-only token gallery documents the system in English
const PENDING: string[] = [];

describe("i18n guard", () => {
  it("has no hard-coded interface copy in components", () => {
    const hits = scanTree("src")
      .map((h) => ({ ...h, file: norm(h.file) }))
      .filter((h) => !EXEMPT.some((e) => h.file.includes(e)))
      .filter((h) => !PENDING.some((p) => h.file.endsWith(p)));
    expect(hits.map((h) => `${h.file}:${h.line}  ${h.text}`)).toEqual([]);
  });
});
