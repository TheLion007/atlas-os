"use client";

import { useId, useState, type ReactNode } from "react";
import { CHART_COLORS } from "@/design/tokens";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { useElementWidth } from "@/lib/use-element-width";

/**
 * The Finance charts: small, quiet SVG/HTML marks over real data only. The rules they follow
 * (docs/DESIGN-SYSTEM.md and the data-viz method): one value axis, thin marks with rounded data
 * ends anchored on the baseline, a 2px gap between neighbouring fills, recessive grid, text in
 * text colours (never the series colour), a legend for two series or more, a hover readout on
 * every mark, and the same numbers as a table for anyone who cannot read the picture.
 */

export const SERIES = CHART_COLORS.series;

export interface Series {
  key: string;
  label: string;
  color: string;
  values: readonly number[];
}

/** A round upper bound and ticks for a 0-based axis. */
export function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 0.25 };
  const raw = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { max: step * Math.ceil(max / step), step };
}

/** A vertical bar with a rounded top (its data end) and a square base. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0 || w <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function Legend({ items }: { items: readonly { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block size-2 rounded-full"
            style={{ background: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Title, optional legend, the chart, and a switch to the same data as a table. */
export function ChartFrame({
  title,
  note,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  note?: ReactNode;
  legend?: ReactNode;
  table: { head: readonly string[]; rows: readonly (readonly ReactNode[])[] };
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [asTable, setAsTable] = useState(false);
  return (
    <section
      className={cn("flex min-w-0 flex-col gap-3 rounded-card border border-border p-4", className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="label">{title}</h3>
          {note && <p className="text-xs text-fg-muted">{note}</p>}
        </div>
        <button
          type="button"
          aria-pressed={asTable}
          onClick={() => setAsTable((v) => !v)}
          className="shrink-0 rounded-control border border-border px-2 py-1 text-xs text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg aria-pressed:bg-selected aria-pressed:text-fg"
        >
          {t("finance.chart.table")}
        </button>
      </div>
      {legend}
      {asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                {table.head.map((h, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={cn(
                      "label px-2 py-1 font-normal",
                      i === 0 ? "text-left" : "text-right",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-b-0">
                  {r.map((c, j) => (
                    <td key={j} className={cn("px-2 py-1", j === 0 ? "" : "num text-right")}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function Tooltip({
  x,
  y,
  width,
  children,
}: {
  x: number;
  y: number;
  width: number;
  children: ReactNode;
}) {
  // Kept inside the chart: flips to the left of the pointer near the right edge.
  const left = x > width - 180 ? x - 172 : x + 12;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 flex min-w-40 flex-col gap-1 rounded-control border border-border bg-surface px-3 py-2 text-xs"
      style={{ left, top: Math.max(0, y - 8) }}
    >
      {children}
    </div>
  );
}

function TipRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-fg-muted">
        {color && (
          <span
            aria-hidden="true"
            className="inline-block size-2 rounded-full"
            style={{ background: color }}
          />
        )}
        {label}
      </span>
      <span className="num text-fg">{value}</span>
    </p>
  );
}

// ── Grouped vertical bars (e.g. income vs expenses by month) ─────────────────────────────────

export function GroupedBars({
  categories,
  series,
  format,
  formatAxis = format,
  footer,
  height = 200,
  ariaLabel,
}: {
  categories: readonly { key: string; label: string; long: string }[];
  series: readonly Series[];
  format: (n: number) => string;
  formatAxis?: (n: number) => string;
  /** An extra line for the hovered category (e.g. its net). */
  footer?: (index: number) => ReactNode;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<number | null>(null);
  const left = 56;
  const bottom = 22;
  const plotW = Math.max(10, width - left - 4);
  const plotH = height - bottom - 6;
  const { max, step } = niceScale(Math.max(0, ...series.flatMap((s) => s.values)));
  const band = plotW / Math.max(1, categories.length);
  const group = Math.min(band * 0.64, 18 * series.length + 2 * (series.length - 1));
  const barW = (group - 2 * (series.length - 1)) / series.length;
  const y = (v: number) => 6 + plotH - (v / max) * plotH;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  // Month labels thin out on narrow screens rather than colliding.
  const every = Math.ceil(categories.length / Math.max(1, Math.floor(plotW / 44)));

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={left + plotW}
              y1={y(v)}
              y2={y(v)}
              stroke={CHART_COLORS.grid}
              strokeWidth={1}
            />
            <text
              x={left - 8}
              y={y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              className="num fill-fg-muted text-xs"
            >
              {formatAxis(v)}
            </text>
          </g>
        ))}
        {categories.map((c, i) => {
          const x0 = left + band * i + (band - group) / 2;
          return (
            <g key={c.key}>
              {hover === i && (
                <rect
                  x={left + band * i}
                  y={6}
                  width={band}
                  height={plotH}
                  className="fill-hover"
                />
              )}
              {series.map((s, j) => {
                const v = s.values[i] ?? 0;
                return (
                  <path
                    key={s.key}
                    d={barPath(x0 + j * (barW + 2), y(v), barW, y(0) - y(v))}
                    fill={s.color}
                  />
                );
              })}
              {i % every === 0 && (
                <text
                  x={left + band * i + band / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-fg-muted text-xs"
                >
                  {c.label}
                </text>
              )}
              {/* The hit target is the whole band, bigger than the bars. */}
              <rect
                x={left + band * i}
                y={0}
                width={band}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && categories[hover] && (
        <Tooltip x={left + band * hover + band / 2} y={24} width={width}>
          <p className="text-fg">{categories[hover].long}</p>
          {series.map((s) => (
            <TipRow
              key={s.key}
              color={s.color}
              label={s.label}
              value={format(s.values[hover] ?? 0)}
            />
          ))}
          {footer?.(hover)}
        </Tooltip>
      )}
    </div>
  );
}

// ── Horizontal bars (one series, sorted) ─────────────────────────────────────────────────────

export function HBars({
  rows,
  color,
  format,
}: {
  rows: readonly { key: string; label: string; value: number; note?: string }[];
  color: string;
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-sm"
          title={`${r.label}: ${format(r.value)}`}
        >
          <span className="truncate text-fg-muted">{r.label}</span>
          <span className="h-2 min-w-0">
            <span
              className="block h-2 rounded-r-control"
              style={{ width: `${Math.max(1, (r.value / max) * 100)}%`, background: color }}
            />
          </span>
          <span className="num text-right">
            {format(r.value)}
            {r.note && <span className="ml-2 text-xs text-fg-muted">{r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── Paired horizontal bars (a reference vs a value, e.g. invested vs worth) ──────────────────

export function PairedBars({
  rows,
  referenceLabel,
  valueLabel,
  format,
}: {
  rows: readonly {
    key: string;
    label: string;
    reference: number | null;
    value: number;
    note?: string;
  }[];
  referenceLabel: string;
  valueLabel: string;
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.value, r.reference ?? 0]));
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1 text-sm">
          <p className="flex items-baseline justify-between gap-3">
            <span className="truncate">{r.label}</span>
            {r.note && <span className="num shrink-0 text-xs text-fg-muted">{r.note}</span>}
          </p>
          {r.reference !== null && (
            <span
              className="grid grid-cols-[1fr_auto] items-center gap-3"
              title={`${referenceLabel}: ${format(r.reference)}`}
            >
              <span
                className="block h-2 rounded-r-control"
                style={{
                  width: `${(r.reference / max) * 100}%`,
                  background: CHART_COLORS.reference,
                }}
              />
              <span className="num text-xs text-fg-muted">{format(r.reference)}</span>
            </span>
          )}
          <span
            className="grid grid-cols-[1fr_auto] items-center gap-3"
            title={`${valueLabel}: ${format(r.value)}`}
          >
            <span
              className="block h-2 rounded-r-control"
              style={{ width: `${(r.value / max) * 100}%`, background: SERIES[0] }}
            />
            <span className="num text-xs">{format(r.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── A 100% stacked bar (allocation) ──────────────────────────────────────────────────────────

export function StackBar({
  slices,
  format,
}: {
  slices: readonly { key: string; label: string; value: number; color: string }[];
  format: (n: number) => string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 w-full overflow-hidden rounded-control" style={{ gap: 2 }}>
        {slices.map((s) => (
          <span
            key={s.key}
            title={`${s.label}: ${format(s.value)}`}
            className="block h-full"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block size-2 shrink-0 rounded-full"
                style={{ background: s.color }}
              />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="num shrink-0 text-fg-muted">
              {format(s.value)} · {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Lines over time (projections) ────────────────────────────────────────────────────────────

export function LineChart({
  labels,
  series,
  format,
  formatAxis = format,
  tickEvery,
  height = 240,
  ariaLabel,
  emphasis,
}: {
  /** One label per point (e.g. "2027-03"). */
  labels: readonly string[];
  series: readonly (Series & { dashed?: boolean })[];
  format: (n: number) => string;
  formatAxis?: (n: number) => string;
  /** Label every n-th point on the x axis. */
  tickEvery: number;
  height?: number;
  ariaLabel: string;
  /** The series drawn on top and labelled first (e.g. the active scenario). */
  emphasis?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<number | null>(null);
  const clip = useId();
  const left = 60;
  const right = 136;
  const bottom = 22;
  const plotW = Math.max(10, width - left - right);
  const plotH = height - bottom - 8;
  const n = Math.max(2, labels.length);
  const { max, step } = niceScale(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i: number) => left + (i / (n - 1)) * plotW;
  const y = (v: number) => 8 + plotH - (Math.max(0, v) / max) * plotH;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
  const ordered = [...series].sort(
    (a, b) => Number(a.key === emphasis) - Number(b.key === emphasis),
  );
  // End labels, nudged apart so they never overlap.
  const ends = series
    .map((s) => ({ s, y: y(s.values[s.values.length - 1] ?? 0) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    const prev = ends[i - 1] as (typeof ends)[number];
    const cur = ends[i] as (typeof ends)[number];
    if (cur.y - prev.y < 14) cur.y = prev.y + 14;
  }

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - left) / plotW) * (n - 1));
    setHover(i >= 0 && i < labels.length ? i : null);
  };

  return (
    <div ref={ref} className="relative">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        className="block"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clip}>
            <rect x={left} y={0} width={plotW + 2} height={height} />
          </clipPath>
        </defs>
        {ticks.map((v) => (
          <g key={v}>
            <line
              x1={left}
              x2={left + plotW}
              y1={y(v)}
              y2={y(v)}
              stroke={CHART_COLORS.grid}
              strokeWidth={1}
            />
            <text
              x={left - 8}
              y={y(v)}
              textAnchor="end"
              dominantBaseline="middle"
              className="num fill-fg-muted text-xs"
            >
              {formatAxis(v)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % tickEvery === 0 ? (
            <text
              key={l}
              x={x(i)}
              y={height - 6}
              textAnchor="middle"
              className="num fill-fg-muted text-xs"
            >
              {l.slice(0, 4)}
            </text>
          ) : null,
        )}
        <g clipPath={`url(#${clip})`}>
          {ordered.map((s) => (
            <polyline
              key={s.key}
              points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={s.key === emphasis ? 2.5 : 2}
              strokeDasharray={s.dashed ? "4 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={emphasis && s.key !== emphasis ? 0.7 : 1}
            />
          ))}
        </g>
        {ends.map(({ s, y: ly }) => (
          <text
            key={s.key}
            x={left + plotW + 8}
            y={ly}
            dominantBaseline="middle"
            className="fill-fg-muted text-xs"
          >
            {s.label}
          </text>
        ))}
        {hover !== null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={8}
              y2={8 + plotH}
              className="stroke-fg-muted"
              strokeWidth={1}
            />
            {series.map((s) => (
              <circle
                key={s.key}
                cx={x(hover)}
                cy={y(s.values[hover] ?? 0)}
                r={4}
                fill={s.color}
                className="stroke-bg"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && labels[hover] && (
        <Tooltip x={x(hover)} y={16} width={width}>
          <p className="num text-fg">{labels[hover]}</p>
          {series.map((s) => (
            <TipRow
              key={s.key}
              color={s.color}
              label={s.label}
              value={format(s.values[hover] ?? 0)}
            />
          ))}
        </Tooltip>
      )}
    </div>
  );
}
