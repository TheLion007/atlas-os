import axe from "axe-core";

/**
 * Runs axe-core against a rendered subtree and returns readable violations (empty = clean).
 * Colour contrast is skipped here because jsdom has no layout or computed colours; contrast is
 * covered by the token tests and by the real-browser check in scripts/verify-ui.mjs.
 */
export async function axeViolations(root: Element): Promise<string[]> {
  const results = await axe.run(root, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map(
    (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}
