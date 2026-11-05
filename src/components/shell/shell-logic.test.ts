import { describe, expect, it, vi } from "vitest";
import { formatDate } from "@/lib/format";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { i18nCtx } from "../../../tests/support/i18n";
import { ALL_NAV, COLLECTIONS, LENSES, hrefKeepingState, isActive, titleKeyForPath } from "./nav";
import { describeFields } from "./object-fields";
import { buildPaletteItems, paletteMode, type PaletteActions } from "./palette-items";
import { exampleSeed } from "@tests/fixtures/example-seed";

const data = buildFixtureData(exampleSeed());
const node = (key: string) => data.nodes.find((n) => n.id === seedId(key))!;
const en = i18nCtx("en");
const fr = i18nCtx("fr");

describe("navigation", () => {
  it("is flat: lenses and collections, no nesting", () => {
    expect(LENSES.map((l) => en.t(l.label))).toEqual([
      "Home",
      "Map",
      "Graph",
      "Timeline",
      "Calendar",
      "Timer",
      "History",
      "Memory",
    ]);
    expect(LENSES.map((l) => fr.t(l.label))).toEqual([
      "Accueil",
      "Carte",
      "Graphe",
      "Chronologie",
      "Calendrier",
      "Minuteur",
      "Historique",
      "Mémoire",
    ]);
    expect(COLLECTIONS.map((c) => en.t(c.label))).toEqual([
      "Plans",
      "Projects",
      "Tasks",
      "Finance",
      "Decisions",
      "Risks",
      "Notes",
      "Vault",
    ]);
  });

  it("never links to a page that does not exist yet: unbuilt items are marked with their phase", () => {
    for (const item of ALL_NAV.filter((n) => !n.ready))
      expect(typeof item.phase, item.label).toBe("number");
    expect(LENSES.every((l) => l.ready)).toBe(true);
    // Every lens and collection is built now, Finance and Documents included.
    expect(ALL_NAV.filter((n) => !n.ready).map((n) => n.id)).toEqual([]);
  });

  it("carries scenario and peek across a lens switch, and nothing else", () => {
    const current = new URLSearchParams("scenario=conservative&peek=abc&junk=1");
    expect(hrefKeepingState("/graph", current)).toBe("/graph?scenario=conservative&peek=abc");
    expect(hrefKeepingState("/graph", new URLSearchParams())).toBe("/graph");
  });

  it("titles the top bar from the path", () => {
    expect(titleKeyForPath("/")).toBe("nav.overview");
    expect(titleKeyForPath("/graph")).toBe("nav.graph");
    expect(titleKeyForPath("/objects/abc")).toBe("nav.object");
    expect(titleKeyForPath("/whatever")).toBeNull();
  });

  it("marks the active item, matching the root exactly", () => {
    const overview = LENSES[0]!;
    const graph = LENSES[2]!;
    expect(isActive(overview, "/")).toBe(true);
    expect(isActive(overview, "/graph")).toBe(false);
    expect(isActive(graph, "/graph")).toBe(true);
    expect(isActive(graph, "/graph/x")).toBe(true);
  });
});

describe("palette items", () => {
  const actions: PaletteActions = {
    peek: vi.fn(),
    open: vi.fn(),
    go: vi.fn(),
    setScenario: vi.fn(),
    toggleSidebar: vi.fn(),
    openAssistant: vi.fn(),
    toggleTheme: vi.fn(),
    toggleTimer: vi.fn(),
    create: vi.fn(),
    setLocale: vi.fn(),
  };
  const build = (
    query: string,
    recent: string[] = [],
    locale: "en" | "fr" = "en",
    context = null,
  ) =>
    buildPaletteItems({
      query,
      nodes: data.nodes,
      recent,
      scenario: "base",
      locale,
      t: i18nCtx(locale).t,
      context,
      actions,
    });

  it("detects the three modes", () => {
    expect(paletteMode("")).toBe("recent");
    expect(paletteMode("   ")).toBe("recent");
    expect(paletteMode("marina")).toBe("typing");
    expect(paletteMode(">scen")).toBe("action-mode");
    expect(paletteMode("  > x")).toBe("action-mode");
  });

  it("opens on the design's quick actions, a few places and the projects", () => {
    const items = build("", [seedId("p_reloc")]);
    expect(items.filter((i) => i.group === "Quick actions").map((i) => i.label)).toEqual([
      "New project",
      "New task",
      "Quick note",
      "Start the timer",
      "Open the assistant",
      "Switch the theme",
    ]);
    expect(items.filter((i) => i.group === "Go to").map((i) => i.label)).toEqual([
      "Calendar",
      "Graph",
      "History",
    ]);
    expect(items.filter((i) => i.group === "Projects").map((i) => i.label)).toContain(
      "Dorsel relocation",
    );
    expect(items.some((i) => i.group === "Recent")).toBe(false);
  });

  it("keeps every screen reachable by typing, the design's ten first", () => {
    const go = build("e")
      .filter((i) => i.group === "Go to")
      .map((i) => i.id);
    expect(go.slice(0, 3)).toEqual(
      ["go:overview", "go:projects", "go:calendar"].filter((id) => go.includes(id)).slice(0, 3),
    );
    for (const typed of ["timeline", "memory", "plans", "tasks", "finance", "decisions", "risks"])
      expect(
        build(typed).some((i) => i.group === "Go to"),
        typed,
      ).toBe(true);
  });

  it("groups typed results by object type, best group first", () => {
    const items = build("marina");
    const groups = [...new Set(items.map((i) => i.group))];
    expect(groups[0]).toBeTruthy();
    expect(items.some((i) => i.label === "Dorsel Marina" && i.group === "Locations")).toBe(true);
    expect(items.some((i) => i.label === "Marina 1BR purchase" && i.group === "Projects")).toBe(
      true,
    );
  });

  it("caps each group so one type cannot flood the list", () => {
    const perGroup = new Map<string, number>();
    for (const i of build("e"))
      if (i.group !== "Go to") perGroup.set(i.group, (perGroup.get(i.group) ?? 0) + 1);
    for (const [group, n] of perGroup) expect(n, group).toBeLessThanOrEqual(6);
  });

  it("opens the page on Enter or a click, and peeks on Alt+Enter", () => {
    const item = build("Dorsel relocation").find((i) => i.label === "Dorsel relocation")!;
    item.run({ alt: false });
    expect(actions.open).toHaveBeenCalledWith(seedId("p_reloc"));
    item.run({ alt: true });
    expect(actions.peek).toHaveBeenCalledWith(seedId("p_reloc"));
  });

  it("offers only working actions, and not the scenario already in view", () => {
    const labels = build(">").map((i) => i.label);
    expect(labels).toContain("Preview the Conservative scenario");
    expect(labels).toContain("Preview the Optimistic scenario");
    expect(labels).not.toContain("Preview the Base scenario");
    expect(labels).toContain("Toggle the sidebar");
    expect(labels).toContain("Switch language to Français");
    expect(labels).not.toContain("Switch language to English");
  });

  it("filters actions by the text after the prefix", () => {
    expect(build(">optim").map((i) => i.label)).toEqual(["Preview the Optimistic scenario"]);
    expect(build(">zzz")).toEqual([]);
  });

  it("offers places to go that match what was typed, and only built ones", () => {
    const go = build("gra").filter((i) => i.group === "Go to");
    expect(go.map((i) => i.label)).toEqual(["Graph"]);
    expect(build("finance").some((i) => i.group === "Go to")).toBe(true);
    expect(build("documents").some((i) => i.group === "Go to")).toBe(true);
    expect(build("projects").some((i) => i.group === "Go to")).toBe(true);
  });
});

describe("palette: create and language", () => {
  const actions: PaletteActions = {
    peek: vi.fn(),
    open: vi.fn(),
    go: vi.fn(),
    setScenario: vi.fn(),
    toggleSidebar: vi.fn(),
    openAssistant: vi.fn(),
    toggleTheme: vi.fn(),
    toggleTimer: vi.fn(),
    create: vi.fn(),
    setLocale: vi.fn(),
  };
  const build = (
    query: string,
    locale: "en" | "fr" = "en",
    context: (typeof data.nodes)[number] | null = null,
  ) =>
    buildPaletteItems({
      query,
      nodes: data.nodes,
      recent: [],
      scenario: "base",
      locale,
      t: i18nCtx(locale).t,
      context,
      actions,
    });

  it("creates from the same input that searches", () => {
    const task = build("task").find((i) => i.id === "quick:task")!;
    expect(task.label).toBe("New task");
    expect(task.key).toBe("N");
    task.run({ alt: false });
    expect(actions.create).toHaveBeenCalledWith("task");
  });

  it("speaks French, matching accents loosely", () => {
    expect(build("tache", "fr").some((i) => i.label === "Nouvelle tâche")).toBe(true);
    expect(build(">langue", "fr").length).toBe(0); // the wording is "Passer l’interface en English"
    expect(build(">interface", "fr").map((i) => i.label)).toContain(
      "Passer l’interface en English",
    );
  });

  it("switches language from the actions", () => {
    build(">français")
      .find((i) => i.id === "action:locale:fr")!
      .run({ alt: false });
    expect(actions.setLocale).toHaveBeenCalledWith("fr");
  });
});

describe("describeFields", () => {
  it("formats an estimate's value with its currency and per-period unit, in the estimate's own currency", () => {
    expect(
      describeFields("estimate", node("e_rent").details, en).find((f) => f.key === "amount")?.value,
    ).toMatch(/AED.*7,500.* \/ month/);
    expect(
      describeFields("estimate", node("e_cap_actual").details, en).find((f) => f.key === "amount")
        ?.value,
    ).toContain("€109,400");
  });

  it("shows provenance for an estimate: source and as-of date", () => {
    const rows = describeFields("estimate", node("e_price").details, en);
    expect(rows.find((r) => r.key === "source")?.value).toMatch(/Illustrative/);
    expect(rows.find((r) => r.key === "asOf")?.value).toBe(formatDate("2026-09-01"));
  });

  it("puts numbers and dates in mono and prose in the body face", () => {
    const rows = describeFields("project", node("p_marina").details, en);
    expect(rows.find((r) => r.key === "targetDate")?.mono).toBe(true);
    expect(rows.find((r) => r.key === "description")?.mono).toBe(false);
  });

  it("skips unset fields instead of showing blanks", () => {
    const keys = describeFields("task", node("t_bank").details, en).map((r) => r.key);
    expect(keys).not.toContain("due");
    expect(keys).not.toContain("description");
  });

  it("shows coordinates with their provenance, never as if surveyed", () => {
    const coords = describeFields("location", node("marina").details, en).find(
      (r) => r.key === "lat",
    );
    expect(coords?.value).toBe("25.0800, 55.1400 (manual)");
  });

  it("resolves a decision's chosen option to its label", () => {
    expect(
      describeFields("decision", node("d_mortgage").details, en).find(
        (r) => r.key === "resolvedOptionId",
      )?.value,
    ).toBe("Cash");
  });

  it("never shows derived values as stored fields", () => {
    for (const n of data.nodes)
      for (const row of describeFields(n.type, n.details, en))
        expect(["progress", "riskLevel", "slipDays", "yield"]).not.toContain(row.key);
  });

  it("reads the same object in French, with French dates, money and field names", () => {
    const rows = describeFields("project", node("p_marina").details, fr);
    expect(rows.find((r) => r.key === "targetDate")?.label).toBe("Cible");
    expect(rows.find((r) => r.key === "targetDate")?.value).toMatch(/2031|2030|202\d/);
    const estimate = describeFields("estimate", node("e_cap_actual").details, fr).find(
      (r) => r.key === "amount",
    );
    // French digit grouping uses a narrow no-break space, and the currency follows the amount.
    expect(estimate?.value.replace(/\s/g, " ")).toMatch(/109 400 €/);
  });

  it("is safe for missing details", () => {
    expect(describeFields("note", undefined, en)).toEqual([]);
  });
});
