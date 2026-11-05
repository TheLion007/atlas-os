"use client";

import type { DayBar } from "@/domain/project-view";
import Link from "next/link";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";

const MAX_H = 104;
const MIN_H = 6;

interface WeekBarsProps {
  bars: readonly DayBar[];
  streak: number;
  /** A colour for each project id, so a bar can be stacked by project. */
  colorOf?: (projectId: string) => string;
  /** Where a day leads: its detail in the Work History. */
  hrefFor: (day: string) => string;
  className?: string;
}

/**
 * The last seven days as bars: how much progress each day held, today in the accent colour.
 * Hover or focus a bar for "4 advances today". The bars grow from the baseline when they first
 * appear.
 */
export function WeekBars({ bars, streak, colorOf, hrefFor, className }: WeekBarsProps) {
  const { t, f, locale } = useI18n();
  const max = Math.max(1, ...bars.map((b) => b.count));
  const total = bars.reduce((s, b) => s + b.count, 0);

  const describe = (b: DayBar): string =>
    b.isToday
      ? b.count === 0
        ? t("proj.advanceToday0")
        : b.count === 1
          ? t("proj.advanceToday1")
          : t("proj.advancesToday", { count: b.count })
      : b.count === 0
        ? t("proj.advances0", { day: f.date(b.day) })
        : b.count === 1
          ? t("proj.advances1", { day: f.date(b.day) })
          : t("proj.advancesN", { count: b.count, day: f.date(b.day) });

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="num text-sm font-semibold">{t("proj.weekTotal", { count: total })}</p>
        {streak > 0 && (
          <p className="num text-xs text-fg-muted">
            {streak === 1 ? t("proj.streakOne") : t("proj.streak", { count: streak })}
          </p>
        )}
      </div>
      <ul className="flex items-end gap-2" style={{ height: MAX_H + 28 }}>
        {bars.map((b, i) => {
          const h = b.count === 0 ? MIN_H : Math.max(MIN_H + 8, (b.count / max) * MAX_H);
          const parts = Object.entries(b.byProject);
          return (
            <li
              key={b.day}
              className="group relative flex min-w-0 flex-1 flex-col items-center gap-2"
            >
              <Link
                href={hrefFor(b.day)}
                aria-label={describe(b)}
                className="flex w-full flex-col-reverse overflow-hidden rounded-control outline-offset-2 transition-transform duration-(--duration-hover) hover:scale-x-105"
                style={{
                  height: h,
                  background: b.count === 0 ? "var(--color-hover)" : undefined,
                  transformOrigin: "bottom",
                  animation: `bar-grow 0.6s var(--ease-spring) ${i * 50}ms backwards`,
                }}
              >
                {b.count > 0 &&
                  parts.map(([pid, n]) => (
                    <span
                      key={pid}
                      style={{
                        height: `${(n / b.count) * 100}%`,
                        background: b.isToday
                          ? "var(--color-accent)"
                          : pid && colorOf
                            ? colorOf(pid)
                            : "var(--color-heat-2)",
                        opacity: b.isToday ? 1 : 0.85,
                      }}
                    />
                  ))}
              </Link>
              <span className={cn("label", b.isToday && "font-semibold text-accent-ink")}>
                {new Date(`${b.day}T12:00:00Z`).toLocaleDateString(locale, {
                  weekday: "narrow",
                  timeZone: "UTC",
                })}
              </span>
              <span
                role="tooltip"
                className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 rounded-control bg-fg px-2 py-1 text-xs whitespace-nowrap text-bg opacity-0 transition-opacity duration-(--duration-hover) group-focus-within:opacity-100 group-hover:opacity-100"
              >
                {describe(b)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
