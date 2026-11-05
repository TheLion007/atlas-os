import type { ApiEdge, ApiObject, FxRate } from "./api-types";
import type { ChipRef } from "./command-center";
import { estimateApplies } from "./command-center";
import type {
  DataKind,
  EstimateCategory,
  EstimateUnit,
  ScenarioVariant,
  TransactionKind,
} from "./enums";
import { convertAmount } from "./money";

/**
 * Finance, derived. Every financial fact in Atlas is one object — an Estimate (a value: a
 * balance, a recurring flow, a goal, an assumption) or a Transaction (a dated movement) — and
 * everything on the Finance screen is computed here from those objects. Nothing derived is ever
 * stored: change a source value and every total, chart and projection follows.
 *
 * Two rules hold throughout:
 *  - **Actual is never mixed with anything else.** Totals (net worth, cash flow) read `actual`
 *    values only; targets are goals, estimates/scenario/assumption values feed projections, and
 *    each is labelled as what it is.
 *  - **No currency is assumed.** Amounts convert to the base currency with the owner's own FX
 *    rates only; what cannot be converted is reported, never guessed or silently dropped.
 */

// ── Roles ────────────────────────────────────────────────────────────────────────────────────

/** What a financial value is, derived from its category and unit (never stored). */
export type FinanceRole =
  | "cash"
  | "investment"
  | "asset"
  | "liability"
  | "income"
  | "expense"
  | "contribution"
  | "one_off"
  | "metric"
  | "other";

const BALANCE_ROLE: Partial<Record<EstimateCategory, FinanceRole>> = {
  cash: "cash",
  capital: "cash",
  investment: "investment",
  asset: "asset",
  acquisition_cost: "asset",
  liability: "liability",
};
const FLOW_ROLE: Partial<Record<EstimateCategory, FinanceRole>> = {
  income: "income",
  rental: "income",
  expense: "expense",
  property_cost: "expense",
  investment: "contribution",
  capital: "contribution",
};

const str = (d: Record<string, unknown> | undefined, k: string): string | null => {
  const v = d?.[k];
  return typeof v === "string" && v !== "" ? v : null;
};
const num = (d: Record<string, unknown> | undefined, k: string): number | null => {
  const v = d?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export function financeRole(estimate: Pick<ApiObject, "details">): FinanceRole {
  const d = estimate.details;
  const unit = (str(d, "unit") ?? "currency") as EstimateUnit;
  const category = (str(d, "category") ?? "other") as EstimateCategory;
  if (unit === "percent" || unit === "area_m2" || unit === "count") return "metric";
  if (unit === "currency") {
    const role = BALANCE_ROLE[category];
    if (role) return role;
    return category === "projection" || category === "other" ? "other" : "one_off";
  }
  return FLOW_ROLE[category] ?? "other";
}

/** A monthly or yearly flow expressed per month; `null` for anything that is not a flow. */
export function monthlyAmount(amount: number, unit: EstimateUnit): number | null {
  if (unit === "currency_per_month") return amount;
  if (unit === "currency_per_year") return amount / 12;
  return null;
}

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────

export interface FinanceValue {
  id: string;
  title: string;
  role: FinanceRole;
  dataKind: DataKind;
  category: EstimateCategory;
  subcategory: string | null;
  unit: EstimateUnit;
  amount: number;
  currency: string | null;
  /** The amount converted to the base currency, or `null` when there is no rate (or no base). */
  base: number | null;
  /** For flows: the per-month amount in the base currency. */
  baseMonthly: number | null;
  asOf: string | null;
  source: string;
  scenarioId: string | null;
  confidence: number | null;
  /** Investments: invested capital, and the derived return (value − invested). */
  costBasis: number | null;
  returnAmount: number | null;
  returnPct: number | null;
  ticker: string | null;
  quantity: number | null;
  /** Projects/properties/objects this value is about (via `estimates`). */
  about: ChipRef[];
  /** Documents that back it (via `references`, either way). */
  documents: ChipRef[];
}

export interface TransactionRow {
  id: string;
  title: string;
  date: string;
  kind: TransactionKind;
  amount: number;
  currency: string;
  base: number | null;
  subcategory: string | null;
  description: string;
  source: string;
  /** The account (a cash/investment value) it moved through, if linked. */
  account: ChipRef | null;
  /** Everything else it is linked to (a project, a property, a document…). */
  related: ChipRef[];
}

export interface FinanceInput {
  nodes: readonly ApiObject[];
  edges: readonly ApiEdge[];
  baseCurrency: string | null;
  fxRates: readonly FxRate[];
  scenario: ScenarioVariant;
  today: string;
}

const chip = (n: ApiObject): ChipRef => ({ id: n.id, type: n.type, title: n.title });

const live = (n: ApiObject) => n.status !== "dropped" && n.status !== "draft";

function toBase(amount: number, currency: string | null, input: FinanceInput): number | null {
  if (!input.baseCurrency || !currency) return null;
  return convertAmount(amount, currency, input.baseCurrency, input.fxRates);
}

export function buildFinanceValues(input: FinanceInput): FinanceValue[] {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const aboutOf = new Map<string, ChipRef[]>();
  const docsOf = new Map<string, ChipRef[]>();
  const push = (m: Map<string, ChipRef[]>, k: string, v: ChipRef) => {
    const list = m.get(k) ?? [];
    if (!list.some((c) => c.id === v.id)) list.push(v);
    m.set(k, list);
  };
  for (const e of input.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    if (e.kind === "estimates" && from.type === "estimate") push(aboutOf, from.id, chip(to));
    if (e.kind === "references") {
      if (from.type === "estimate" && to.type === "document") push(docsOf, from.id, chip(to));
      if (to.type === "estimate" && from.type === "document") push(docsOf, to.id, chip(from));
    }
  }

  const values: FinanceValue[] = [];
  for (const n of input.nodes) {
    if (n.type !== "estimate") continue;
    const d = n.details;
    const amount = num(d, "amount");
    if (amount === null) continue;
    const unit = (str(d, "unit") ?? "currency") as EstimateUnit;
    const currency = str(d, "currency");
    const base = toBase(amount, currency, input);
    const monthly = monthlyAmount(amount, unit);
    const costBasis = num(d, "costBasis");
    const returnAmount = costBasis !== null ? amount - costBasis : null;
    values.push({
      id: n.id,
      title: n.title,
      role: financeRole(n),
      dataKind: (str(d, "dataKind") ?? "estimate") as DataKind,
      category: (str(d, "category") ?? "other") as EstimateCategory,
      subcategory: str(d, "subcategory"),
      unit,
      amount,
      currency,
      base,
      baseMonthly: monthly !== null ? toBase(monthly, currency, input) : null,
      asOf: str(d, "asOf"),
      source: str(d, "source") ?? "",
      scenarioId: str(d, "scenarioId"),
      confidence: n.confidence,
      costBasis,
      returnAmount,
      returnPct: costBasis !== null && costBasis !== 0 ? (amount - costBasis) / costBasis : null,
      ticker: str(d, "ticker"),
      quantity: num(d, "quantity"),
      about: aboutOf.get(n.id) ?? [],
      documents: docsOf.get(n.id) ?? [],
    });
  }
  return values;
}

export function buildTransactionRows(input: FinanceInput): TransactionRow[] {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const links = new Map<string, { account: ChipRef | null; related: ChipRef[] }>();
  for (const n of input.nodes)
    if (n.type === "transaction") links.set(n.id, { account: null, related: [] });
  for (const e of input.edges) {
    const pairs: [string, string][] = [
      [e.from, e.to],
      [e.to, e.from],
    ];
    for (const [self, otherId] of pairs) {
      const entry = links.get(self);
      const other = byId.get(otherId);
      if (!entry || !other) continue;
      const role = other.type === "estimate" ? financeRole(other) : null;
      if (
        e.label === "account" &&
        !entry.account &&
        (role === "cash" || role === "investment" || role === "liability")
      )
        entry.account = chip(other);
      else if (!entry.related.some((c) => c.id === other.id)) entry.related.push(chip(other));
    }
  }
  const rows: TransactionRow[] = [];
  for (const n of input.nodes) {
    if (n.type !== "transaction" || n.status === "dropped") continue;
    const d = n.details;
    const amount = num(d, "amount");
    const currency = str(d, "currency");
    const date = str(d, "date");
    if (amount === null || !currency || !date) continue;
    const link = links.get(n.id) ?? { account: null, related: [] };
    rows.push({
      id: n.id,
      title: n.title,
      date,
      kind: (str(d, "kind") ?? "expense") as TransactionKind,
      amount,
      currency,
      base: toBase(amount, currency, input),
      subcategory: str(d, "subcategory"),
      description: str(d, "description") ?? "",
      source: str(d, "source") ?? "",
      account: link.account,
      related: link.related.filter((c) => c.id !== link.account?.id),
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

// ── Summary ──────────────────────────────────────────────────────────────────────────────────

/** A derived total: `null` when nothing feeds it, so "no data" never reads as zero. */
export interface Total {
  value: number | null;
  /** How many objects it was computed from. */
  count: number;
  /** Items that could not be converted to the base currency (excluded, and listed). */
  unconverted: ChipRef[];
}

export interface FinanceSummary {
  baseCurrency: string | null;
  cash: Total;
  investments: Total;
  otherAssets: Total;
  assets: Total;
  liabilities: Total;
  netWorth: Total;
  monthlyIncome: Total;
  monthlyExpenses: Total;
  monthlyCashFlow: Total;
  /** Values that exist but are not actual (targets, estimates, assumptions): shown, never summed. */
  notActual: number;
}

function total(values: readonly FinanceValue[], pick: (v: FinanceValue) => number | null): Total {
  let value = 0;
  const unconverted: ChipRef[] = [];
  for (const v of values) {
    const x = pick(v);
    if (x === null) unconverted.push({ id: v.id, type: "estimate", title: v.title });
    else value += x;
  }
  // `count` is what the value was actually computed from; the rest is listed as unconverted.
  const count = values.length - unconverted.length;
  return { value: values.length > 0 ? value : null, count, unconverted };
}

const combine = (a: Total, b: Total, sign: 1 | -1 = 1): Total => ({
  value: a.value === null && b.value === null ? null : (a.value ?? 0) + sign * (b.value ?? 0),
  count: a.count + b.count,
  unconverted: [...a.unconverted, ...b.unconverted],
});

/** Values that count toward today's totals: actual, live, and in the active scenario's world. */
export function actualValues(
  values: readonly FinanceValue[],
  nodes: readonly ApiObject[],
  scenario: ScenarioVariant,
): FinanceValue[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const variants = scenarioVariants(nodes);
  return values.filter((v) => {
    const n = byId.get(v.id);
    return !!n && live(n) && v.dataKind === "actual" && estimateApplies(n, scenario, variants);
  });
}

export function scenarioVariants(nodes: readonly ApiObject[]): Map<string, ScenarioVariant> {
  const out = new Map<string, ScenarioVariant>();
  for (const n of nodes)
    if (n.type === "scenario") {
      const v = str(n.details, "variant");
      if (v) out.set(n.id, v as ScenarioVariant);
    }
  return out;
}

export function summariseFinance(input: FinanceInput, values = buildFinanceValues(input)) {
  const actual = actualValues(values, input.nodes, input.scenario);
  const of = (role: FinanceRole) => actual.filter((v) => v.role === role);
  const cash = total(of("cash"), (v) => v.base);
  const investments = total(of("investment"), (v) => v.base);
  const otherAssets = total(of("asset"), (v) => v.base);
  const assets = combine(combine(cash, investments), otherAssets);
  const liabilities = total(of("liability"), (v) => (v.base === null ? null : Math.abs(v.base)));
  const monthlyIncome = total(of("income"), (v) => v.baseMonthly);
  const monthlyExpenses = total(of("expense"), (v) =>
    v.baseMonthly === null ? null : Math.abs(v.baseMonthly),
  );
  const summary: FinanceSummary = {
    baseCurrency: input.baseCurrency,
    cash,
    investments,
    otherAssets,
    assets,
    liabilities,
    netWorth: combine(assets, liabilities, -1),
    monthlyIncome,
    monthlyExpenses,
    monthlyCashFlow: combine(monthlyIncome, monthlyExpenses, -1),
    notActual: values.filter((v) => v.dataKind !== "actual").length,
  };
  return summary;
}

// ── Goals ────────────────────────────────────────────────────────────────────────────────────

export interface GoalProgress {
  goal: FinanceValue;
  /** The actual total of the same role/category, in the base currency. */
  current: number | null;
  /** current / target, 0..∞; `null` when either side is unknown. */
  ratio: number | null;
  /** Values of the same kind left out of `current` for want of an exchange rate. */
  unconverted: number;
}

/** Targets, each measured against the actual values of the same kind (e.g. cash vs cash goal). */
export function goalProgress(
  values: readonly FinanceValue[],
  actual: readonly FinanceValue[],
): GoalProgress[] {
  return values
    .filter((v) => v.dataKind === "target")
    .map((goal) => {
      const same = actual.filter((a) => a.role === goal.role && a.unit === goal.unit);
      const t = total(same, (a) => (a.unit === "currency" ? a.base : a.baseMonthly));
      const target = goal.unit === "currency" ? goal.base : goal.baseMonthly;
      const current = t.count > 0 ? t.value : null;
      return {
        goal,
        current,
        ratio: current !== null && target !== null && target > 0 ? current / target : null,
        unconverted: t.unconverted.length,
      };
    });
}

// ── Transactions over time ───────────────────────────────────────────────────────────────────

export interface MonthFlow {
  /** "YYYY-MM" */
  month: string;
  income: number;
  expense: number;
  net: number;
}

/** Months ending with `today`'s month, oldest first. */
export function monthKeys(today: string, count: number): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Income vs expenses per month from transactions (base currency). Transfers, investments and
 * withdrawals move money between places you own: they are not income or spending.
 */
export function monthlyFlows(rows: readonly TransactionRow[], today: string, months = 12) {
  const keys = monthKeys(today, months);
  const map = new Map(keys.map((k) => [k, { month: k, income: 0, expense: 0, net: 0 }]));
  const unconverted: ChipRef[] = [];
  let counted = 0;
  for (const r of rows) {
    const bucket = map.get(r.date.slice(0, 7));
    if (!bucket || (r.kind !== "income" && r.kind !== "expense")) continue;
    if (r.base === null) {
      unconverted.push({ id: r.id, type: "transaction", title: r.title });
      continue;
    }
    counted++;
    if (r.kind === "income") bucket.income += r.base;
    else bucket.expense += r.base;
  }
  const flows: MonthFlow[] = [...map.values()].map((b) => ({ ...b, net: b.income - b.expense }));
  return { flows, counted, unconverted };
}

export interface CategoryTotal {
  category: string | null;
  amount: number;
  count: number;
}

/** Spending by (sub)category over the last `months` months, largest first. */
export function spendingByCategory(
  rows: readonly TransactionRow[],
  today: string,
  months = 12,
): CategoryTotal[] {
  const from = monthKeys(today, months)[0] as string;
  const map = new Map<string | null, CategoryTotal>();
  for (const r of rows) {
    if (r.kind !== "expense" || r.base === null || r.date.slice(0, 7) < from || r.date > today)
      continue;
    const key = r.subcategory;
    const t = map.get(key) ?? { category: key, amount: 0, count: 0 };
    t.amount += r.base;
    t.count++;
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

// ── Allocation ───────────────────────────────────────────────────────────────────────────────

export interface AllocationSlice {
  key: string;
  /** The role ("cash", "investment", "asset") or, within one, the user's subcategory. */
  role: FinanceRole;
  label: string | null;
  amount: number;
}

/** Actual assets by role, then subcategory, in the base currency, largest first. */
export function assetAllocation(actual: readonly FinanceValue[]): AllocationSlice[] {
  const map = new Map<string, AllocationSlice>();
  for (const v of actual) {
    if (v.role !== "cash" && v.role !== "investment" && v.role !== "asset") continue;
    if (v.base === null || v.base <= 0) continue;
    const key = `${v.role}:${v.subcategory ?? ""}`;
    const s = map.get(key) ?? { key, role: v.role, label: v.subcategory, amount: 0 };
    s.amount += v.base;
    map.set(key, s);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

// ── Projection ───────────────────────────────────────────────────────────────────────────────

/** Where a projection input came from — shown next to it, always. */
export type AssumptionOrigin =
  | { kind: "value"; ref: ChipRef; dataKind: DataKind }
  | { kind: "derived"; from: "actual_cash_flow" | "actual_liquid" }
  | { kind: "none" };

export interface ProjectionAssumption<T = number> {
  value: T;
  origin: AssumptionOrigin;
}

export interface ProjectionInputs {
  scenario: ScenarioVariant;
  start: ProjectionAssumption;
  monthlyContribution: ProjectionAssumption;
  /** Annual return, as a fraction (0.07 = 7 %). */
  annualReturn: ProjectionAssumption;
}

export interface ProjectionPoint {
  /** Months from now. */
  month: number;
  /** "YYYY-MM" */
  label: string;
  value: number;
  contributed: number;
}

/**
 * Compound projection: every month the balance earns (1 + r)^(1/12) − 1 and receives the
 * contribution. Deterministic and pure — it is a scenario, never a forecast of certainty.
 */
export function projectBalance(
  start: number,
  monthlyContribution: number,
  annualReturn: number,
  months: number,
  today: string,
): ProjectionPoint[] {
  const rate = Math.pow(1 + annualReturn, 1 / 12) - 1;
  const labels = monthKeys(addMonths(today, months), months + 1);
  const out: ProjectionPoint[] = [
    { month: 0, label: labels[0] as string, value: start, contributed: start },
  ];
  let value = start;
  let contributed = start;
  for (let m = 1; m <= months; m++) {
    value = value * (1 + rate) + monthlyContribution;
    contributed += monthlyContribution;
    out.push({ month: m, label: labels[m] as string, value, contributed });
  }
  return out;
}

function addMonths(today: string, months: number): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * The inputs a scenario's projection runs on, each traced to where it came from:
 *  - start: today's actual liquid money (cash + investments);
 *  - monthly contribution: the scenario's assumption for money added to capital/investments
 *    (a monthly `capital`/`investment` value that is an assumption or scenario value), else
 *    the actual monthly cash flow if positive (labelled as derived), else nothing;
 *  - annual return: the scenario's `percent` assumption on investment/projection, else 0 %
 *    (labelled as "no return assumption" — never a made-up market return).
 * A value tied to a scenario wins over a scenario-less one.
 */
export function projectionInputs(
  input: FinanceInput,
  scenario: ScenarioVariant,
  values = buildFinanceValues(input),
): ProjectionInputs {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const variants = scenarioVariants(input.nodes);
  const applies = (v: FinanceValue) => {
    const n = byId.get(v.id);
    return !!n && live(n) && estimateApplies(n, scenario, variants);
  };
  const projecting = (v: FinanceValue) =>
    (v.dataKind === "assumption" || v.dataKind === "scenario") && applies(v);
  // Scenario-specific first, then generic; ties by title for stability.
  const rank = (a: FinanceValue, b: FinanceValue) =>
    Number(b.scenarioId !== null) - Number(a.scenarioId !== null) || a.title.localeCompare(b.title);
  const ref = (v: FinanceValue): AssumptionOrigin => ({
    kind: "value",
    ref: { id: v.id, type: "estimate", title: v.title },
    dataKind: v.dataKind,
  });

  const summary = summariseFinance({ ...input, scenario }, values);
  const liquid = combine(summary.cash, summary.investments);
  const start: ProjectionAssumption =
    liquid.value !== null
      ? { value: liquid.value, origin: { kind: "derived", from: "actual_liquid" } }
      : { value: 0, origin: { kind: "none" } };

  const contribution = values
    .filter((v) => v.role === "contribution" && v.baseMonthly !== null && projecting(v))
    .sort(rank)[0];
  const cashFlow = summary.monthlyCashFlow.value;
  const monthlyContribution: ProjectionAssumption = contribution
    ? { value: contribution.baseMonthly as number, origin: ref(contribution) }
    : cashFlow !== null && cashFlow > 0
      ? { value: cashFlow, origin: { kind: "derived", from: "actual_cash_flow" } }
      : { value: 0, origin: { kind: "none" } };

  const returnValue = values
    .filter(
      (v) =>
        v.unit === "percent" &&
        (v.category === "investment" || v.category === "projection") &&
        projecting(v),
    )
    .sort(rank)[0];
  const annualReturn: ProjectionAssumption = returnValue
    ? { value: returnValue.amount / 100, origin: ref(returnValue) }
    : { value: 0, origin: { kind: "none" } };

  return { scenario, start, monthlyContribution, annualReturn };
}

// ── Everything the Finance screen reads ──────────────────────────────────────────────────────

export interface FinanceModel {
  values: FinanceValue[];
  actual: FinanceValue[];
  transactions: TransactionRow[];
  summary: FinanceSummary;
  goals: GoalProgress[];
  allocation: AllocationSlice[];
  investments: FinanceValue[];
  /** Values that are not actual: targets, estimates, scenario values and assumptions. */
  planning: FinanceValue[];
  isEmpty: boolean;
}

export function buildFinanceModel(input: FinanceInput): FinanceModel {
  const values = buildFinanceValues(input);
  const actual = actualValues(values, input.nodes, input.scenario);
  const transactions = buildTransactionRows(input);
  return {
    values,
    actual,
    transactions,
    summary: summariseFinance(input, values),
    goals: goalProgress(values, actual),
    allocation: assetAllocation(actual),
    investments: actual.filter((v) => v.role === "investment"),
    planning: values.filter((v) => v.dataKind !== "actual"),
    isEmpty: values.length === 0 && transactions.length === 0,
  };
}
