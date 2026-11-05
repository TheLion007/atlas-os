"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { TimelineItem, TimelineModel } from "@/domain/timeline";
import { useI18n } from "@/i18n/I18nProvider";
import type { Formatters } from "@/i18n/format";
import type { TFunction } from "@/i18n";
import { useElementWidth } from "@/lib/use-element-width";
import { cn } from "@/lib/cn";
import { makeTimeScale } from "./time-scale";

interface GanttBoardProps {
  model: TimelineModel;
  /** Today's date, injected: it is always drawn. */
  today: string;
  zoom?: "year" | "quarter";
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** One focal element per screen may take the sand accent: here, the today line. */
  accentToday?: boolean;
  /** Fewer, shorter rows for dashboard strips. */
  compact?: boolean;
  className?: string;
}

const HEADER = 32;

function itemLabel(i: TimelineItem, t: TFunction, f: Formatters): string {
  const slip =
    i.slipDays && i.slipDays !== 0
      ? `, ${t(i.slipDays > 0 ? "tl.later" : "tl.earlier", { count: Math.abs(i.slipDays) })}`
      : "";
  return `${i.type === "milestone" ? t("tl.itemMilestone") : t("tl.itemTask")}: ${i.title}, ${f.date(i.date)}${slip}${i.blocked ? `, ${t("tl.blockedSuffix")}` : ""}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Time on the horizontal axis, projects as rows. Milestones are diamonds, tasks small ticks,
 * the project's span a quiet bar, the today line is always visible, dependencies are hairlines
 * (raised on hover), and a slipped item leaves a hatched ghost back at its baseline. Everything
 * is positioned by the schedule engine, so a scenario change redraws the board. A table below
 * gives the same information as text. States: year · quarter · dependency-hover · slip-ghost.
 */
export function GanttBoard({
  model,
  today,
  zoom = "year",
  selectedId = null,
  onSelect,
  accentToday = false,
  compact = false,
  className,
}: GanttBoardProps) {
  const { t, f } = useI18n();
  const [measure, width] = useElementWidth<HTMLDivElement>(960);
  const [hover, setHover] = useState<string | null>(null);
  const hatchId = useId();

  const rowH = compact ? 32 : 44;
  const labelW = width < 520 ? 104 : compact ? 152 : 184;
  const plotW = Math.max(200, width - labelW - 16);
  const scale = useMemo(() => makeTimeScale(model.start, model.end, plotW), [model, plotW]);
  const height = HEADER + Math.max(1, model.rows.length) * rowH + 8;

  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    model.rows.forEach((row, ri) => {
      const y = HEADER + ri * rowH + rowH / 2;
      for (const i of row.items) m.set(i.id, { x: labelW + scale.x(i.date), y });
    });
    return m;
  }, [model, scale, rowH, labelW]);

  const hovered = hover ?? selectedId;
  const todayX = labelW + scale.x(today);
  const todayInRange = today >= model.start && today <= model.end;
  const ticks = scale.ticks(zoom);

  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(id);
    }
  };

  if (model.rows.length === 0) {
    return (
      <p className={cn("text-fg-muted", className)} data-state="empty">
        {t("tl.empty")}
      </p>
    );
  }

  return (
    <div
      ref={measure}
      className={cn("w-full", className)}
      data-zoom={zoom}
      data-state={hover ? "dependency-hover" : zoom}
    >
      <svg
        width={width}
        height={height}
        role="group"
        aria-label={t("tl.aria")}
        className="block overflow-visible"
      >
        <defs>
          <pattern
            id={hatchId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-fg-muted" strokeWidth="1.5" />
          </pattern>
        </defs>

        {/* Axis and gridlines */}
        <g aria-hidden="true">
          {ticks.map((t) => (
            <g key={`${t.label}-${t.x}`}>
              <line
                x1={labelW + t.x}
                y1={HEADER - 6}
                x2={labelW + t.x}
                y2={height - 8}
                className={t.major ? "stroke-border" : "stroke-border/50"}
                strokeWidth="1"
              />
              <text
                x={labelW + t.x + 6}
                y={HEADER - 12}
                className={cn("num", t.major ? "fill-fg" : "fill-fg-muted")}
                fontSize="11"
              >
                {t.label}
              </text>
            </g>
          ))}
          {model.rows.map((row, ri) => (
            <line
              key={row.id}
              x1={0}
              x2={width}
              y1={HEADER + (ri + 1) * rowH}
              y2={HEADER + (ri + 1) * rowH}
              className="stroke-border/60"
            />
          ))}
        </g>

        {/* Dependency hairlines */}
        <g fill="none" aria-hidden="true">
          {model.dependencies.map((d) => {
            const a = positions.get(d.from);
            const b = positions.get(d.to);
            if (!a || !b) return null;
            const lit = hovered === d.from || hovered === d.to;
            const mid = a.x + Math.max(8, (b.x - a.x) / 2);
            return (
              <path
                key={`${d.from}-${d.to}`}
                d={`M${a.x} ${a.y} H${mid} V${b.y} H${b.x}`}
                className={lit ? "stroke-fg" : "stroke-fg-muted/35"}
                strokeWidth={lit ? 1.5 : 1}
              />
            );
          })}
        </g>

        {/* Rows */}
        {model.rows.map((row, ri) => {
          const y = HEADER + ri * rowH + rowH / 2;
          // Label a milestone only when there is clear room before the next one; the rest appear on
          // hover or selection, and are always in the text alternative.
          const labelled = new Set<string>();
          const stones = row.items.filter((it) => it.type === "milestone");
          stones.forEach((it, k) => {
            const px = positions.get(it.id)?.x ?? 0;
            const next = stones[k + 1]
              ? (positions.get((stones[k + 1] as TimelineItem).id)?.x ?? Infinity)
              : Infinity;
            const need = Math.min(it.title.length, 24) * 6.2 + 20;
            if (next - px >= need) labelled.add(it.id);
          });
          return (
            <g key={row.id}>
              <text x={0} y={y + 4} className="fill-fg" fontSize="13">
                {clip(row.title, Math.floor(labelW / 7.4))}
              </text>
              {row.start && row.end && (
                <rect
                  x={labelW + scale.x(row.start)}
                  y={y - 3}
                  width={Math.max(2, scale.x(row.end) - scale.x(row.start))}
                  height={6}
                  rx={3}
                  className="fill-border"
                />
              )}
              {row.items
                .filter((i) => i.type === "milestone" || (zoom === "quarter" && !compact))
                .map((i) => {
                  const p = positions.get(i.id);
                  if (!p) return null;
                  const selected = i.id === selectedId;
                  const live = i.status === "draft" || i.status === "active";
                  // Critical marks a real problem (slipped past baseline, or overdue), not a normal wait.
                  const problem = live && ((i.slipDays ?? 0) > 0 || i.date < today);
                  const stroke = problem ? "stroke-critical" : "stroke-fg";
                  const fill = i.status === "done" ? "fill-fg" : "fill-bg";
                  return (
                    <g
                      key={i.id}
                      role="button"
                      tabIndex={0}
                      aria-label={itemLabel(i, t, f)}
                      aria-pressed={selected}
                      className="cursor-pointer"
                      onClick={() => onSelect?.(i.id)}
                      onKeyDown={(e) => onKey(e, i.id)}
                      onMouseEnter={() => setHover(i.id)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(i.id)}
                      onBlur={() => setHover(null)}
                      opacity={i.status === "dropped" ? 0.4 : 1}
                    >
                      {i.baselineDate && (
                        <rect
                          x={labelW + scale.x(i.baselineDate < i.date ? i.baselineDate : i.date)}
                          y={y - 3}
                          width={Math.abs(scale.x(i.date) - scale.x(i.baselineDate))}
                          height={6}
                          fill={`url(#${hatchId})`}
                          data-part="slip-ghost"
                        />
                      )}
                      <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
                      {i.type === "milestone" ? (
                        <path
                          d={`M${p.x} ${p.y - 7} L${p.x + 7} ${p.y} L${p.x} ${p.y + 7} L${p.x - 7} ${p.y}z`}
                          className={cn(fill, stroke)}
                          strokeWidth={selected ? 2.5 : 1.5}
                          strokeDasharray={i.status === "draft" ? "2 2" : undefined}
                        />
                      ) : (
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={4}
                          className={cn(fill, stroke)}
                          strokeWidth={selected ? 2.5 : 1.5}
                          strokeDasharray={i.status === "draft" ? "2 2" : undefined}
                        />
                      )}
                      {i.type === "milestone" &&
                        !compact &&
                        (labelled.has(i.id) || i.id === hovered) && (
                          <text
                            x={p.x + 12}
                            y={p.y + 4}
                            className="fill-fg"
                            fontSize="11"
                            stroke="var(--color-bg)"
                            strokeWidth={4}
                            paintOrder="stroke"
                          >
                            {clip(i.title, 24)}
                          </text>
                        )}
                    </g>
                  );
                })}
            </g>
          );
        })}

        {/* Today: always visible */}
        {todayInRange && (
          <g aria-label={t("tl.todayAria", { date: f.date(today) })} role="img">
            <line
              x1={todayX}
              x2={todayX}
              y1={HEADER - 6}
              y2={height - 8}
              className={accentToday ? "stroke-accent" : "stroke-fg"}
              strokeWidth={accentToday ? 2 : 1.5}
              data-part="today"
            />
            <text
              x={todayX + 6}
              y={HEADER + 12}
              className={accentToday ? "fill-accent" : "fill-fg"}
              fontSize="10"
              letterSpacing="0.08em"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {t("tl.today")}
            </text>
          </g>
        )}
      </svg>

      {/* The same information as text. */}
      <div className="sr-only">
        <table>
          <caption>{t("tl.tableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("tl.colProject")}</th>
              <th scope="col">{t("tl.colItem")}</th>
              <th scope="col">{t("tl.colDate")}</th>
              <th scope="col">{t("tl.colBaseline")}</th>
            </tr>
          </thead>
          <tbody>
            {model.rows.flatMap((row) =>
              row.items.map((i) => (
                <tr key={i.id}>
                  <th scope="row">{row.title}</th>
                  <td>{i.title}</td>
                  <td>{f.date(i.date)}</td>
                  <td>
                    {i.slipDays
                      ? `${i.slipDays > 0 ? "+" : "−"}${t("tl.days", { count: Math.abs(i.slipDays) })}`
                      : t("tl.onBaseline")}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
