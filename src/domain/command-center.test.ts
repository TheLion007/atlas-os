import { describe, expect, it } from "vitest";
import type { ApiObject } from "./api-types";
import { buildCommandCenter, estimateApplies, type CommandCenterInput } from "./command-center";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { exampleSeed } from "@tests/fixtures/example-seed";

const data = buildFixtureData(exampleSeed());
const input = (over: Partial<CommandCenterInput> = {}): CommandCenterInput => ({
  today: data.today,
  scenario: "base",
  baseCurrency: data.settings.baseCurrency,
  fxRates: data.settings.fxRates,
  nodes: data.nodes,
  edges: data.edges,
  ...over,
});
const titles = (xs: { title: string }[]) => xs.map((x) => x.title);

describe("buildCommandCenter — empty", () => {
  const empty = buildCommandCenter({
    today: "2026-09-21",
    scenario: "base",
    baseCurrency: null,
    fxRates: [],
    nodes: [],
    edges: [],
  });

  it("is empty, with a checklist that is entirely to-do", () => {
    expect(empty.isEmpty).toBe(true);
    expect(empty.checklist.length).toBeGreaterThanOrEqual(4);
    expect(empty.checklist.every((c) => !c.done)).toBe(true);
    expect(empty.focus).toEqual([]);
    expect(empty.projects).toEqual([]);
  });

  it("reports no base currency instead of assuming one", () => {
    expect(empty.capital.hasBaseCurrency).toBe(false);
    expect(empty.capital.actual).toBeNull();
    expect(empty.capital.ratio).toBeNull();
  });
});

describe("buildCommandCenter — illustrative data", () => {
  const m = buildCommandCenter(input());

  it("derives the checklist from the data", () => {
    expect(m.isEmpty).toBe(false);
    expect(m.checklist.every((c) => c.done)).toBe(true);
  });

  describe("what does this cost me: capital", () => {
    it("sums actual and target capital in the base currency", () => {
      expect(m.capital).toMatchObject({
        hasBaseCurrency: true,
        baseCurrency: "EUR",
        actual: 109400,
        target: 420000,
      });
      expect(m.capital.ratio).toBeCloseTo(109400 / 420000);
      expect(m.capital.unconverted).toEqual([]);
    });

    it("ignores non-capital estimates such as prices and rents", () => {
      // The AED asking price is an acquisition cost, not capital: it must not inflate the total.
      expect(m.capital.actual).toBe(109400);
    });

    it("has no ratio when there is no target, and no total when there is no base currency", () => {
      const noTarget = buildCommandCenter(
        input({ nodes: data.nodes.filter((n) => n.id !== seedId("e_cap_target")) }),
      );
      expect(noTarget.capital.target).toBeNull();
      expect(noTarget.capital.ratio).toBeNull();
      expect(buildCommandCenter(input({ baseCurrency: null })).capital.actual).toBeNull();
    });

    it("reports an unconvertible estimate rather than dropping it silently", () => {
      const usd: ApiObject = {
        ...(data.nodes.find((n) => n.id === seedId("e_cap_actual")) as ApiObject),
        id: "usd-1",
        title: "Capital in USD",
        details: {
          amount: 5000,
          currency: "USD",
          unit: "currency",
          category: "capital",
          dataKind: "actual",
          scenarioId: null,
        },
      };
      const r = buildCommandCenter(input({ nodes: [...data.nodes, usd] }));
      expect(r.capital.actual).toBe(109400);
      expect(r.capital.unconverted).toEqual([
        { id: "usd-1", title: "Capital in USD", amount: 5000, currency: "USD" },
      ]);
    });
  });

  describe("what is next", () => {
    it("names the three things that matter: the soonest unblocked, live work", () => {
      expect(titles(m.focus)).toEqual([
        "Review service charge history",
        "Choose an agent",
        "Prepare the energy certificate",
      ]);
      expect(m.focus.every((f) => !f.blocked)).toBe(true);
    });

    it("never puts blocked work in Focus", () => {
      const blockedTitles = titles(m.blocked);
      for (const f of m.focus) expect(blockedTitles).not.toContain(f.title);
    });

    it("lists the next 90 days in date order, from today to the horizon", () => {
      expect(m.next90.length).toBeGreaterThanOrEqual(5);
      const dates = m.next90.map((i) => i.date as string);
      expect([...dates].sort()).toEqual(dates);
      for (const d of dates) {
        expect(d >= "2026-09-21").toBe(true);
        expect(d <= "2026-12-20").toBe(true);
      }
    });

    it("flags overdue work", () => {
      const late = buildCommandCenter(input({ today: "2026-10-20" }));
      expect(late.focus.find((f) => f.title === "Review service charge history")?.overdue).toBe(
        true,
      );
      expect(late.focus[0]?.overdue).toBe(true);
    });
  });

  describe("what is moving: projects", () => {
    it("derives progress from weighted effort and reports 0% only when there is real zero progress", () => {
      const byTitle = Object.fromEntries(m.projects.map((p) => [p.title, p]));
      expect(byTitle["Dorsel relocation"]?.progress).toBeCloseTo(0.5);
      expect(byTitle["Marina 1BR purchase"]?.progress).toBeCloseTo(2 / 12);
      expect(byTitle["Consulting entity setup"]?.progress).toBe(0);
    });

    it("orders by priority and reports no data for a project with no tasks", () => {
      expect(m.projects[0]?.priority).toBe(1);
      const bare: ApiObject = {
        id: "p-bare",
        type: "project",
        title: "Bare",
        status: "active",
        tags: [],
        confidence: null,
        color: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        details: { priority: 4 },
      };
      const r = buildCommandCenter(input({ nodes: [...data.nodes, bare] }));
      expect(r.projects.find((p) => p.id === "p-bare")?.progress).toBeNull();
    });
  });

  describe("what is blocked", () => {
    it("shows the cause of each block, by name", () => {
      const valuation = m.blocked.find((b) => b.title === "Commission an independent valuation");
      expect(titles(valuation?.blockedBy ?? [])).toEqual(["Review service charge history"]);
    });

    it("blocks the whole downstream chain to the relocation", () => {
      const names = titles(m.blocked);
      for (const t of [
        "List the property",
        "Ironfield flat sold",
        "Savings target reached",
        "Purchase the Marina 1BR",
        "Relocation",
      ])
        expect(names).toContain(t);
    });

    it("only schedulable work can be blocked: an estimate resting on an assumption is not 'waiting'", () => {
      // "Capital on hand" depends_on the savings assumption. That is a data dependency, not a
      // precedence, so it must never appear as blocked.
      expect(titles(m.blocked)).not.toContain("Capital on hand");
      expect(
        m.blocked.every((b) =>
          ["task", "milestone", "project", "sub_project", "decision"].includes(b.type),
        ),
      ).toBe(true);
    });

    it("does not report finished work as blocked", () => {
      expect(titles(m.blocked)).not.toContain("Visit the Marina 1BR");
    });
  });

  describe("risks and decisions", () => {
    it("ranks risks by probability × impact and derives the level", () => {
      expect(m.risks[0]).toMatchObject({ title: "Prices rise before the purchase", level: "high" });
      const scores = m.risks.map((r) => r.probability * r.impact);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    });

    it("lists open decisions by deadline and leaves out the closed one", () => {
      expect(titles(m.decisions)).toEqual(["Which district?", "Free zone or mainland?"]);
      expect(m.decisions[0]?.daysLeft).toBe(85);
    });

    it("marks a decision overdue once its deadline passes", () => {
      const r = buildCommandCenter(input({ today: "2026-12-20" }));
      expect(r.decisions.find((d) => d.title === "Which district?")?.overdue).toBe(true);
    });
  });
});

describe("estimateApplies", () => {
  const est = (scenarioId: string | null): ApiObject =>
    ({
      id: "e",
      type: "estimate",
      title: "e",
      status: "active",
      tags: [],
      confidence: null,
      color: null,
      createdAt: "",
      updatedAt: "",
      details: { scenarioId },
    }) as ApiObject;
  const variants = new Map([
    ["s1", "conservative" as const],
    ["s2", "base" as const],
  ]);

  it("applies to every scenario when it belongs to none", () => {
    expect(estimateApplies(est(null), "optimistic", variants)).toBe(true);
  });
  it("applies only to its own scenario", () => {
    expect(estimateApplies(est("s1"), "conservative", variants)).toBe(true);
    expect(estimateApplies(est("s1"), "base", variants)).toBe(false);
  });
  it("does not apply when its scenario is unknown", () => {
    expect(estimateApplies(est("gone"), "base", variants)).toBe(false);
  });
});
