"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { GridCell, Level, YearGrid } from "@/domain/history";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";

export const LEVEL_BG: Record<Level, string> = {
  0: "bg-heat-0",
  1: "bg-heat-1",
  2: "bg-heat-2",
  3: "bg-heat-3",
  4: "bg-heat-4",
};

interface HeatGridProps {
  grid: YearGrid;
  /** Square size and gap, in px. */
  size?: number;
  gap?: number;
  /** Pick a day without leaving the page (the Work History itself)… */
  onPick?: (day: string) => void;
  /** …or lead to that day in the Work History (everywhere else). */
  hrefFor?: (day: string) => string;
  selectedDay?: string | null;
  /** What the hover card says about a day. */
  tip: (cell: GridCell) => ReactNode;
  /** The accessible name of one square. */
  ariaFor: (cell: GridCell) => string;
  /** The grid's accessible name. */
  label: string;
  showMonths?: boolean;
  showWeekdays?: boolean;
}

const WEEKDAY_ROWS = [0, 2, 4];

/**
 * One square per day, darker where more happened, today outlined in the accent. Hover or focus a
 * square for that day's detail; click or press Enter to open it (`onPick` in place, or a link).
 * It scrolls sideways on a narrow screen instead of shrinking the squares.
 */
export function HeatGrid({
  grid,
  size = 12,
  gap = 3,
  onPick,
  hrefFor,
  selectedDay = null,
  tip,
  ariaFor,
  label,
  showMonths = true,
  showWeekdays = true,
}: HeatGridProps) {
  const { locale } = useI18n();
  const [hover, setHover] = useState<{ cell: GridCell; x: number; y: number } | null>(null);
  const step = size + gap;
  const monthName = (m: number) =>
    new Date(Date.UTC(2026, m, 1)).toLocaleDateString(locale, { month: "short", timeZone: "UTC" });
  const weekdayName = (row: number) =>
    new Date(Date.UTC(2026, 9, 26 + row, 12)).toLocaleDateString(locale, {
      weekday: "narrow",
      timeZone: "UTC",
    });

  const show = (cell: GridCell, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setHover({ cell, x: r.left + r.width / 2, y: r.top });
  };

  return (
    <div className="relative max-w-full overflow-x-auto pb-2" role="group" aria-label={label}>
      <div className="inline-flex gap-2">
        {showWeekdays && (
          <div
            aria-hidden="true"
            className="label grid shrink-0 text-[10px]"
            style={{
              gridTemplateRows: `${showMonths ? 16 : 0}px repeat(7, ${size}px)`,
              rowGap: gap,
            }}
          >
            <span />
            {Array.from({ length: 7 }, (_, row) => (
              <span key={row} className="leading-none" style={{ lineHeight: `${size}px` }}>
                {WEEKDAY_ROWS.includes(row) ? weekdayName(row) : ""}
              </span>
            ))}
          </div>
        )}
        <div>
          {showMonths && (
            <div
              aria-hidden="true"
              className="relative h-4"
              style={{ width: grid.columns.length * step }}
            >
              {grid.months.map((m) => (
                <span
                  key={`${m.column}-${m.month}`}
                  className="label absolute text-[10px]"
                  style={{ left: m.column * step }}
                >
                  {monthName(m.month)}
                </span>
              ))}
            </div>
          )}
          <div
            className="grid grid-flow-col"
            style={{ gridTemplateRows: `repeat(7, ${size}px)`, gap }}
            onMouseLeave={() => setHover(null)}
          >
            {grid.columns.flat().map((cell) => {
              const common = cn(
                "block transition-transform duration-(--duration-hover)",
                cell.future ? "bg-transparent" : LEVEL_BG[cell.level],
                !cell.future && "hover:scale-125 focus-visible:scale-125",
                cell.isToday && "outline-2 -outline-offset-1 outline-accent",
                selectedDay === cell.day && "outline-2 outline-fg",
              );
              const style = { width: size, height: size, borderRadius: 3 };
              if (cell.future)
                return <span key={cell.day} aria-hidden="true" className={common} style={style} />;
              const name = hrefFor ? undefined : cell.day;
              const handlers = {
                onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(cell, e.currentTarget),
                onFocus: (e: React.FocusEvent<HTMLElement>) => show(cell, e.currentTarget),
                onBlur: () => setHover(null),
              };
              return hrefFor ? (
                <Link
                  key={cell.day}
                  href={hrefFor(cell.day)}
                  aria-label={ariaFor(cell)}
                  className={common}
                  style={style}
                  {...handlers}
                />
              ) : (
                <button
                  key={cell.day}
                  type="button"
                  data-day={name}
                  aria-label={ariaFor(cell)}
                  aria-pressed={selectedDay === cell.day}
                  onClick={() => onPick?.(cell.day)}
                  className={common}
                  style={style}
                  {...handlers}
                />
              );
            })}
          </div>
        </div>
      </div>
      {hover && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-card border border-border bg-surface px-3 py-2 text-xs shadow-pop"
          style={{ left: hover.x, top: hover.y - 8 }}
        >
          {tip(hover.cell)}
        </div>
      )}
    </div>
  );
}
