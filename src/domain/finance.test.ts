import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject, FxRate } from "./api-types";
import {
  buildFinanceModel,
  financeRole,
  monthlyFlows,
  projectBalance,
  projectionInputs,
  spendingByCategory,
  summariseFinance,
  type FinanceInput,
} from "./finance";
import { createObjectSchema } from "./schemas";

let n = 0;
const obj = (over: Partial<ApiObject> & Pick<ApiObject, "type" | "title">): ApiObject => ({
  id: `id-${++n}`,
  status: "active",
  tags: [],
  confidence: null,
  color: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

/** A financial value, validated by the same schema the API uses (so defaults apply). */
const value = (title: string, details: Record<string, unknown>, over: Partial<ApiObject> = {}) => {
  const parsed = createObjectSchema.parse({ type: "estimate", title, details });
  return obj({ type: "estimate", title, details: parsed.details as never, ...over });
};
const txn = (title: string, details: Record<string, unknown>) => {
  const parsed = createObjectSchema.parse({ type: "transaction", title, details });
  return obj({ type: "transaction", title, details: parsed.details as never });
};
const scenario = (variant: string, id: string) =>
  obj({ id, type: "scenario", title: variant, details: { variant } });

const input = (
  nodes: ApiObject[],
  over: Partial<FinanceInput> & { edges?: ApiEdge[]; fxRates?: FxRate[] } = {},
): FinanceInput => ({
  nodes,
  edges: [],
  baseCurrency: "EUR",
  fxRates: [],
  scenario: "base",
  today: "2026-09-21",
  ...over,
});

describe("financial values", () => {
  it("creates a structured value with its data kind, currency and provenance", () => {
    const parsed = createObjectSchema.parse({
      type: "estimate",
      title: "ETF",
      details: {
        amount: 1000,
        currency: "USD",
        category: "investment",
        dataKind: "actual",
        costBasis: 800,
        ticker: "VT",
        source: "bank_statement",
      },
    });
    expect(parsed.details).toMatchObject({
      amount: 1000,
      currency: "USD",
      category: "investment",
      dataKind: "actual",
      costBasis: 800,
      ticker: "VT",
      source: "bank_statement",
    });
  });

  it("refuses money without a currency and an invested capital on a non-monetary value", () => {
    expect(() =>
      createObjectSchema.parse({ type: "estimate", title: "x", details: { amount: 1 } }),
    ).toThrow();
    expect(() =>
      createObjectSchema.parse({
        type: "estimate",
        title: "x",
        details: { amount: 5, unit: "percent", costBasis: 3 },
      }),
    ).toThrow();
  });

  it("derives a role from category and unit, never from a stored field", () => {
    expect(financeRole(value("a", { amount: 1, currency: "EUR", category: "cash" }))).toBe("cash");
    expect(financeRole(value("b", { amount: 1, currency: "EUR", category: "liability" }))).toBe(
      "liability",
    );
    expect(
      financeRole(
        value("c", { amount: 1, currency: "EUR", category: "expense", unit: "currency_per_year" }),
      ),
    ).toBe("expense");
    expect(
      financeRole(
        value("d", { amount: 7, currency: null, unit: "percent", category: "investment" }),
      ),
    ).toBe("metric");
  });
});

describe("summary", () => {
  const nodes = () => [
    value("Current account", {
      amount: 5000,
      currency: "EUR",
      category: "cash",
      dataKind: "actual",
    }),
    value("ETF", { amount: 20000, currency: "EUR", category: "investment", dataKind: "actual" }),
    value("Flat", { amount: 300000, currency: "EUR", category: "asset", dataKind: "actual" }),
    value("Mortgage", {
      amount: 150000,
      currency: "EUR",
      category: "liability",
      dataKind: "actual",
    }),
    value("Salary", {
      amount: 4000,
      currency: "EUR",
      unit: "currency_per_month",
      category: "income",
      dataKind: "actual",
    }),
    value("Insurance", {
      amount: 1200,
      currency: "EUR",
      unit: "currency_per_year",
      category: "expense",
      dataKind: "actual",
    }),
    value("Rent", {
      amount: 1000,
      currency: "EUR",
      unit: "currency_per_month",
      category: "expense",
      dataKind: "actual",
    }),
  ];

  it("computes net worth as assets minus liabilities", () => {
    const s = summariseFinance(input(nodes()));
    expect(s.cash.value).toBe(5000);
    expect(s.assets.value).toBe(325000);
    expect(s.liabilities.value).toBe(150000);
    expect(s.netWorth.value).toBe(175000);
  });

  it("computes monthly cash flow as income minus expenses, yearly flows per month", () => {
    const s = summariseFinance(input(nodes()));
    expect(s.monthlyIncome.value).toBe(4000);
    expect(s.monthlyExpenses.value).toBe(1100);
    expect(s.monthlyCashFlow.value).toBe(2900);
  });

  it("never mixes a target, an estimate or an assumption into actual totals", () => {
    const all = [
      ...nodes(),
      value("Cash goal", { amount: 25000, currency: "EUR", category: "cash", dataKind: "target" }),
      value("Expected bonus", {
        amount: 9000,
        currency: "EUR",
        category: "cash",
        dataKind: "estimate",
      }),
      value("Savings", {
        amount: 800,
        currency: "EUR",
        unit: "currency_per_month",
        category: "income",
        dataKind: "assumption",
      }),
    ];
    const model = buildFinanceModel(input(all));
    expect(model.summary.cash.value).toBe(5000);
    expect(model.summary.monthlyIncome.value).toBe(4000);
    expect(model.summary.notActual).toBe(3);
    expect(model.planning.map((v) => v.dataKind).sort()).toEqual([
      "assumption",
      "estimate",
      "target",
    ]);
  });

  it("recomputes when a source value changes or is removed (nothing derived is stored)", () => {
    const list = nodes();
    const before = summariseFinance(input(list)).netWorth.value;
    const flat = list.find((x) => x.title === "Flat")!;
    const edited = list.map((x) =>
      x.id === flat.id ? { ...x, details: { ...x.details, amount: 320000 } } : x,
    );
    expect(summariseFinance(input(edited)).netWorth.value).toBe((before ?? 0) + 20000);
    const removed = list.filter((x) => x.title !== "Mortgage");
    expect(summariseFinance(input(removed)).netWorth.value).toBe(325000);
    const archived = list.map((x) =>
      x.title === "Mortgage" ? { ...x, status: "dropped" as const } : x,
    );
    expect(summariseFinance(input(archived)).liabilities.value).toBeNull();
  });

  it("says 'no data' rather than zero when nothing feeds a total", () => {
    const s = summariseFinance(input([]));
    expect(s.netWorth.value).toBeNull();
    expect(s.monthlyCashFlow.value).toBeNull();
  });
});

describe("currencies", () => {
  it("converts with the owner's own rate and never assumes a currency", () => {
    const nodes = [
      value("EUR cash", { amount: 1000, currency: "EUR", category: "cash", dataKind: "actual" }),
      value("AED cash", { amount: 4000, currency: "AED", category: "cash", dataKind: "actual" }),
      value("USD cash", { amount: 500, currency: "USD", category: "cash", dataKind: "actual" }),
    ];
    const s = summariseFinance(
      input(nodes, {
        fxRates: [{ from: "AED", to: "EUR", rate: 0.25, asOf: "2026-09-01", source: "manual" }],
      }),
    );
    // 1000 + 4000 × 0.25; USD has no rate, so it is left out and listed, not counted as EUR.
    expect(s.cash.value).toBe(2000);
    expect(s.cash.unconverted.map((u) => u.title)).toEqual(["USD cash"]);
  });

  it("cannot total anything without a base currency", () => {
    const nodes = [
      value("c", { amount: 1, currency: "EUR", category: "cash", dataKind: "actual" }),
    ];
    const s = summariseFinance(input(nodes, { baseCurrency: null }));
    expect(s.cash.value).toBe(0);
    expect(s.cash.unconverted).toHaveLength(1);
  });
});

describe("scenarios and projections", () => {
  const sc = [scenario("base", "sc-b"), scenario("optimistic", "sc-o")];
  const base = () => [
    ...sc,
    value("Cash", { amount: 10000, currency: "EUR", category: "cash", dataKind: "actual" }),
    value("Savings (base)", {
      amount: 500,
      currency: "EUR",
      unit: "currency_per_month",
      category: "capital",
      dataKind: "assumption",
      scenarioId: "11111111-1111-4111-8111-111111111111",
    }),
  ];

  it("compounds monthly: 0 % is linear, a positive return grows faster", () => {
    const flat = projectBalance(10000, 500, 0, 120, "2026-09-21");
    expect(flat).toHaveLength(121);
    expect(flat[120]?.value).toBeCloseTo(70000, 6);
    expect(flat[120]?.contributed).toBeCloseTo(70000, 6);
    const grown = projectBalance(10000, 500, 0.07, 120, "2026-09-21");
    expect(grown[120]!.value).toBeGreaterThan(70000);
    // 10 000 at 7 % for 10 years with no contribution doubles (≈ 19 672).
    expect(projectBalance(10000, 0, 0.07, 120, "2026-09-21")[120]!.value).toBeCloseTo(19671.5, 0);
    expect(grown[0]?.label).toBe("2026-09");
    expect(grown[120]?.label).toBe("2036-09");
  });

  it("takes each scenario's own assumptions, and traces where every input came from", () => {
    const b = "sc-b";
    const o = "sc-o";
    const nodes = [
      ...sc,
      value("Cash", { amount: 10000, currency: "EUR", category: "cash", dataKind: "actual" }),
      value(
        "Return (base)",
        {
          amount: 4,
          currency: null,
          unit: "percent",
          category: "investment",
          dataKind: "assumption",
        },
        {},
      ),
      value("Return (optimistic)", {
        amount: 8,
        currency: null,
        unit: "percent",
        category: "investment",
        dataKind: "assumption",
      }),
    ];
    // Attach scenario ids by hand (the schema checks a UUID; ids in this test are short).
    nodes[3]!.details = { ...nodes[3]!.details, scenarioId: b };
    nodes[4]!.details = { ...nodes[4]!.details, scenarioId: o };
    const i = input(nodes);
    const inBase = projectionInputs(i, "base");
    const inOpt = projectionInputs(i, "optimistic");
    expect(inBase.annualReturn.value).toBeCloseTo(0.04);
    expect(inOpt.annualReturn.value).toBeCloseTo(0.08);
    expect(inBase.start).toEqual({
      value: 10000,
      origin: { kind: "derived", from: "actual_liquid" },
    });
    expect(inBase.annualReturn.origin).toMatchObject({ kind: "value", dataKind: "assumption" });
    // No contribution assumption and no cash flow: nothing is invented.
    expect(inBase.monthlyContribution).toEqual({ value: 0, origin: { kind: "none" } });
  });

  it("falls back to 0 % return, labelled as such, when no return assumption exists", () => {
    const i = input(base().filter((x) => x.type !== "estimate" || x.title === "Cash"));
    expect(projectionInputs(i, "base").annualReturn).toEqual({
      value: 0,
      origin: { kind: "none" },
    });
  });
});

describe("transactions", () => {
  const rows = () =>
    buildFinanceModel(
      input([
        txn("Salary", { date: "2026-09-01", amount: 4000, currency: "EUR", kind: "income" }),
        txn("Food", {
          date: "2026-09-05",
          amount: 300,
          currency: "EUR",
          kind: "expense",
          subcategory: "Food",
        }),
        txn("Rent", {
          date: "2026-08-03",
          amount: 1000,
          currency: "EUR",
          kind: "expense",
          subcategory: "Housing",
        }),
        txn("To savings", { date: "2026-09-10", amount: 800, currency: "EUR", kind: "transfer" }),
        txn("Old", {
          date: "2024-01-10",
          amount: 50,
          currency: "EUR",
          kind: "expense",
          subcategory: "Food",
        }),
      ]),
    ).transactions;

  it("sums income and spending per month, leaving transfers out", () => {
    const { flows, counted } = monthlyFlows(rows(), "2026-09-21", 3);
    expect(flows.map((f) => f.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(flows[2]).toEqual({ month: "2026-09", income: 4000, expense: 300, net: 3700 });
    expect(flows[1]?.expense).toBe(1000);
    expect(counted).toBe(3);
  });

  it("groups spending by category within the window", () => {
    expect(spendingByCategory(rows(), "2026-09-21", 12)).toEqual([
      { category: "Housing", amount: 1000, count: 1 },
      { category: "Food", amount: 300, count: 1 },
    ]);
  });

  it("requires a positive amount, a currency and a date", () => {
    expect(() =>
      createObjectSchema.parse({
        type: "transaction",
        title: "x",
        details: { amount: 0, currency: "EUR", date: "2026-01-01" },
      }),
    ).toThrow();
    expect(() =>
      createObjectSchema.parse({
        type: "transaction",
        title: "x",
        details: { amount: 5, date: "2026-01-01" },
      }),
    ).toThrow();
  });
});

describe("goals and investments", () => {
  it("measures a target against actual values of the same kind", () => {
    const model = buildFinanceModel(
      input([
        value("Cash", { amount: 5000, currency: "EUR", category: "cash", dataKind: "actual" }),
        value("Savings", { amount: 5000, currency: "EUR", category: "cash", dataKind: "actual" }),
        value("Cash goal", {
          amount: 20000,
          currency: "EUR",
          category: "cash",
          dataKind: "target",
        }),
      ]),
    );
    expect(model.goals[0]).toMatchObject({ current: 10000, ratio: 0.5 });
  });

  it("derives an investment's return from its value and invested capital", () => {
    const model = buildFinanceModel(
      input([
        value("ETF", {
          amount: 12000,
          currency: "EUR",
          category: "investment",
          dataKind: "actual",
          costBasis: 10000,
        }),
      ]),
    );
    expect(model.investments[0]).toMatchObject({ returnAmount: 2000, returnPct: 0.2 });
  });
});
