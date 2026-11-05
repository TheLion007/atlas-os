import Link from "next/link";
import type { ReactNode } from "react";
import { formatDelta } from "@/lib/format";
import { cn } from "@/lib/cn";

interface MetricTileProps {
  label: string;
  /** Pre-formatted value (mono, tabular). Omit with `state="no-data"`. */
  value?: ReactNode;
  /** Unit or qualifier shown after the value, e.g. "of €420,000". */
  suffix?: string;
  /** Change since last period. `good` says which direction is favourable, if any. */
  delta?: { value: number; label?: string; good?: "up" | "down" };
  /** Optional trend, oldest first. */
  sparkline?: readonly number[];
  state?: "ready" | "loading" | "no-data";
  /** Shown instead of a value when there is no data, saying why. */
  noDataNote?: string;
  /** "Every tile links into its object." */
  href?: string;
  className?: string;
}

function Sparkline({ points }: { points: readonly number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 96;
  const h = 24;
  const coords = points.map((p, i) => [
    (i / (points.length - 1)) * w,
    h - 2 - ((p - min) / range) * (h - 4),
  ]) as [number, number][];
  const last = coords[coords.length - 1] as [number, number];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <polyline
        points={coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="round"
        className="stroke-fg-muted"
      />
      <circle cx={last[0]} cy={last[1]} r="2" className="fill-fg" />
    </svg>
  );
}

/**
 * A number with its label above and its change below. Tabular numerals, so a column of tiles
 * reads as a column of figures. States: ready · loading · no-data, plus hover when it links.
 */
export function MetricTile({
  label,
  value,
  suffix,
  delta,
  sparkline,
  state = "ready",
  noDataNote,
  href,
  className,
}: MetricTileProps) {
  const classes = cn(
    "block rounded-card border border-border bg-surface p-4",
    href && "transition-colors duration-(--duration-hover) hover:bg-hover",
    className,
  );

  const body =
    state === "loading" ? (
      <div aria-hidden="true" className="mt-2 flex flex-col gap-2">
        <div className="h-6 w-2/3 rounded-control bg-border" />
        <div className="h-3 w-1/3 rounded-control bg-border" />
      </div>
    ) : state === "no-data" ? (
      <div className="mt-2">
        <p className="num text-2xl text-fg-muted">—</p>
        {noDataNote && <p className="mt-1 text-xs text-fg-muted">{noDataNote}</p>}
      </div>
    ) : (
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="num truncate text-2xl leading-none">
            {value}
            {suffix && <span className="ml-2 text-xs text-fg-muted">{suffix}</span>}
          </p>
          {delta && (
            <p className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block size-2 rounded-full",
                  delta.good === undefined || delta.value === 0
                    ? "bg-fg-muted"
                    : delta.value > 0 === (delta.good === "up")
                      ? "bg-positive"
                      : "bg-critical",
                )}
              />
              <span className="num">{formatDelta(delta.value)}</span>
              {delta.label && <span>{delta.label}</span>}
            </p>
          )}
        </div>
        {sparkline && <Sparkline points={sparkline} />}
      </div>
    );

  const inner = (
    <>
      <p className="label">{label}</p>
      {body}
    </>
  );

  return href ? (
    <Link href={href} className={classes} data-state={state} aria-busy={state === "loading"}>
      {inner}
    </Link>
  ) : (
    <div className={classes} data-state={state} aria-busy={state === "loading"}>
      {inner}
    </div>
  );
}
