import { describe, expect, it } from "vitest";
import { computeSchedule, rollUpProgress } from "@/domain/engine";
import { OBJECT_TYPES } from "@/domain/enums";
import { validateNewEdge, type EdgeRef } from "@/domain/graph-validation";
import { createEdgeSchema, createObjectSchema } from "@/domain/schemas";
import { buildFixtureData } from "./fixtures";
import { seedId } from "./seed-types";
import { exampleSeed, SEED_TODAY } from "@tests/fixtures/example-seed";

const seed = exampleSeed();

describe("illustrative seed", () => {
  it("passes the same object schemas the API enforces", () => {
    for (const o of seed.objects) {
      const r = createObjectSchema.safeParse(o.input);
      expect(r.success, `${o.key}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it("obeys every edge rule the database enforces, in order", () => {
    const type = new Map(
      seed.objects.map((o) => [o.key, createObjectSchema.parse(o.input).type] as const),
    );
    const live: EdgeRef[] = [];
    for (const e of seed.edges) {
      const from = seedId(e.from);
      const to = seedId(e.to);
      const violations = validateNewEdge(
        { kind: e.kind, from, to, fromType: type.get(e.from)!, toType: type.get(e.to)! },
        live,
      );
      expect(violations, `${e.kind} ${e.from} -> ${e.to}`).toEqual([]);
      expect(
        createEdgeSchema.safeParse({
          kind: e.kind,
          from,
          to,
          label: e.label ?? null,
          dependencyType: e.dependencyType ?? null,
          lagDays: e.lagDays ?? null,
        }).success,
      ).toBe(true);
      live.push({ kind: e.kind, from, to });
    }
  });

  it("uses unique keys and stable, distinct ids", () => {
    const keys = seed.objects.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys.map(seedId)).size).toBe(keys.length);
    expect(seedId("p_reloc")).toBe(seedId("p_reloc"));
    expect(seedId("p_reloc")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("labels everything as illustrative and never claims verified data", () => {
    for (const o of seed.objects) expect(o.input.tags, o.key).toContain("illustrative");
    for (const o of seed.objects.filter((x) => x.input.type === "estimate")) {
      expect((o.input.details as { source: string }).source).toMatch(/Illustrative/);
    }
    for (const r of seed.settings.fxRates) expect(r.source).toMatch(/Illustrative/);
  });

  it("covers every object type", () => {
    const types = new Set(seed.objects.map((o) => createObjectSchema.parse(o.input).type));
    expect([...types].sort()).toEqual([...OBJECT_TYPES].sort());
  });

  it("spans more than one country with one structure (the model is generic)", () => {
    const countries = new Set(
      seed.objects
        .filter((o) => o.input.type === "location")
        .map((o) => (o.input.details as { countryCode: string }).countryCode),
    );
    expect(countries).toEqual(new Set(["BE", "AE"]));
  });

  it("has a temporally coherent chain: relocation follows purchase, follows savings, follows the sale", () => {
    const { nodes, edges } = buildFixtureData(seed);
    const dateOf = (key: string) =>
      nodes.find((n) => n.id === seedId(key))?.details?.date as string;
    expect(dateOf("m_sold") < dateOf("m_savings")).toBe(true);
    expect(dateOf("m_savings") < dateOf("m_purchase")).toBe(true);
    expect(dateOf("m_purchase") < dateOf("m_reloc")).toBe(true);

    // No milestone is scheduled before something it depends on: the engine finds no push.
    const schedule = computeSchedule(
      nodes
        .filter((n) => n.type === "milestone")
        .map((n) => ({
          id: n.id,
          date: n.details?.date as string,
          baselineDate: n.details?.baselineDate as string,
        })),
      edges,
    );
    for (const id of ["m_sold", "m_savings", "m_purchase", "m_reloc"].map(seedId)) {
      expect(schedule.get(id)?.drivenBy, id).toBeNull();
    }
  });

  it("reproduces the blueprint's worked example with only the six edge kinds", () => {
    const has = (kind: string, from: string, to: string) =>
      seed.edges.some((e) => e.kind === kind && e.from === from && e.to === to);
    expect(has("funded_by", "prop_marina", "e_cap_actual")).toBe(true);
    expect(has("depends_on", "e_cap_actual", "e_sav_b")).toBe(true);
    expect(has("depends_on", "e_sav_b", "e_income")).toBe(true);
    expect(has("depends_on", "m_reloc", "m_purchase")).toBe(true);
  });

  it("derives varied, believable progress (including a real 0%)", () => {
    const { nodes, edges } = buildFixtureData(seed);
    const progress = rollUpProgress(
      nodes.map((n) => ({
        id: n.id,
        type: n.type,
        status: n.status,
        effort: (n.details?.effort as number) ?? null,
      })),
      edges,
    );
    const p = (k: string) => progress.get(seedId(k))?.progress;
    expect(p("p_reloc")).toBeCloseTo(0.5);
    expect(p("p_marina")).toBeCloseTo(2 / 12);
    expect(p("p_ironfield")).toBeCloseTo(2 / 7);
    expect(p("p_biz")).toBe(0);
  });
});

describe("fixture data", () => {
  const data = buildFixtureData(seed);

  it("is API-shaped: ids, ISO timestamps, camelCase details", () => {
    expect(data.today).toBe(SEED_TODAY);
    const est = data.nodes.find((n) => n.id === seedId("e_cap_actual"));
    expect(est?.details).toMatchObject({ amount: 109400, currency: "EUR", dataKind: "actual" });
    for (const n of data.nodes) expect(new Date(n.createdAt).toISOString()).toBe(n.createdAt);
  });

  it("links activity to real objects, newest first", () => {
    for (const a of data.activity) expect(data.nodes.some((n) => n.id === a.objectId)).toBe(true);
    const times = data.activity.map((a) => a.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("keeps derived values out of stored details", () => {
    for (const n of data.nodes)
      for (const forbidden of ["progress", "riskLevel", "slipDays", "yield", "blocked"])
        expect(n.details ?? {}, `${n.title}.${forbidden}`).not.toHaveProperty(forbidden);
  });
});
