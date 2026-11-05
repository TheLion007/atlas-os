"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { describeError, useFinance, useSettings } from "@/client/hooks";
import type { ChipRef } from "@/domain/command-center";
import {
  SCENARIO_VARIANTS,
  TRANSACTION_KINDS,
  type ScenarioVariant,
  type TransactionKind,
} from "@/domain/enums";
import {
  assetAllocation,
  monthKeys,
  monthlyFlows,
  projectBalance,
  projectionInputs,
  scenarioVariants,
  spendingByCategory,
  type AssumptionOrigin,
  type FinanceModel,
  type FinanceValue,
  type Total,
  type TransactionRow,
} from "@/domain/finance";
import { hasKey } from "@/i18n";
import { useI18n } from "@/i18n/I18nProvider";
import { usePeek, useScenario } from "@/lib/url-state";
import { cn } from "@/lib/cn";
import {
  ActionMenu,
  DataKindBadge,
  Notice,
  Segmented,
  secondaryButton,
  selectClass,
  type MenuItem,
} from "../finance/bits";
import {
  ChartFrame,
  GroupedBars,
  HBars,
  Legend,
  LineChart,
  PairedBars,
  SERIES,
  StackBar,
} from "../finance/charts";
import { CHART_COLORS } from "@/design/tokens";
import { hrefKeepingState } from "../shell/nav";
import { useUi, type CreateRequest } from "../shell/ui-store";
import { Icon } from "../ui/Icon";
import { MetricTile } from "../ui/MetricTile";
import { ProgressRail } from "../ui/ProgressRail";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";

type View = "overview" | "balance" | "flows" | "transactions" | "planning";

/**
 * Finance: where Atlas understands money — what you have, what you owe, what comes in and goes
 * out, and where it could lead. Everything shown is derived by `domain/finance.ts` from the one
 * object that holds each fact (an Estimate or a Transaction); nothing is stored twice. Actual
 * figures are totalled; targets, estimates, scenario values and assumptions are shown as what
 * they are and never summed with them.
 */
export function FinanceLens() {
  const { t, f } = useI18n();
  const params = useSearchParams();
  const [, setPeek] = usePeek();
  const openCreate = useUi((s) => s.openCreate);
  const [view, setView] = useState<View>("overview");
  const committed = useSettings();
  const [scenario] = useScenario(committed.data?.activeScenario ?? "base");
  const finance = useFinance(scenario);
  const { model, settings, today } = finance;
  const base = settings?.baseCurrency ?? null;

  const money = (n: number | null, currency = base) =>
    n === null || currency === null ? "—" : f.money(n, currency);
  const compact = (n: number) => (base ? f.money(n, base, { compact: true }) : f.number(n));

  const create = (request: CreateRequest) =>
    openCreate({
      ...request,
      preset: { ...(base ? { currency: base } : {}), ...request.preset },
    });
  const addItems: MenuItem[] = [
    preset("account", { category: "cash", dataKind: "actual" }),
    preset("asset", { category: "asset", dataKind: "actual" }),
    preset("investment", { category: "investment", dataKind: "actual" }),
    preset("liability", { category: "liability", dataKind: "actual" }),
    preset("income", { category: "income", dataKind: "actual", unit: "currency_per_month" }),
    preset("expense", { category: "expense", dataKind: "actual", unit: "currency_per_month" }),
    preset("goal", { dataKind: "target", category: "cash" }),
    preset("assumption", {
      dataKind: "assumption",
      category: "investment",
      unit: "percent",
      currency: "",
    }),
    {
      key: "transaction",
      label: t("create.new.transaction"),
      hint: t("create.hint.transaction"),
      onSelect: () => create({ type: "transaction", preset: today ? { date: today } : undefined }),
    },
  ];
  function preset(key: string, values: Record<string, string>): MenuItem {
    return {
      key,
      label: t(`create.new.${key}` as never),
      hint: t(`finance.add.${key}Hint` as never),
      onSelect: () =>
        create({
          type: "estimate",
          preset: values,
          titleKey: `create.new.${key}` as CreateRequest["titleKey"],
        }),
    };
  }

  if (finance.state === "loading" || !model)
    return finance.state === "error" ? (
      <ErrorState {...describeError(finance.error, t)} onRetry={() => finance.refetch()} />
    ) : (
      <LoadingState label={t("finance.title")} lines={6} />
    );

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[34px] leading-none font-extrabold tracking-[-0.03em]">
          {t("finance.title")}
        </h2>
        <p className="text-xs text-fg-muted">
          {base ? t("finance.subtitle", { currency: base }) : t("finance.subtitleNoBase")}
        </p>
      </div>
      <ActionMenu label={t("finance.add")} items={addItems} />
    </div>
  );

  if (model.isEmpty) {
    return (
      <div className="mx-auto -my-4 flex max-w-[1300px] flex-col gap-5 px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9">
        {header}
        <EmptyState
          title={t("finance.empty.title")}
          description={t("finance.empty.body")}
          action={
            <div className="flex flex-wrap gap-2">
              {addItems.slice(0, 3).map((i) => (
                <button key={i.key} type="button" onClick={i.onSelect} className={secondaryButton}>
                  <Icon name="plus" />
                  {i.label}
                </button>
              ))}
              <button
                type="button"
                onClick={addItems[addItems.length - 1]?.onSelect}
                className={secondaryButton}
              >
                <Icon name="plus" />
                {t("create.new.transaction")}
              </button>
            </div>
          }
        />
      </div>
    );
  }

  const s = model.summary;
  const unconverted = uniqueRefs([...s.netWorth.unconverted, ...s.monthlyCashFlow.unconverted]);
  const peekable = (ref: ChipRef | FinanceValue | TransactionRow) => (
    <button
      type="button"
      onClick={() => setPeek(ref.id)}
      className="max-w-full truncate text-left underline-offset-4 hover:underline"
    >
      {ref.title}
    </button>
  );

  return (
    <div className="mx-auto -my-4 flex max-w-[1300px] flex-col gap-5 px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9">
      {header}

      {!base && (
        <Notice tone="warn">
          {t("finance.noBase")}{" "}
          <Link href={hrefKeepingState("/settings", params)} className="text-fg underline">
            {t("finance.openSettings")}
          </Link>
        </Notice>
      )}

      <section aria-labelledby="finance-summary" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="finance-summary" className="label">
            {t("finance.summary")}
          </h3>
          <DataKindBadge kind="actual" />
          <span className="text-xs text-fg-muted">{t("finance.summaryNote")}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          <Tile
            label={t("finance.netWorth")}
            total={s.netWorth}
            money={money}
            note={t("finance.netWorthNote")}
          />
          <Tile label={t("finance.cash")} total={s.cash} money={money} />
          <Tile label={t("finance.assets")} total={s.assets} money={money} />
          <Tile label={t("finance.liabilities")} total={s.liabilities} money={money} />
          <Tile label={t("finance.monthlyIncome")} total={s.monthlyIncome} money={money} />
          <Tile label={t("finance.monthlyExpenses")} total={s.monthlyExpenses} money={money} />
          <Tile
            label={t("finance.monthlyCashFlow")}
            total={s.monthlyCashFlow}
            money={money}
            note={t("finance.cashFlowNote")}
          />
          <Tile label={t("finance.investments")} total={s.investments} money={money} />
        </div>
        {unconverted.length > 0 && (
          <Notice tone="warn">
            {t("finance.unconverted", { count: unconverted.length })}{" "}
            {unconverted.map((u, i) => (
              <span key={u.id}>
                {i > 0 && ", "}
                {peekable(u)}
              </span>
            ))}
          </Notice>
        )}
        {s.notActual > 0 && (
          <p className="text-xs text-fg-muted">{t("finance.notActual", { count: s.notActual })}</p>
        )}
      </section>

      <Segmented
        value={view}
        onChange={setView}
        label={t("finance.views")}
        options={[
          { value: "overview", label: t("finance.view.overview") },
          { value: "balance", label: t("finance.view.balance") },
          { value: "flows", label: t("finance.view.flows") },
          { value: "transactions", label: t("finance.view.transactions") },
          { value: "planning", label: t("finance.view.planning") },
        ]}
      />

      {view === "overview" && (
        <Overview model={model} today={today ?? ""} base={base} money={money} compact={compact} />
      )}
      {view === "balance" && (
        <BalanceSheet model={model} base={base} money={money} peekable={peekable} />
      )}
      {view === "flows" && <Flows model={model} base={base} money={money} peekable={peekable} />}
      {view === "transactions" && (
        <Transactions
          rows={model.transactions}
          today={today ?? ""}
          base={base}
          money={money}
          peekable={peekable}
          onAdd={() => create({ type: "transaction", preset: today ? { date: today } : undefined })}
        />
      )}
      {view === "planning" && (
        <Planning
          finance={finance}
          scenario={scenario}
          base={base}
          money={money}
          compact={compact}
          peekable={peekable}
        />
      )}
    </div>
  );
}

function uniqueRefs(refs: readonly ChipRef[]): ChipRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

function Tile({
  label,
  total,
  money,
  note,
}: {
  label: string;
  total: Total;
  money: (n: number | null) => string;
  note?: string;
}) {
  const { t } = useI18n();
  if (total.value === null)
    return <MetricTile label={label} state="no-data" noDataNote={t("finance.tileEmpty")} />;
  return (
    <div className="flex flex-col">
      <MetricTile label={label} value={money(total.value)} />
      <p className="mt-1 px-1 text-xs text-fg-muted">
        {t("finance.fromCount", { count: total.count })}
        {note && ` · ${note}`}
      </p>
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────

function Overview({
  model,
  today,
  base,
  money,
  compact,
}: {
  model: FinanceModel;
  today: string;
  base: string | null;
  money: Money;
  compact: (n: number) => string;
}) {
  const { t, f } = useI18n();
  const flows = useMemo(() => monthlyFlows(model.transactions, today, 12), [model, today]);
  const spending = useMemo(() => spendingByCategory(model.transactions, today, 12), [model, today]);
  const allocation = useMemo(() => assetAllocation(model.actual), [model]);
  const monthLabel = (k: string) => f.monthShort(k);
  const monthLong = (k: string) => f.monthYear(k);
  const hasFlows = flows.counted > 0;
  // Allocation: by role, each slice labelled by its sub-category when there is one. More than
  // four slices fold the smallest into "Other", so no colour is ever generated.
  const slices = useMemo(() => {
    const byRole = new Map<string, { key: string; label: string; value: number; color: string }>();
    for (const a of allocation) {
      const k = a.role;
      const cur = byRole.get(k) ?? {
        key: k,
        label: t(`finance.role.${a.role}` as never),
        value: 0,
        color: ROLE_COLOR[a.role] ?? CHART_COLORS.reference,
      };
      cur.value += a.amount;
      byRole.set(k, cur);
    }
    return [...byRole.values()].sort((a, b) => b.value - a.value);
  }, [allocation, t]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartFrame
        className="lg:col-span-2"
        title={t("finance.chart.flows")}
        note={t("finance.chart.flowsNote")}
        legend={
          hasFlows && (
            <Legend
              items={[
                { label: t("transactionKind.income"), color: SERIES[0] },
                { label: t("transactionKind.expense"), color: SERIES[1] },
              ]}
            />
          )
        }
        table={{
          head: [
            t("finance.col.month"),
            t("transactionKind.income"),
            t("transactionKind.expense"),
            t("finance.col.net"),
          ],
          rows: flows.flows.map((m) => [
            monthLong(m.month),
            money(m.income),
            money(m.expense),
            money(m.net),
          ]),
        }}
      >
        {hasFlows && base ? (
          <GroupedBars
            ariaLabel={t("finance.chart.flows")}
            categories={flows.flows.map((m) => ({
              key: m.month,
              label: monthLabel(m.month),
              long: monthLong(m.month),
            }))}
            series={[
              {
                key: "income",
                label: t("transactionKind.income"),
                color: SERIES[0],
                values: flows.flows.map((m) => m.income),
              },
              {
                key: "expense",
                label: t("transactionKind.expense"),
                color: SERIES[1],
                values: flows.flows.map((m) => m.expense),
              },
            ]}
            format={(n) => money(n)}
            formatAxis={compact}
            footer={(i) => (
              <p className="flex justify-between gap-4 border-t border-border pt-1">
                <span className="text-fg-muted">{t("finance.col.net")}</span>
                <span className="num">{money(flows.flows[i]?.net ?? 0)}</span>
              </p>
            )}
          />
        ) : (
          <NotEnough text={t("finance.chart.flowsEmpty")} />
        )}
      </ChartFrame>

      <ChartFrame
        title={t("finance.chart.allocation")}
        note={t("finance.chart.allocationNote")}
        table={{
          head: [t("finance.col.kind"), t("finance.col.value")],
          rows: slices.map((sl) => [sl.label, money(sl.value)]),
        }}
      >
        {slices.length > 0 ? (
          <StackBar slices={slices} format={(n) => money(n)} />
        ) : (
          <NotEnough text={t("finance.chart.allocationEmpty")} />
        )}
      </ChartFrame>

      <ChartFrame
        title={t("finance.chart.spending")}
        note={t("finance.chart.spendingNote")}
        table={{
          head: [t("finance.col.category"), t("finance.col.amount")],
          rows: spending.map((c) => [c.category ?? t("finance.uncategorised"), money(c.amount)]),
        }}
      >
        {spending.length > 0 ? (
          <HBars
            color={SERIES[1]}
            format={(n) => money(n)}
            rows={spending.slice(0, 8).map((c) => ({
              key: c.category ?? "~",
              label: c.category ?? t("finance.uncategorised"),
              value: c.amount,
            }))}
          />
        ) : (
          <NotEnough text={t("finance.chart.spendingEmpty")} />
        )}
      </ChartFrame>

      <ChartFrame
        title={t("finance.chart.investments")}
        note={t("finance.chart.investmentsNote")}
        legend={
          model.investments.length > 0 && (
            <Legend
              items={[
                { label: t("finance.invested"), color: CHART_COLORS.reference },
                { label: t("finance.currentValue"), color: SERIES[0] },
              ]}
            />
          )
        }
        table={{
          head: [
            t("finance.col.name"),
            t("finance.invested"),
            t("finance.currentValue"),
            t("finance.return"),
          ],
          rows: model.investments.map((v) => [
            v.title,
            v.costBasis !== null ? money(v.costBasis, v.currency) : "—",
            money(v.amount, v.currency),
            v.returnAmount !== null
              ? `${money(v.returnAmount, v.currency)} (${f.percent(v.returnPct)})`
              : "—",
          ]),
        }}
      >
        {model.investments.length > 0 ? (
          <PairedBars
            referenceLabel={t("finance.invested")}
            valueLabel={t("finance.currentValue")}
            format={(n) => money(n)}
            rows={model.investments
              .filter((v) => v.base !== null)
              .map((v) => {
                const rate = v.base !== null && v.amount !== 0 ? v.base / v.amount : 1;
                return {
                  key: v.id,
                  label: v.ticker ? `${v.title} · ${v.ticker}` : v.title,
                  value: v.base as number,
                  reference: v.costBasis !== null ? v.costBasis * rate : null,
                  note:
                    v.returnPct !== null
                      ? `${v.returnPct >= 0 ? "+" : ""}${f.percent(v.returnPct)}`
                      : undefined,
                };
              })}
          />
        ) : (
          <NotEnough text={t("finance.chart.investmentsEmpty")} />
        )}
      </ChartFrame>

      <ChartFrame
        title={t("finance.chart.netWorth")}
        table={{ head: [t("finance.col.month"), t("finance.netWorth")], rows: [] }}
      >
        <NotEnough text={t("finance.chart.netWorthEmpty")} />
      </ChartFrame>
    </div>
  );
}

/** Allocation colours follow the kind of asset, never its rank (a filter never repaints). */
const ROLE_COLOR: Record<string, string> = {
  cash: SERIES[0],
  investment: SERIES[1],
  asset: SERIES[2],
};

function NotEnough({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-1 rounded-control border border-dashed border-border p-4 text-center">
      <p className="text-sm">{t("finance.notEnough")}</p>
      <p className="max-w-sm text-xs text-fg-muted">{text}</p>
    </div>
  );
}

// ── Balance sheet ────────────────────────────────────────────────────────────────────────────

type Money = (n: number | null, currency?: string | null) => string;
type Peekable = (ref: ChipRef | FinanceValue | TransactionRow) => React.ReactNode;

function ValueTable({
  rows,
  base,
  money,
  peekable,
  monthly = false,
}: {
  rows: readonly FinanceValue[];
  base: string | null;
  money: Money;
  peekable: Peekable;
  monthly?: boolean;
}) {
  const { t, f } = useI18n();
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead className="border-b border-border">
          <tr>
            {[
              t("finance.col.name"),
              t("finance.col.category"),
              t("finance.col.value"),
              base ? t("finance.col.inBase", { currency: base }) : "",
              t("finance.col.kind"),
              t("finance.col.asOf"),
              t("finance.col.source"),
            ].map((h, i) => (
              <th
                key={i}
                scope="col"
                className={cn(
                  "label px-3 py-2 font-normal",
                  i >= 2 && i <= 3 ? "text-right" : "text-left",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-b border-border last:border-b-0 hover:bg-hover">
              <td className="max-w-64 px-3 py-2">
                <div className="flex flex-col">
                  {peekable(v)}
                  {v.about.length > 0 && (
                    <span className="truncate text-xs text-fg-muted">
                      {v.about.map((a) => a.title).join(", ")}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2 text-fg-muted">
                {t(`category.${v.category}` as never)}
                {v.subcategory && ` · ${v.subcategory}`}
              </td>
              <td className="num px-3 py-2 text-right whitespace-nowrap">
                {v.unit === "percent"
                  ? `${f.number(v.amount, { digits: 2 })}%`
                  : money(v.amount, v.currency)}
                {v.unit === "currency_per_month" && t("unit.perMonth")}
                {v.unit === "currency_per_year" && t("unit.perYear")}
              </td>
              <td className="num px-3 py-2 text-right whitespace-nowrap text-fg-muted">
                {v.currency && v.currency !== base
                  ? monthly
                    ? money(v.baseMonthly)
                    : money(v.base)
                  : ""}
              </td>
              <td className="px-3 py-2">
                <DataKindBadge kind={v.dataKind} />
              </td>
              <td className="num px-3 py-2 text-fg-muted">{v.asOf ? f.date(v.asOf) : "—"}</td>
              <td className="px-3 py-2 text-fg-muted">{sourceLabel(v.source, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sourceLabel(source: string, t: ReturnType<typeof useI18n>["t"]): string {
  if (!source) return "—";
  const key = `source.${source}`;
  return hasKey(key) ? t(key) : source;
}

function Group({
  title,
  total,
  money,
  children,
}: {
  title: string;
  total?: number | null;
  money: Money;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="label">{title}</h3>
        {total !== undefined && <span className="num text-sm">{money(total ?? null)}</span>}
      </div>
      {children}
    </section>
  );
}

function BalanceSheet({
  model,
  base,
  money,
  peekable,
}: {
  model: FinanceModel;
  base: string | null;
  money: Money;
  peekable: Peekable;
}) {
  const { t } = useI18n();
  const s = model.summary;
  const of = (role: string) => model.actual.filter((v) => v.role === role);
  const groups: [string, FinanceValue[], number | null][] = [
    [t("finance.cash"), of("cash"), s.cash.value],
    [t("finance.investments"), of("investment"), s.investments.value],
    [t("finance.otherAssets"), of("asset"), s.otherAssets.value],
    [t("finance.liabilities"), of("liability"), s.liabilities.value],
  ];
  return (
    <div className="flex flex-col gap-6">
      {groups.map(([title, rows, total]) => (
        <Group key={title} title={title} total={rows.length > 0 ? total : undefined} money={money}>
          {rows.length > 0 ? (
            <ValueTable rows={rows} base={base} money={money} peekable={peekable} />
          ) : (
            <p className="text-sm text-fg-muted">{t("finance.groupEmpty")}</p>
          )}
        </Group>
      ))}
    </div>
  );
}

// ── Recurring flows ──────────────────────────────────────────────────────────────────────────

function Flows({
  model,
  base,
  money,
  peekable,
}: {
  model: FinanceModel;
  base: string | null;
  money: Money;
  peekable: Peekable;
}) {
  const { t } = useI18n();
  const s = model.summary;
  const income = model.actual.filter((v) => v.role === "income");
  const expense = model.actual.filter((v) => v.role === "expense");
  const planned = model.planning.filter(
    (v) => v.role === "income" || v.role === "expense" || v.role === "contribution",
  );
  return (
    <div className="flex flex-col gap-6">
      <Group
        title={t("finance.recurringIncome")}
        total={income.length > 0 ? s.monthlyIncome.value : undefined}
        money={money}
      >
        {income.length > 0 ? (
          <ValueTable rows={income} base={base} money={money} peekable={peekable} monthly />
        ) : (
          <p className="text-sm text-fg-muted">{t("finance.groupEmpty")}</p>
        )}
      </Group>
      <Group
        title={t("finance.recurringExpenses")}
        total={expense.length > 0 ? s.monthlyExpenses.value : undefined}
        money={money}
      >
        {expense.length > 0 ? (
          <ValueTable rows={expense} base={base} money={money} peekable={peekable} monthly />
        ) : (
          <p className="text-sm text-fg-muted">{t("finance.groupEmpty")}</p>
        )}
      </Group>
      {planned.length > 0 && (
        <Group title={t("finance.plannedFlows")} money={money}>
          <p className="text-xs text-fg-muted">{t("finance.plannedFlowsNote")}</p>
          <ValueTable rows={planned} base={base} money={money} peekable={peekable} monthly />
        </Group>
      )}
    </div>
  );
}

// ── Transactions ─────────────────────────────────────────────────────────────────────────────

const SIGN: Record<TransactionKind, 1 | -1 | 0> = {
  income: 1,
  expense: -1,
  transfer: 0,
  investment: 0,
  withdrawal: 0,
};

function Transactions({
  rows,
  today,
  base,
  money,
  peekable,
  onAdd,
}: {
  rows: readonly TransactionRow[];
  today: string;
  base: string | null;
  money: Money;
  peekable: Peekable;
  onAdd: () => void;
}) {
  const { t, f } = useI18n();
  const [kind, setKind] = useState<TransactionKind | "all">("all");
  const [period, setPeriod] = useState<"3" | "6" | "12" | "all">("6");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const from = period === "all" ? "" : `${monthKeys(today, Number(period))[0]}-01`;
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (kind === "all" || r.kind === kind) &&
        r.date >= from &&
        (q === "" ||
          [r.title, r.subcategory ?? "", r.description, r.account?.title ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q)),
    );
  }, [rows, kind, period, query, today]);
  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const r of filtered) {
      if (r.base === null) continue;
      if (r.kind === "income") income += r.base;
      if (r.kind === "expense") expense += r.base;
    }
    return { income, expense };
  }, [filtered]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 min-w-0 grow items-center gap-2 rounded-control border border-border px-3 sm:max-w-xs">
          <Icon name="search" className="shrink-0 text-fg-muted" />
          <label htmlFor="txn-search" className="sr-only">
            {t("finance.searchTransactions")}
          </label>
          <input
            id="txn-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("finance.searchTransactions")}
            className="h-full min-w-0 grow bg-transparent outline-none placeholder:text-fg-muted"
          />
        </div>
        <label className="sr-only" htmlFor="txn-kind">
          {t("form.transactionKind")}
        </label>
        <select
          id="txn-kind"
          className={selectClass}
          value={kind}
          onChange={(e) => setKind(e.target.value as TransactionKind | "all")}
        >
          <option value="all">{t("finance.allKinds")}</option>
          {TRANSACTION_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`transactionKind.${k}`)}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="txn-period">
          {t("finance.period")}
        </label>
        <select
          id="txn-period"
          className={selectClass}
          value={period}
          onChange={(e) => setPeriod(e.target.value as typeof period)}
        >
          <option value="3">{t("finance.lastMonths", { count: 3 })}</option>
          <option value="6">{t("finance.lastMonths", { count: 6 })}</option>
          <option value="12">{t("finance.lastMonths", { count: 12 })}</option>
          <option value="all">{t("finance.allTime")}</option>
        </select>
        <div className="grow" />
        <button type="button" onClick={onAdd} className={secondaryButton}>
          <Icon name="plus" />
          {t("create.new.transaction")}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">{t("finance.transactionsEmpty")}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-fg-muted" role="status">
          {t("finance.transactionsFiltered")}
        </p>
      ) : (
        <>
          <p className="num text-xs text-fg-muted">
            {t("finance.transactionTotals", {
              count: filtered.length,
              income: money(totals.income),
              expense: money(totals.expense),
            })}
          </p>
          <div className="overflow-x-auto rounded-card border border-border">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead className="border-b border-border">
                <tr>
                  {[
                    t("finance.col.date"),
                    t("finance.col.name"),
                    t("finance.col.kind"),
                    t("finance.col.category"),
                    t("finance.col.account"),
                    t("finance.col.amount"),
                  ].map((h, i) => (
                    <th
                      key={i}
                      scope="col"
                      className={cn(
                        "label px-3 py-2 font-normal",
                        i === 5 ? "text-right" : "text-left",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 300).map((r) => {
                  const sign = SIGN[r.kind];
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-border last:border-b-0 hover:bg-hover"
                    >
                      <td className="num px-3 py-2 whitespace-nowrap text-fg-muted">
                        {f.date(r.date)}
                      </td>
                      <td className="max-w-64 px-3 py-2">{peekable(r)}</td>
                      <td className="px-3 py-2 text-fg-muted">{t(`transactionKind.${r.kind}`)}</td>
                      <td className="px-3 py-2 text-fg-muted">{r.subcategory ?? "—"}</td>
                      <td className="max-w-48 truncate px-3 py-2 text-fg-muted">
                        {r.account?.title ?? "—"}
                      </td>
                      <td className="num px-3 py-2 text-right whitespace-nowrap">
                        {sign === 1 ? "+" : sign === -1 ? "−" : ""}
                        {money(r.amount, r.currency)}
                        {r.currency !== base && r.base !== null && (
                          <span className="ml-2 text-xs text-fg-muted">{money(r.base)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Planning: goals, projection, assumptions ─────────────────────────────────────────────────

function Planning({
  finance,
  scenario,
  base,
  money,
  compact,
  peekable,
}: {
  finance: ReturnType<typeof useFinance>;
  scenario: ScenarioVariant;
  base: string | null;
  money: Money;
  compact: (n: number) => string;
  peekable: Peekable;
}) {
  const { t, f } = useI18n();
  const model = finance.model as FinanceModel;
  const today = finance.today ?? "";
  const [years, setYears] = useState(10);
  const input = useMemo(
    () => ({
      nodes: finance.nodes,
      edges: finance.edges,
      baseCurrency: base,
      fxRates: finance.settings?.fxRates ?? [],
      scenario,
      today,
    }),
    [finance.nodes, finance.edges, base, finance.settings, scenario, today],
  );
  // One projection per scenario that exists (the three variants), the viewed one emphasised.
  const variants = useMemo(() => {
    const present = new Set(scenarioVariants(finance.nodes).values());
    return present.size > 0 ? SCENARIO_VARIANTS.filter((v) => present.has(v)) : [scenario];
  }, [finance.nodes, scenario]);
  const projections = useMemo(
    () =>
      variants.map((v) => {
        const inputs = projectionInputs(input, v, model.values);
        return {
          variant: v,
          inputs,
          points: projectBalance(
            inputs.start.value,
            inputs.monthlyContribution.value,
            inputs.annualReturn.value,
            years * 12,
            today,
          ),
        };
      }),
    [variants, input, model.values, years, today],
  );
  const colorOf: Record<ScenarioVariant, string> = {
    base: SERIES[0],
    conservative: SERIES[1],
    optimistic: SERIES[2],
  };
  const active = projections.find((p) => p.variant === scenario) ?? projections[0];
  const labels = active?.points.map((p) => p.label) ?? [];
  const series = [
    ...projections.map((p) => ({
      key: p.variant,
      label: t(`scenario.${p.variant}` as never),
      color: colorOf[p.variant],
      values: p.points.map((x) => x.value),
    })),
    ...(active
      ? [
          {
            key: "contributed",
            label: t("finance.contributedOnly"),
            color: CHART_COLORS.reference,
            values: active.points.map((x) => x.contributed),
            dashed: true,
          },
        ]
      : []),
  ];
  const origin = (o: AssumptionOrigin) =>
    o.kind === "value" ? (
      <span className="flex items-center gap-2">
        <DataKindBadge kind={o.dataKind} />
        {peekable(o.ref)}
      </span>
    ) : o.kind === "derived" ? (
      <span className="flex items-center gap-2">
        <DataKindBadge kind="actual" />
        <span className="text-fg-muted">{t(`finance.origin.${o.from}` as never)}</span>
      </span>
    ) : (
      <span className="text-fg-muted">{t("finance.origin.none")}</span>
    );
  const yearly = active ? active.points.filter((p) => p.month % 12 === 0) : [];
  const others = model.planning.filter((v) => v.dataKind !== "target");

  return (
    <div className="flex flex-col gap-6">
      <Group title={t("finance.goals")} money={money}>
        {model.goals.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("finance.goalsEmpty")}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {model.goals.map((g) => (
              <li
                key={g.goal.id}
                className="flex flex-col gap-2 rounded-card border border-border p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  {peekable(g.goal)}
                  <DataKindBadge kind="target" />
                </div>
                <ProgressRail
                  actual={g.ratio === null ? null : Math.min(1, g.ratio)}
                  label={g.goal.title}
                />
                <p className="num text-xs text-fg-muted">
                  {t("finance.goalProgress", {
                    current: money(g.current),
                    target: money(g.goal.base),
                    percent: g.ratio === null ? "—" : f.percent(g.ratio),
                  })}
                  {g.unconverted > 0 &&
                    ` · ${t("finance.goalUnconverted", { count: g.unconverted })}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="label">{t("finance.projection")}</h3>
            <DataKindBadge kind="scenario" />
          </div>
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            {t("finance.horizon")}
            <select
              className={selectClass}
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
            >
              {[5, 10, 20, 30].map((y) => (
                <option key={y} value={y}>
                  {t("finance.years", { count: y })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Notice>{t("finance.projectionDisclaimer")}</Notice>
        {!base ? (
          <NotEnough text={t("finance.noBase")} />
        ) : (
          <ChartFrame
            title={t("finance.chart.projection", { years })}
            legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />}
            table={{
              head: [t("finance.col.year"), ...series.map((s) => s.label)],
              rows: yearly.map((p) => [
                p.label.slice(0, 4),
                ...series.map((s) => money(s.values[p.month] ?? 0)),
              ]),
            }}
          >
            <LineChart
              ariaLabel={t("finance.chart.projection", { years })}
              labels={labels}
              series={series}
              format={(n) => money(n)}
              formatAxis={compact}
              tickEvery={years <= 10 ? 12 : 60}
              emphasis={scenario}
            />
          </ChartFrame>
        )}

        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead className="border-b border-border">
              <tr>
                <th scope="col" className="label px-3 py-2 text-left font-normal">
                  {t("finance.col.assumption")}
                </th>
                {projections.map((p) => (
                  <th key={p.variant} scope="col" className="label px-3 py-2 text-left font-normal">
                    {t(`scenario.${p.variant}` as never)}
                    {p.variant === scenario && ` · ${t("finance.viewing")}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["start", t("finance.assume.start"), (n: number) => money(n)],
                  [
                    "monthlyContribution",
                    t("finance.assume.contribution"),
                    (n: number) => `${money(n)}${t("unit.perMonth")}`,
                  ],
                  [
                    "annualReturn",
                    t("finance.assume.return"),
                    (n: number) => `${f.number(n * 100, { digits: 2 })}%`,
                  ],
                ] as const
              ).map(([key, label, fmt]) => (
                <tr key={key} className="border-b border-border align-top last:border-b-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    {label}
                  </th>
                  {projections.map((p) => (
                    <td key={p.variant} className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <span className="num">{fmt(p.inputs[key].value)}</span>
                        <span className="text-xs">{origin(p.inputs[key].origin)}</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {t("finance.assume.result", { years })}
                </th>
                {projections.map((p) => (
                  <td key={p.variant} className="num px-3 py-2">
                    {money(p.points[p.points.length - 1]?.value ?? null)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {others.length > 0 && (
        <Group title={t("finance.otherValues")} money={money}>
          <p className="text-xs text-fg-muted">{t("finance.otherValuesNote")}</p>
          <ValueTable rows={others} base={base} money={money} peekable={peekable} />
        </Group>
      )}
    </div>
  );
}
