/**
 * Real-browser verification of the UI: screenshots at desktop, tablet and mobile widths, axe with
 * colour contrast enabled (jsdom cannot check contrast), and a horizontal-overflow check.
 *
 * Needs the app running in demo mode:  NEXT_PUBLIC_ATLAS_FIXTURES=1 npm run dev
 * Uses the installed Edge or Chrome via playwright-core (no browser download).
 *
 *   BASE_URL=http://localhost:3140 OUT_DIR=screenshots node scripts/verify-ui.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const BASE = process.env.BASE_URL ?? "http://localhost:3140";
const OUT = process.env.OUT_DIR ?? "screenshots";
const CANDIDATES = [
  process.env.BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) throw new Error("No Edge or Chrome found. Set BROWSER_PATH.");

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
};

mkdirSync(OUT, { recursive: true });
const failures = [];
const notes = [];

const browser = await chromium.launch({ executablePath, headless: true });

async function audit(page, label) {
  // Horizontal overflow: the page and the scrolling main region must not scroll sideways.
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector("main");
    return {
      page: doc.scrollWidth - doc.clientWidth,
      main: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  if (overflow.page > 1 || overflow.main > 1) {
    failures.push(
      `${label}: horizontal overflow (page ${overflow.page}px, main ${overflow.main}px)`,
    );
  }

  // axe, with colour contrast on.
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ["violations"] });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes
        .slice(0, 3)
        .map(
          (n) =>
            n.target.join(" ") +
            " :: " +
            (n.failureSummary ?? "").split("\n").slice(0, 2).join(" ").slice(0, 160),
        ),
    }));
  });
  for (const v of violations)
    failures.push(
      `${label}: axe ${v.id} (${v.impact}): ${v.help}\n      ${v.nodes.join("\n      ")}`,
    );
  return violations.length;
}

async function shot(page, name, opts = {}) {
  await page.waitForTimeout(400); // let 220ms panel motion finish
  await page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
}

async function open(page, path, readyText) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  if (readyText)
    await page.getByText(readyText, { exact: false }).first().waitFor({ timeout: 15000 });
}

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  const tag = (s) => `${vpName} ${s}`;

  // ── Overview ────────────────────────────────────────────────────────────────────────────
  await open(page, "/", "Capital");
  await page.getByText("Review service charge history").first().waitFor();
  await shot(page, `${vpName}-01-overview`);
  await audit(page, tag("overview"));
  if (vpName === "desktop") {
    await page.setViewportSize({ width: 1440, height: 2100 });
    await shot(page, `${vpName}-01b-overview-full`);
    await page.setViewportSize(viewport);
  }

  // ── Peek panel ──────────────────────────────────────────────────────────────────────────
  await page
    .getByRole("link", { name: /Review service charge history\s*,\s*Task/ })
    .first()
    .click();
  await page.waitForTimeout(500);
  await shot(page, `${vpName}-02-peek`);
  await audit(page, tag("peek"));
  await page.keyboard.press("Escape");

  // ── Command palette ─────────────────────────────────────────────────────────────────────
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").waitFor();
  await shot(page, `${vpName}-03-palette-recent`);
  await page.keyboard.type("marina");
  await shot(page, `${vpName}-04-palette-results`);
  await audit(page, tag("palette"));
  await page.keyboard.press("Escape");

  // ── Assistant ───────────────────────────────────────────────────────────────────────────
  await page.keyboard.press("Control+j");
  await page.getByText("The assistant is not connected yet").waitFor();
  await shot(page, `${vpName}-05-assistant`);
  await audit(page, tag("assistant"));
  await page.keyboard.press("Escape");

  // ── Graph ───────────────────────────────────────────────────────────────────────────────
  await open(page, "/graph");
  await page.getByRole("group", { name: /Relationship graph/ }).waitFor();
  await shot(page, `${vpName}-06-graph`);
  await audit(page, tag("graph"));
  if (vpName !== "mobile") {
    await page.getByRole("button", { name: "Milestone: Relocation" }).first().click();
    await shot(page, `${vpName}-07-graph-selected`);
    // Below the wide breakpoint the peek is a modal sheet (background inert): dismiss it first.
    if (vpName !== "desktop") await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Show causes" }).click();
    await shot(page, `${vpName}-08-graph-causes`);
    await audit(page, tag("graph selected"));
  }

  // ── Timeline ────────────────────────────────────────────────────────────────────────────
  await open(page, "/timeline", "Slipped items");
  await shot(page, `${vpName}-09-timeline`);
  await audit(page, tag("timeline"));

  // ── Map ─────────────────────────────────────────────────────────────────────────────────
  await open(page, "/map");
  await page.getByRole("group", { name: /Map plane/ }).waitFor();
  await shot(page, `${vpName}-10-map`);
  await audit(page, tag("map"));
  await page.getByRole("button", { name: "Uplands" }).click();
  await shot(page, `${vpName}-11-map-country`);

  // ── Object page ─────────────────────────────────────────────────────────────────────────
  await open(page, "/");
  await page
    .getByRole("link", { name: /Review service charge history\s*,\s*Task/ })
    .first()
    .click();
  await page.getByRole("heading", { name: "Review service charge history" }).first().waitFor();
  await shot(page, `${vpName}-12-object`);
  await audit(page, tag("object page"));

  // ── Mobile navigation drawer ────────────────────────────────────────────────────────────
  if (vpName === "mobile") {
    await open(page, "/", "Capital");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("navigation", { name: "Primary" }).last().waitFor();
    await shot(page, `${vpName}-13-nav-drawer`);
    await audit(page, tag("nav drawer"));
  }

  // ── Design gallery ──────────────────────────────────────────────────────────────────────
  await open(page, "/design", "Sand on graphite");
  await shot(page, `${vpName}-14-design`, { fullPage: true });
  await audit(page, tag("design gallery"));

  const real = errors.filter(
    (e) => !/Download the React DevTools|favicon|hydrat.*devtools/i.test(e),
  );
  if (real.length)
    failures.push(
      `${tag("console")}: ${real.length} error(s): ${real.slice(0, 3).join(" | ").slice(0, 400)}`,
    );
  await context.close();
}

await browser.close();
console.log(`\nScreenshots in ${OUT}/`);
if (notes.length) console.log(notes.join("\n"));
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("No accessibility, overflow or console problems.");
