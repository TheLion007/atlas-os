"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState, type DragEvent } from "react";
import { describeError, describeWriteError, useGraph, useUpdateObject } from "@/client/hooks";
import { useSource } from "@/client/provider";
import {
  calendarItems,
  monthWeeks,
  rescheduledDetails,
  stepAnchor,
  weekOf,
  type CalItem,
  type CalView,
} from "@/domain/calendar";
import { diffDays } from "@/domain/dates";
import { projectColor } from "@/design/palette";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { useFeedback } from "@/lib/feedback/celebrate";
import { playSound } from "@/lib/feedback/sound";
import { hrefKeepingState } from "../shell/nav";
import { useUi } from "../shell/ui-store";
import { ErrorState, LoadingState } from "../ui/states";

const FIRST_HOUR = 7;
const LAST_HOUR = 21;
const ROW = 44;
const VIEWS: readonly CalView[] = ["month", "week", "day"];

/**
 * The Calendar, as in the design: a month (or a week, or a day) of what is due and what you set
 * a reminder for, the next deadlines on the right, and the projects you choose to see. Dragging an
 * item onto another day (or hour) rewrites the date on the object itself.
 */
export function CalendarLens() {
  const { t, locale } = useI18n();
  const graph = useGraph();
  const source = useSource();
  const params = useSearchParams();
  const update = useUpdateObject();
  const pushToast = useUi((s) => s.pushToast);
  const react = useFeedback((s) => s.react);
  const today = source?.today() ?? new Date().toISOString().slice(0, 10);
  const [view, setView] = useState<CalView>("month");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [over, setOver] = useState<string | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const at = anchor ?? today;
  // The machine's own offset: the domain stays free of the clock and the time zone.
  const offset = useMemo(() => -new Date().getTimezoneOffset(), []);

  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const edges = useMemo(() => graph.data?.edges ?? [], [graph.data]);
  const all = useMemo(() => calendarItems(nodes, edges, offset), [nodes, edges, offset]);
  const projects = useMemo(
    () =>
      nodes
        .filter((n) => n.type === "project" && n.status !== "dropped")
        .sort((a, b) => a.title.localeCompare(b.title)),
    [nodes],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const colorOf = (projectId: string | null) => {
    const p = projectId ? byId.get(projectId) : undefined;
    return p ? projectColor(p.color, p.id) : "var(--color-fg-subtle)";
  };
  const items = all.filter((i) => !i.projectId || !hidden.has(i.projectId));
  const byDay = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    for (const i of items) m.set(i.day, [...(m.get(i.day) ?? []), i]);
    return m;
  }, [items]);

  if (graph.isPending) return <LoadingState label={t("nav.calendar")} lines={6} />;
  if (graph.isError) {
    const { title, message } = describeError(graph.error, t);
    return <ErrorState title={title} message={message} onRetry={() => void graph.refetch()} />;
  }

  const dayDate = (d: string) => new Date(`${d}T12:00:00Z`);
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(dayDate(d));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const weekDays = weekOf(at);
  const label =
    view === "month"
      ? cap(fmt(at, { month: "long", year: "numeric" }))
      : view === "week"
        ? `${fmt(weekDays[0] as string, { day: "numeric", month: "short" })} – ${fmt(weekDays[6] as string, { day: "numeric", month: "short", year: "numeric" })}`
        : cap(fmt(at, { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  const month = at.slice(0, 7);

  const move = (item: CalItem, day: string, time: string | null) => {
    const node = byId.get(item.id);
    if (!node || (day === item.day && (time === null || time === item.time))) return;
    update.mutate(
      {
        id: item.id,
        patch: { details: rescheduledDetails(node, item, day, time, offset) },
      },
      {
        onSuccess: () => {
          playSound("drop");
          react("happy", null);
          pushToast(
            t("cal.moved", {
              title: item.title,
              date: fmt(day, { weekday: "short", day: "numeric", month: "short" }),
            }),
          );
        },
        onError: (e) => {
          playSound("error");
          pushToast(describeWriteError(e, t));
        },
      },
    );
  };
  const dragStart = (item: CalItem) => (e: DragEvent) => {
    e.dataTransfer.setData("text/plain", item.id);
    e.dataTransfer.effectAllowed = "move";
    setLifted(item.id);
    playSound("click");
  };
  const itemFromDrop = (e: DragEvent) =>
    all.find((i) => i.id === e.dataTransfer.getData("text/plain"));
  const dropOnDay = (day: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    setLifted(null);
    const item = itemFromDrop(e);
    if (item) move(item, day, null);
  };
  const dropOnHours = (day: string) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setOver(null);
    setLifted(null);
    const item = itemFromDrop(e);
    if (!item) return;
    const box = e.currentTarget.getBoundingClientRect();
    const minutes = Math.max(0, Math.round(((e.clientY - box.top) / ROW) * 4) * 15);
    const total = FIRST_HOUR * 60 + minutes;
    const time = `${String(Math.min(23, Math.floor(total / 60))).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    move(item, day, item.kind === "reminder" ? time : null);
  };
  const overProps = (key: string) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (over !== key) setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
  });

  const href = (id: string) => hrefKeepingState(`/objects/${id}`, params);
  const pill = (i: CalItem, compact: boolean) => {
    const color = colorOf(i.projectId);
    return (
      <Link
        key={i.id}
        href={href(i.id)}
        draggable
        onDragStart={dragStart(i)}
        onDragEnd={() => setLifted(null)}
        title={`${i.time ? `${i.time} · ` : ""}${i.title}`}
        className={cn(
          "flex items-center gap-[5px] truncate rounded-[7px] px-[7px] py-[3px] text-[11px] font-semibold transition-[transform,box-shadow,opacity] duration-200 hover:-translate-y-px hover:shadow-card",
          i.kind === "due" ? "text-on-accent" : "border border-dashed bg-surface text-fg",
          i.done && "line-through opacity-50",
          lifted === i.id && "opacity-40",
          compact ? "" : "py-[5px]",
        )}
        style={i.kind === "due" ? { background: color } : { borderColor: color }}
      >
        {i.kind === "reminder" && (
          <i className="size-[6px] flex-none rounded-full" style={{ background: color }} />
        )}
        <span className="truncate">{i.title}</span>
      </Link>
    );
  };

  const dows = weekOf(today).map((d) => fmt(d, { weekday: "short" }).toUpperCase());
  const upcoming = all
    .filter((i) => i.day >= today && !i.done && (!i.projectId || !hidden.has(i.projectId)))
    .slice(0, 7);
  const rel = (d: string) => {
    const n = diffDays(today, d);
    return n === 0
      ? t("cal.relToday")
      : n === 1
        ? t("cal.relTomorrow")
        : t("cal.relIn", { count: n });
  };

  const nav = (dir: 1 | -1) => {
    playSound("click");
    setAnchor(stepAnchor(at, view, dir));
  };
  const columns = view === "week" ? weekDays : [at];
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
  const iconBtn =
    "grid size-8 place-items-center rounded-[10px] border border-border-strong bg-surface transition-transform duration-200 ease-(--ease-spring) active:scale-90";

  return (
    <div className="mx-auto -my-4 flex max-w-[1300px] flex-wrap items-start gap-[22px] px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9">
      <div className="flex min-w-0 flex-[1_1_620px] flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[34px] leading-none font-extrabold tracking-[-0.03em]">
            {label}
          </h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label={t("cal.prev")}
              onClick={() => nav(-1)}
              className={cn(iconBtn, "hover:-translate-x-[2px]")}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                playSound("click");
                setAnchor(null);
              }}
              className="h-8 rounded-[10px] border border-border-strong bg-surface px-3 text-[12.5px] font-semibold transition-transform duration-200 active:scale-95"
            >
              {t("cal.today")}
            </button>
            <button
              type="button"
              aria-label={t("cal.next")}
              onClick={() => nav(1)}
              className={cn(iconBtn, "hover:translate-x-[2px]")}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <span className="flex-1" />
          <div
            role="radiogroup"
            aria-label={t("cal.view")}
            className="flex rounded-[11px] bg-sunk p-[3px]"
          >
            {VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => {
                  playSound("click");
                  setView(v);
                }}
                className={cn(
                  "rounded-[8px] px-3 py-[5px] text-[12.5px] font-semibold transition-colors duration-200",
                  view === v ? "bg-surface text-fg shadow-card" : "text-fg-subtle hover:text-fg",
                )}
              >
                {t(`cal.${v}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[22px] border border-border bg-surface shadow-card">
          {view === "month" ? (
            <div>
              <div className="num grid grid-cols-7 border-b border-border px-1 py-2 text-[10.5px] font-semibold tracking-[0.06em] text-fg-subtle">
                {dows.map((d) => (
                  <span key={d} className="px-2">
                    {d}
                  </span>
                ))}
              </div>
              {monthWeeks(at).map((w) => (
                <div key={w[0]} className="grid grid-cols-7 border-b border-border last:border-b-0">
                  {w.map((d) => {
                    const evs = byDay.get(d) ?? [];
                    const inMonth = d.startsWith(month);
                    return (
                      <div
                        key={d}
                        {...overProps(d)}
                        onDrop={dropOnDay(d)}
                        className={cn(
                          "flex min-h-[92px] flex-col gap-[3px] border-r border-border p-[6px] last:border-r-0 transition-colors duration-150",
                          over === d && "bg-accent-soft",
                        )}
                      >
                        <span
                          className={cn(
                            "num grid size-[22px] place-items-center self-start rounded-full text-[11.5px] font-semibold",
                            d === today
                              ? "bg-accent text-on-accent"
                              : inMonth
                                ? "text-fg"
                                : "text-fg-subtle/60",
                          )}
                        >
                          {Number(d.slice(8))}
                        </span>
                        {evs.slice(0, 3).map((i) => pill(i, true))}
                        {evs.length > 3 && (
                          <button
                            type="button"
                            onClick={() => {
                              playSound("click");
                              setAnchor(d);
                              setView("day");
                            }}
                            className="num self-start text-[10.5px] text-fg-subtle hover:text-fg"
                          >
                            {t("cal.more", { count: evs.length - 3 })}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div>
              <div
                className="grid border-b border-border"
                style={{ gridTemplateColumns: `48px repeat(${columns.length}, 1fr)` }}
              >
                <span />
                {columns.map((d) => {
                  const allDay = (byDay.get(d) ?? []).filter((i) => i.time === null);
                  return (
                    <div
                      key={d}
                      {...overProps(`h-${d}`)}
                      onDrop={dropOnDay(d)}
                      className={cn(
                        "flex min-w-0 flex-col gap-[3px] border-l border-border p-[6px]",
                        over === `h-${d}` && "bg-accent-soft",
                      )}
                    >
                      <span className="num flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.06em] text-fg-subtle uppercase">
                        {fmt(d, { weekday: "short" })}
                        <span
                          className={cn(
                            "grid size-[22px] place-items-center rounded-full text-[11.5px]",
                            d === today ? "bg-accent text-on-accent" : "text-fg",
                          )}
                        >
                          {Number(d.slice(8))}
                        </span>
                      </span>
                      {allDay.map((i) => pill(i, true))}
                    </div>
                  );
                })}
              </div>
              <div
                className="grid"
                style={{ gridTemplateColumns: `48px repeat(${columns.length}, 1fr)` }}
              >
                <div>
                  {hours.map((h) => (
                    <div
                      key={h}
                      className="num pr-2 text-right text-[10.5px] text-fg-subtle"
                      style={{ height: ROW }}
                    >
                      {String(h).padStart(2, "0")}:00
                    </div>
                  ))}
                </div>
                {columns.map((d) => (
                  <div
                    key={d}
                    {...overProps(`t-${d}`)}
                    onDrop={dropOnHours(d)}
                    className={cn(
                      "relative border-l border-border",
                      over === `t-${d}` && "bg-accent-soft",
                    )}
                    style={{
                      height: hours.length * ROW,
                      backgroundImage:
                        "linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)",
                      backgroundSize: `100% ${ROW}px`,
                    }}
                  >
                    {(byDay.get(d) ?? [])
                      .filter((i) => i.time !== null)
                      .map((i) => {
                        const [h, m] = (i.time as string).split(":").map(Number) as [
                          number,
                          number,
                        ];
                        const top = Math.max(0, (h - FIRST_HOUR + m / 60) * ROW);
                        return (
                          <div
                            key={i.id}
                            className="absolute right-1 left-1"
                            style={{ top, height: ROW - 6 }}
                          >
                            {pill(i, false)}
                          </div>
                        );
                      })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 px-1 text-[11.5px] text-fg-subtle">
          <span className="flex items-center gap-[6px]">
            <i className="h-[8px] w-[14px] rounded-[3px] bg-fg-muted" />
            {t("cal.due")}
          </span>
          <span className="flex items-center gap-[6px]">
            <i className="h-[8px] w-[14px] rounded-[3px] border border-dashed border-fg-muted" />
            {t("cal.reminder")}
          </span>
          <span className="ml-auto">{t("cal.hint")}</span>
        </div>
      </div>

      <aside className="flex min-w-[260px] flex-[0_1_290px] flex-col gap-4">
        <section className="flex flex-col gap-2 rounded-[20px] border border-border bg-surface p-[18px] shadow-card">
          <h2 className="font-display text-[17px] font-bold">{t("cal.upcoming")}</h2>
          {upcoming.length === 0 && (
            <p className="text-[12.5px] text-fg-subtle">{t("cal.nothing")}</p>
          )}
          {upcoming.map((i) => {
            const n = diffDays(today, i.day);
            return (
              <Link
                key={i.id}
                href={href(i.id)}
                onClick={() => playSound("click")}
                className="flex items-center gap-3 rounded-[12px] px-1 py-[6px] transition-colors hover:bg-sunk"
              >
                <span className="num flex w-[38px] flex-none flex-col items-center rounded-[10px] bg-sunk py-[5px] leading-none">
                  <b className="text-[15px]">{Number(i.day.slice(8))}</b>
                  <span className="mt-[2px] text-[8.5px] tracking-[0.06em] text-fg-subtle uppercase">
                    {fmt(i.day, { month: "short" })}
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="truncate text-[13px] font-semibold">{i.title}</span>
                  <span className="flex items-center gap-[5px] truncate text-[11px] text-fg-subtle">
                    <i
                      className="size-[6px] flex-none rounded-full"
                      style={{ background: colorOf(i.projectId) }}
                    />
                    {i.kind === "due"
                      ? t("cal.due")
                      : `${t("cal.reminder")}${i.time ? ` ${i.time}` : ""}`}
                    {" · "}
                    {(i.projectId && byId.get(i.projectId)?.title) || t("cal.noProject")}
                  </span>
                </span>
                <span
                  className={cn(
                    "num flex-none text-[10.5px]",
                    n <= 3 ? "text-accent-ink" : "text-fg-subtle",
                  )}
                >
                  {rel(i.day)}
                </span>
              </Link>
            );
          })}
        </section>

        <section className="flex flex-col gap-1 rounded-[20px] border border-border bg-surface p-[18px] shadow-card">
          <h2 className="mb-1 font-display text-[17px] font-bold">{t("cal.shown")}</h2>
          {projects.map((p) => {
            const on = !hidden.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  playSound("click");
                  setHidden((h) => {
                    const next = new Set(h);
                    if (on) next.add(p.id);
                    else next.delete(p.id);
                    return next;
                  });
                }}
                className={cn(
                  "flex items-center gap-[10px] rounded-[8px] px-1 py-[7px] text-left text-[13px] transition-opacity",
                  on ? "opacity-100" : "opacity-40",
                )}
              >
                <i
                  className="size-3 flex-none rounded-[4px]"
                  style={{ background: projectColor(p.color, p.id) }}
                />
                {p.title}
              </button>
            );
          })}
        </section>
      </aside>
    </div>
  );
}
