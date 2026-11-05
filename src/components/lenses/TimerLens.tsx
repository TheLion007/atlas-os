"use client";

import { useMemo } from "react";
import { useGraph, useProgress } from "@/client/hooks";
import { useSource } from "@/client/provider";
import { focusMinutes, formatFocus, monthCells, monthLevel } from "@/domain/focus";
import { breakMinutes, MAX_MINUTES, MIN_MINUTES, PRESETS } from "@/domain/timer";
import { Mascot } from "@/design/Mascot";
import { projectColor } from "@/design/palette";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { useFeedback } from "@/lib/feedback/celebrate";
import { usePrefs } from "@/lib/feedback/prefs";
import { playSound } from "@/lib/feedback/sound";
import { useTimer } from "@/lib/timer-store";
import {
  clock,
  useFraction,
  useRemaining,
  useTimerActions,
  useTimerTarget,
} from "../timer/use-timer";

const R = 150;
const C = 2 * Math.PI * R;
const LEVEL_BG = ["bg-heat-0", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4"] as const;

const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The Timer, as in the design: a ring, three lengths and a custom one, the project and task you
 * are working on, and beside it the day's sessions and the month's review. The countdown is kept
 * by the app (see `TimerEngine`), so it goes on when you leave this screen.
 */
export function TimerLens() {
  const { t, locale } = useI18n();
  const graph = useGraph();
  const progress = useProgress(62);
  const source = useSource();
  const timer = useTimer((s) => s.timer);
  const sessions = useTimer((s) => s.sessions);
  const breaks = useTimer((s) => s.breaks);
  const setMinutes = useTimer((s) => s.setMinutes);
  const setProject = useTimer((s) => s.setProject);
  const setTask = useTimer((s) => s.setTask);
  const actions = useTimerActions();
  const target = useTimerTarget();
  const left = useRemaining();
  const frac = useFraction();
  const kind = usePrefs((s) => s.mascot);
  const tracks = usePrefs((s) => s.mascotTracks);
  const mood = useFeedback((s) => s.mood);
  const today = source?.today() ?? localDay();
  const day = localDay();
  const onBreak = timer.mode === "break";
  const busy = timer.running || onBreak;

  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const colorOf = (id: string | null) => {
    const p = id ? byId.get(id) : undefined;
    return p ? projectColor(p.color, p.id) : "var(--color-fg-subtle)";
  };
  const project = target.projectId ? byId.get(target.projectId) : undefined;

  const entries = useMemo(() => progress.data ?? [], [progress.data]);
  const month = today.slice(0, 7);
  const advancesToday = entries.filter((e) => e.day === today).length;
  const perDay = new Map<string, number>();
  for (const e of entries) {
    if (e.day.startsWith(month)) perDay.set(e.day, (perDay.get(e.day) ?? 0) + 1);
  }
  const monthTotal = [...perDay.values()].reduce((a, b) => a + b, 0);
  const todaySessions = sessions.filter((s) => s.day === day);
  const dayMinutes = focusMinutes(sessions, day, day);
  const monthMinutes = focusMinutes(sessions, `${month}-01`, `${month}-31`);
  const wins = nodes
    .filter((n) => n.type === "task" && n.status === "done" && n.updatedAt.slice(0, 7) === month)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, 4);
  const monthName = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(
    new Date(`${today}T12:00:00Z`),
  );
  const dayLabel = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());
  const dows = ["L", "M", "M", "J", "V", "S", "D"];

  const label = onBreak ? t("tm.break") : timer.running ? t("tm.focusRunning") : t("tm.focus");
  const taskLine = onBreak ? t("tm.breakTask") : target.task || t("tm.freeWork");
  const ringColor = onBreak ? "var(--color-positive)" : "var(--color-accent)";
  const mainLabel = onBreak
    ? t("tm.onBreak")
    : timer.running
      ? t("tm.pause")
      : left < timer.minutes * 60_000 - 500
        ? t("tm.resume")
        : t("tm.start");
  const say = onBreak ? t("tm.sayBreak") : timer.running ? t("tm.sayGo") : t("tm.sayIdle");
  const round =
    "grid size-12 place-items-center rounded-full border border-border-strong bg-surface transition-transform duration-300 ease-(--ease-spring) active:scale-90";
  const field =
    "h-10 w-full rounded-[11px] border border-border-strong bg-surface px-3 text-[13px] outline-none! focus-visible:border-accent disabled:opacity-60";

  return (
    <div className="mx-auto -my-4 flex max-w-[1100px] flex-wrap items-start gap-[22px] px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9">
      <section
        aria-label={t("nav.timer")}
        className="flex min-w-[320px] flex-[1_1_480px] flex-col items-center gap-5 rounded-[26px] border border-border bg-surface p-7 shadow-card"
      >
        <div className="flex w-full items-center gap-3">
          <Mascot kind={kind} mood={mood} size={46} track={tracks} />
          <p className="rounded-[14px] bg-sunk px-[14px] py-[10px] text-[13px] leading-[1.45] text-fg-muted">
            {say}
          </p>
        </div>

        <div className="relative size-[330px] max-w-full">
          <svg viewBox="0 0 340 340" className="size-full -rotate-90" aria-hidden="true">
            <circle
              cx="170"
              cy="170"
              r={R}
              fill="none"
              stroke="var(--color-sunk)"
              strokeWidth="16"
            />
            <circle
              cx="170"
              cy="170"
              r={R}
              fill="none"
              stroke={ringColor}
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
              style={{ transition: "stroke-dashoffset .9s linear, stroke .4s" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <span
              className="num text-[11px] font-semibold tracking-[0.1em] uppercase"
              style={{ color: ringColor }}
            >
              {label}
            </span>
            <span
              role="timer"
              aria-live="off"
              className="num text-[72px] leading-none font-medium tracking-[-0.03em]"
            >
              {clock(left)}
            </span>
            <span className="flex max-w-[220px] items-center gap-2 text-[12.5px] text-fg-muted">
              {!onBreak && (
                <i
                  className="size-2 flex-none rounded-full"
                  style={{ background: colorOf(target.projectId) }}
                />
              )}
              <span className="truncate">
                {onBreak ? taskLine : (project?.title ?? t("tm.noProject"))}
              </span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            title={t("tm.reset")}
            aria-label={t("tm.reset")}
            onClick={actions.reset}
            className={cn(round, "hover:-rotate-[60deg]")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={actions.toggle}
            className="inline-flex h-14 items-center gap-3 rounded-full bg-accent px-8 text-[16px] font-semibold text-on-accent shadow-glow transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-[3px] hover:scale-[1.03] active:scale-[0.94]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path
                d={timer.running && !onBreak ? "M7 5h4v14H7zM13 5h4v14h-4z" : "M8 5v14l11-7z"}
              />
            </svg>
            {mainLabel}
            <span className="num rounded-[5px] bg-on-accent/20 px-[6px] py-px text-[10.5px]">
              T
            </span>
          </button>
          <button
            type="button"
            title={t("tm.finish")}
            aria-label={t("tm.finish")}
            onClick={actions.finish}
            className={cn(round, "hover:scale-110")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </button>
        </div>

        <div className="flex w-full flex-wrap items-stretch gap-3">
          {PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              disabled={busy}
              aria-pressed={timer.minutes === m}
              onClick={() => {
                playSound("click");
                setMinutes(m);
              }}
              className={cn(
                "flex min-w-[88px] flex-1 flex-col items-center gap-[2px] rounded-[14px] border px-3 py-3 transition-[transform,background-color] duration-300 ease-(--ease-spring) hover:-translate-y-[2px] disabled:opacity-60 disabled:hover:translate-y-0",
                timer.minutes === m ? "border-fg bg-fg text-bg" : "border-border-strong bg-surface",
              )}
            >
              <span className="text-[15px] font-bold">{t("tm.minutes", { count: m })}</span>
              <span
                className={cn("text-[11px]", timer.minutes === m ? "text-bg/70" : "text-fg-subtle")}
              >
                {t("tm.breakOf", { count: breakMinutes(m) })}
              </span>
            </button>
          ))}
          <label className="flex min-w-[150px] flex-[1.3] flex-col justify-center gap-1 rounded-[14px] border border-dashed border-border-strong px-3 py-2 text-[11.5px] text-fg-muted">
            {t("tm.custom", { count: timer.minutes })}
            <input
              type="range"
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              step={5}
              value={timer.minutes}
              disabled={busy}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="accent-accent disabled:opacity-60"
            />
          </label>
        </div>

        <div className="grid w-full gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12px] text-fg-muted">
            {t("tm.project")}
            <select
              className={field}
              disabled={busy}
              value={target.projectId ?? ""}
              onChange={(e) => {
                playSound("click");
                setProject(e.target.value, null);
              }}
            >
              {target.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-fg-muted">
            {t("tm.task")}
            <select
              className={field}
              disabled={busy}
              value={target.task}
              onChange={(e) => {
                playSound("click");
                setTask(e.target.value);
              }}
            >
              {target.tasks.map((x) => (
                <option key={x.id} value={x.title}>
                  {x.title}
                </option>
              ))}
              <option value="">{t("tm.freeWork")}</option>
            </select>
          </label>
        </div>
      </section>

      <div className="flex min-w-[280px] flex-[1_1_340px] flex-col gap-[22px]">
        <section className="flex flex-col gap-4 rounded-[22px] border border-border bg-surface p-5 shadow-card">
          <header className="flex items-baseline justify-between">
            <h2 className="font-display text-[19px] font-bold">{t("tm.day")}</h2>
            <span className="num text-[11.5px] text-fg-subtle">{dayLabel}</span>
          </header>
          <dl className="grid grid-cols-4 gap-2">
            {(
              [
                [String(todaySessions.length), t("tm.sessions")],
                [formatFocus(dayMinutes), t("tm.focused")],
                [String(advancesToday), t("tm.advances")],
                [String(breaks[day] ?? 0), t("tm.breaks")],
              ] as const
            ).map(([v, l]) => (
              <div key={l} className="flex flex-col gap-[2px] rounded-[12px] bg-sunk px-3 py-2">
                <dd className="num order-1 text-[17px] font-semibold">{v}</dd>
                <dt className="order-2 text-[10.5px] leading-tight text-fg-subtle">{l}</dt>
              </div>
            ))}
          </dl>
          {todaySessions.length === 0 ? (
            <p className="text-[12.5px] text-fg-subtle">{t("tm.noSession")}</p>
          ) : (
            <ul className="flex flex-col">
              {todaySessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 border-t border-border py-[9px] first:border-t-0"
                >
                  <span className="num w-[78px] flex-none text-[11px] text-fg-subtle">
                    {s.from}–{s.to}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-[12.5px] font-semibold">
                      {s.task || t("tm.freeWork")}
                    </span>
                    <span className="h-[5px] rounded-full bg-sunk">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.min(100, (s.minutes / 90) * 100)}%`,
                          background: colorOf(s.projectId),
                        }}
                      />
                    </span>
                  </span>
                  <span className="num w-9 flex-none text-right text-[11.5px] text-fg-subtle">
                    {s.minutes}′
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-[22px] border border-border bg-surface p-5 shadow-card">
          <header className="flex items-baseline justify-between">
            <h2 className="font-display text-[19px] font-bold">
              {monthName.charAt(0).toUpperCase() + monthName.slice(1)}
            </h2>
            <span className="text-[11.5px] text-fg-subtle">{t("tm.monthly")}</span>
          </header>
          <div className="flex gap-5">
            <div className="grid grid-cols-7 gap-[5px]" role="img" aria-label={t("tm.month")}>
              {dows.map((d, i) => (
                <span key={i} className="num text-center text-[9.5px] text-fg-subtle">
                  {d}
                </span>
              ))}
              {monthCells(today).map((d, i) =>
                d === null ? (
                  <span key={`p${i}`} />
                ) : (
                  <span
                    key={d}
                    title={t("tm.advancesOn", { count: perDay.get(d) ?? 0, day: d.slice(8) })}
                    className={cn(
                      "num grid size-[24px] place-items-center rounded-[7px] text-[9.5px] transition-transform hover:scale-125",
                      LEVEL_BG[monthLevel(perDay.get(d) ?? 0)],
                      monthLevel(perDay.get(d) ?? 0) >= 3 ? "text-on-accent" : "text-fg-muted",
                      d === today && "outline-2 outline-accent",
                    )}
                  >
                    {Number(d.slice(8))}
                  </span>
                ),
              )}
            </div>
            <dl className="flex flex-col gap-3">
              {(
                [
                  [String(monthTotal), t("tm.advances")],
                  [
                    `${perDay.size} / ${new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()}`,
                    t("tm.activeDays"),
                  ],
                  [formatFocus(monthMinutes), t("tm.focused")],
                ] as const
              ).map(([v, l]) => (
                <div key={l} className="flex flex-col">
                  <dd className="num text-[20px] leading-none font-semibold">{v}</dd>
                  <dt className="text-[11px] text-fg-subtle">{l}</dt>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className="num text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
              {t("tm.done")}
            </span>
            {wins.length === 0 && (
              <p className="text-[12.5px] text-fg-subtle">{t("tm.nothingDone")}</p>
            )}
            {wins.map((w) => (
              <p key={w.id} className="flex items-center gap-2 text-[13px]">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-positive)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                {w.title}
              </p>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
