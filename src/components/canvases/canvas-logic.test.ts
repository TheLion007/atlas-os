import { describe, expect, it } from "vitest";
import { buildTimeline, timelineWindow } from "@/domain/timeline";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { causeChain, egoLayout, neighbourhood } from "./graph-view";
import { makeTimeScale } from "./time-scale";
import { exampleSeed } from "@tests/fixtures/example-seed";

const data = buildFixtureData(exampleSeed());
const id = seedId;

describe("graph relations and hops", () => {
  it("finds the two-hop neighbourhood, ignoring direction", () => {
    const one = neighbourhood(data.edges, id("t_charges"), 1);
    expect(one.has(id("sp_dd"))).toBe(true); // its parent
    expect(one.has(id("t_valuation"))).toBe(true); // what waits on it
    expect(one.has(id("p_marina"))).toBe(false);
    expect(neighbourhood(data.edges, id("t_charges"), 2).has(id("p_marina"))).toBe(true);
    expect(neighbourhood(data.edges, id("t_charges"), 0)).toEqual(new Set([id("t_charges")]));
  });

  it("traces the cause chain of the relocation back to its origins", () => {
    const { nodeIds } = causeChain(data.edges, id("m_reloc"));
    for (const k of [
      "m_purchase",
      "m_savings",
      "m_sold",
      "t_list",
      "t_agent",
      "t_epc",
      "e_sav_b",
      "e_income",
      "d_district",
    ])
      expect(nodeIds.has(id(k)), k).toBe(true);
    expect(nodeIds.has(id("p_biz"))).toBe(false);
  });

  it("follows depends_on only, and terminates on a cycle in bad data", () => {
    expect(causeChain(data.edges, id("p_reloc")).nodeIds).toEqual(new Set([id("p_reloc")]));
    const cyc = [
      {
        id: "1",
        kind: "depends_on" as const,
        from: "a",
        to: "b",
        label: null,
        dependencyType: "fs",
        lagDays: 0,
        createdAt: "",
      },
      {
        id: "2",
        kind: "depends_on" as const,
        from: "b",
        to: "a",
        label: null,
        dependencyType: "fs",
        lagDays: 0,
        createdAt: "",
      },
    ];
    expect(causeChain(cyc, "a").nodeIds).toEqual(new Set(["a", "b"]));
  });

  it("builds a radial ego-view: the focus in the middle, its direct relations around it", () => {
    const ego = egoLayout(id("p_marina"), data.nodes, data.edges, 400, 400);
    const focus = ego.nodes.find((n) => n.id === id("p_marina"));
    expect(focus).toMatchObject({ x: 200, y: 200 });
    expect(ego.nodes.length).toBeGreaterThan(5);
    expect(ego.edges.every((e) => e.from === id("p_marina") || e.to === id("p_marina"))).toBe(true);
    const radii = ego.nodes
      .filter((n) => n.id !== id("p_marina"))
      .map((n) => Math.hypot(n.x - 200, n.y - 200));
    // All on one circle, to the 2-decimal rounding the layout applies for stable hydration.
    for (const r of radii) expect(r).toBeCloseTo(radii[0] as number, 1);
  });
});

describe("time scale and timeline model", () => {
  it("maps dates linearly across the window", () => {
    const s = makeTimeScale("2026-01-01", "2032-12-31", 700);
    expect(s.x("2026-01-01")).toBe(0);
    expect(s.x("2032-12-31")).toBeCloseTo(700);
    expect(s.x("2029-07-02")).toBeCloseTo(350, -1);
  });

  it("produces year ticks and quarter ticks", () => {
    const s = makeTimeScale("2026-01-01", "2028-12-31", 600);
    expect(s.ticks("year").map((t) => t.label)).toEqual(["2026", "2027", "2028"]);
    const q = s.ticks("quarter");
    expect(q).toHaveLength(12);
    expect(q.filter((t) => t.major).map((t) => t.label)).toEqual(["2026", "2027", "2028"]);
    expect(q[1]?.label).toBe("Q2");
  });

  it("frames the blueprint's default 2026–2032 and grows to fit the data", () => {
    expect(timelineWindow("2026-09-21", [])).toEqual({ start: "2026-01-01", end: "2032-12-31" });
    expect(timelineWindow("2026-09-21", ["2024-05-01", "2040-01-01"])).toEqual({
      start: "2024-01-01",
      end: "2040-12-31",
    });
  });

  const model = buildTimeline(data.nodes, data.edges, data.today);

  it("has a row per project with its dated milestones and tasks, ordered by start", () => {
    expect(model.rows.map((r) => r.title)).toEqual([
      "Dorsel relocation",
      "Ironfield flat sale",
      "Marina 1BR purchase",
      "Consulting entity setup",
    ]);
    const marina = model.rows.find((r) => r.title === "Marina 1BR purchase")!;
    // items from its sub-projects roll up into the project's row
    expect(marina.items.map((i) => i.title)).toContain("Review service charge history");
    expect(marina.items.map((i) => i.date)).toEqual([...marina.items.map((i) => i.date)].sort());
  });

  it("shows slip against the baseline as a ghost, with nothing stored", () => {
    const purchase = model.rows
      .flatMap((r) => r.items)
      .find((i) => i.title === "Purchase the Marina 1BR")!;
    expect(purchase.date).toBe("2028-12-31");
    expect(purchase.baselineDate).toBe("2028-09-30");
    expect(purchase.slipDays).toBe(92);
    const bank = model.rows.flatMap((r) => r.items).find((i) => i.title === "Choose a visa route")!;
    expect(bank.baselineDate).toBeNull();
  });

  it("carries dependency hairlines from the predecessor to the item that waits", () => {
    const from = id("m_purchase");
    const to = id("m_reloc");
    expect(model.dependencies).toContainEqual({ from, to });
    expect(model.dependencies.every((d) => d.from !== d.to)).toBe(true);
  });

  it("marks blocked items", () => {
    const valuation = model.rows
      .flatMap((r) => r.items)
      .find((i) => i.title === "Commission an independent valuation")!;
    expect(valuation.blocked).toBe(true);
  });

  it("covers today and every date it draws", () => {
    expect(model.start <= "2026-09-21").toBe(true);
    expect(model.end >= "2029-03-31").toBe(true);
  });

  it("is an empty model, not an error, with no projects", () => {
    expect(buildTimeline([], [], "2026-09-21").rows).toEqual([]);
  });
});
