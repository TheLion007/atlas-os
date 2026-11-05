"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useProgress } from "@/client/hooks";
import { Mascot } from "@/design/Mascot";
import { projectColor } from "@/design/palette";
import type { ApiEdge, ApiObject } from "@/domain/api-types";
import { diffDays } from "@/domain/dates";
import { focusMinutes, formatFocus } from "@/domain/focus";
import { addDays, streaks, weekdayOf, yearGrid } from "@/domain/history";
import { descendantsOf, projectCards, type ProjectCard } from "@/domain/project-view";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { useFeedback } from "@/lib/feedback/celebrate";
import { usePrefs } from "@/lib/feedback/prefs";
import { useTimer } from "@/lib/timer-store";
import { useCountUp } from "@/lib/use-count-up";
import { HeatGrid } from "../project/HeatGrid";
import { useTaskStatus } from "../project/useTaskStatus";
import {
  clock,
  useFraction,
  useRemaining,
  useTimerActions,
  useTimerTarget,
} from "../timer/use-timer";
import { historyHref } from "../lenses/HistoryLens";
import { hrefKeepingState } from "../shell/nav";
import { useUi } from "../shell/ui-store";

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const tint = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;

const due = (n: ApiObject): string | null => {
  const v = n.details?.due ?? n.details?.date;
  return typeof v === "string" && v ? v : null;
};

const QUICK_ICONS = {
  project: "M12 5v14M5 12h14",
  task: "M4 5h16v14H4zM8 12l3 3 5-6",
  note: "M6 3h9l4 4v14H6zM15 3v4h4M9 13h6",
  timer: "M8 5v14l11-7z",
} as const;

function Icon24({ d, size = 16, stroke = 2 }: { d: string; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

function Kpi({
  label,
  value,
  suffix = "",
  delta,
  deltaClass,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  delta?: string;
  deltaClass?: string;
}) {
  const counted = useCountUp(typeof value === "number" ? value : 0);
  const shown = typeof value === "number" ? counted : value;
  return (
    <div className="-mr-px flex flex-col gap-2 border-r border-border px-[22px] py-[18px]">
      <span className="text-[12.5px] text-fg-muted">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[32px] leading-none font-bold tracking-[-0.03em]">
          {shown}
          {suffix}
        </span>
        {delta && (
          <span className={cn("num text-[11px]", deltaClass ?? "text-fg-subtle")}>{delta}</span>
        )}
      </div>
    </div>
  );
}

interface HomeScreenProps {
  nodes: readonly ApiObject[];
  edges: readonly ApiEdge[];
  today: string;
}

/**
 * Home, as designed: the mascot and a greeting with four quick actions, a strip of key figures,
 * the projects in progress as cards, today's tasks to tick, the week's bars, the nearest
 * deadlines and the Work History strip. Everything reads the real graph and the progress
 * journal; every element leads somewhere real.
 */
export function HomeScreen({ nodes, edges, today }: HomeScreenProps) {
  const { t, f, locale } = useI18n();
  const params = useSearchParams();
  const openCreate = useUi((s) => s.openCreate);
  const journal = useProgress(180);
  const { setStatus, pending } = useTaskStatus();
  const router = useRouter();
  const timerActions = useTimerActions();
  const timerTarget = useTimerTarget();
  const timer = useTimer((st) => st.timer);
  const sessions = useTimer((st) => st.sessions);
  const timerLeft = useRemaining();
  const timerFrac = useFraction();
  const mood = useFeedback((s) => s.mood);
  const mascot = usePrefs((s) => s.mascot);
  const tracks = usePrefs((s) => s.mascotTracks);
  const mascotOn = usePrefs((s) => s.mascotOn);
  const [leaving, setLeaving] = useState<ApiObject[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((id) => window.clearTimeout(id));
  }, []);

  const href = (path: string) => hrefKeepingState(path, params);
  const entries = useMemo(() => journal.data ?? [], [journal.data]);
  const cards = useMemo(() => projectCards(nodes, edges, today), [nodes, edges, today]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Which project each object counts for, to colour and name tasks and deadlines.
  const projectOf = useMemo(() => {
    const map = new Map<string, ApiObject>();
    for (const p of nodes) {
      if (p.type !== "project") continue;
      for (const id of descendantsOf(p.id, edges)) map.set(id, p);
    }
    return map;
  }, [nodes, edges]);

  const open = useMemo(
    () =>
      nodes
        .filter((n) => n.type === "task" && (n.status === "draft" || n.status === "active"))
        .sort((a, b) => {
          const da = due(a);
          const db = due(b);
          if (da && db) return da < db ? -1 : da > db ? 1 : 0;
          return da ? -1 : db ? 1 : a.createdAt < b.createdAt ? -1 : 1;
        }),
    [nodes],
  );
  const dueNow = open.filter((n) => (due(n) ?? "9999") <= today);
  const weekStart = addDays(today, -weekdayOf(today));
  const weekEntries = entries.filter((e) => e.day >= weekStart && e.day <= addDays(weekStart, 6));
  const doneToday = entries.filter((e) => e.day === today && e.kind === "task_done").length;

  const nextMilestone = nodes
    .filter((n) => n.type === "milestone" && n.status !== "done" && n.status !== "dropped")
    .map((n) => ({ n, d: due(n) }))
    .filter((x): x is { n: ApiObject; d: string } => !!x.d && x.d >= today)
    .sort((a, b) => (a.d < b.d ? -1 : 1))[0];
  const daysToMilestone = nextMilestone ? diffDays(today, nextMilestone.d) : null;

  const deadlines = nodes
    .filter(
      (n) =>
        (n.type === "milestone" || n.type === "task") &&
        n.status !== "done" &&
        n.status !== "dropped",
    )
    .map((n) => ({ n, d: due(n) }))
    .filter(
      (x): x is { n: ApiObject; d: string } => !!x.d && x.d >= today && diffDays(today, x.d) <= 14,
    )
    .sort((a, b) => (a.d < b.d ? -1 : 1));
  const lateTasks = open.filter((n) => (due(n) ?? "9999") < today).length;

  const avgProgress = cards.length
    ? Math.round((cards.reduce((s, c) => s + (c.progress ?? 0), 0) / cards.length) * 100)
    : 0;

  const finish = (task: ApiObject, box: HTMLElement) => {
    const r = box.getBoundingClientRect();
    setStatus(
      { id: task.id, title: task.title, due: due(task), status: task.status as "draft" | "active" },
      "done",
      { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      today,
    );
    setLeaving((l) => [...l, task]);
    timers.current.push(
      window.setTimeout(() => setLeaving((l) => l.filter((x) => x.id !== task.id)), 900),
    );
  };

  const leavingIds = new Set(leaving.map((l) => l.id));
  const todayRows = [...leaving, ...open.filter((o) => !leavingIds.has(o.id))].slice(0, 5);

  const sub =
    (dueNow.length === 0
      ? t("hm.subNone")
      : dueNow.length === 1
        ? t("hm.subOne")
        : t("hm.sub", { count: dueNow.length })) +
    (nextMilestone && daysToMilestone !== null
      ? ` ${
          daysToMilestone >= 14
            ? t("hm.subNext", {
                title: nextMilestone.n.title,
                weeks: Math.round(daysToMilestone / 7),
              })
            : t("hm.subNextDays", { title: nextMilestone.n.title, days: daysToMilestone })
        }`
      : "") +
    ` ${t("hm.subGo")}`;

  const rel = (days: number) =>
    days < 0
      ? t("hm.lateBy", { count: -days })
      : days === 0
        ? t("hm.today.short")
        : days === 1
          ? t("hm.tomorrow")
          : t("hm.inDays", { count: days });

  const weekBars = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i);
    return {
      day,
      count: entries.filter((e) => e.day === day).length,
      today: day === today,
      future: day > today,
    };
  });
  const weekMax = Math.max(1, ...weekBars.map((b) => b.count));
  const run = streaks(entries, today).current;
  const cellText = (c: { count: number; day: string }) =>
    c.count === 0
      ? t("hist.cell0", { day: f.date(c.day) })
      : c.count === 1
        ? t("hist.cell1", { day: f.date(c.day) })
        : t("hist.cell", { count: c.count, day: f.date(c.day) });

  const quick = [
    {
      id: "project",
      label: t("hm.quick.project"),
      key: "P",
      run: () => openCreate({ type: "project" }),
      bg: "var(--color-accent)",
      fg: "var(--color-on-accent)",
    },
    {
      id: "task",
      label: t("hm.quick.task"),
      key: "N",
      run: () => openCreate({ type: "task" }),
      bg: "var(--color-sunk)",
      fg: "var(--color-fg)",
    },
    {
      id: "note",
      label: t("hm.quick.note"),
      key: "Q",
      run: () => openCreate({ type: "note" }),
      bg: "var(--color-sunk)",
      fg: "var(--color-fg)",
    },
    {
      id: "timer",
      label: t("tm.startTimer"),
      key: "T",
      run: () => {
        router.push(href("/timer"));
        if (!useTimer.getState().timer.running) timerActions.toggle();
      },
      bg: "var(--color-sunk)",
      fg: "var(--color-fg)",
    },
  ] as const;

  const weekdayLetter = (day: string) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { weekday: "narrow", timeZone: "UTC" });

  return (
    <div className="mx-auto -my-4 flex max-w-[1300px] flex-col gap-[26px] px-4 pt-[30px] pb-[60px] md:-my-6 md:px-9">
      {/* Greeting, mascot and quick actions */}
      <div className="flex flex-wrap items-center gap-[26px]">
        {mascotOn && <Mascot kind={mascot} mood={mood} size={104} track={tracks} />}
        <div className="flex min-w-[280px] flex-1 flex-col gap-2">
          <span className="num text-[11px] font-semibold tracking-[0.09em] text-accent-ink uppercase">
            {new Date(`${today}T12:00:00Z`).toLocaleDateString(locale, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
          </span>
          <h1 className="font-display text-[46px] leading-none font-extrabold tracking-[-0.035em]">
            {t("hm.hello")}
          </h1>
          <p className="max-w-[560px] text-base leading-[1.45] text-fg-muted">{sub}</p>
        </div>
        <div className="grid max-w-[460px] flex-[1_1_360px] grid-cols-2 gap-2">
          {quick.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={a.run}
              className="flex items-center gap-[10px] rounded-[13px] border border-border bg-surface px-3 py-[11px] text-left shadow-card transition-[transform,box-shadow,border-color] duration-[400ms] ease-(--ease-spring) hover:-translate-y-[3px] hover:border-border-strong hover:shadow-pop active:scale-[0.96]"
            >
              <span
                className="grid size-[30px] flex-none place-items-center rounded-[9px]"
                style={{ background: a.bg, color: a.fg }}
              >
                <Icon24 d={QUICK_ICONS[a.id]} />
              </span>
              <span className="flex-1 text-[13.5px] font-semibold">{a.label}</span>
              <span className="num text-[10px] text-fg-subtle">{a.key}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Key figures */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] overflow-hidden rounded-[18px] border border-border bg-surface shadow-card">
        <Kpi label={t("hm.kpi.projects")} value={cards.length} />
        <Kpi
          label={t("hm.kpi.tasks")}
          value={open.length}
          delta={t("hm.kpi.tasksDelta", {
            count: weekEntries.filter((e) => e.kind === "task_done").length,
          })}
        />
        <Kpi
          label={t("hm.kpi.progress")}
          value={avgProgress}
          suffix=" %"
          delta={t("hm.kpi.progressDelta", { count: weekEntries.length })}
          deltaClass="text-positive"
        />
        <Kpi
          label={t("tm.focusTime")}
          value={formatFocus(focusMinutes(sessions, weekStart, addDays(weekStart, 6)))}
          delta={t("tm.thisWeek")}
        />
        <Kpi
          label={t("hm.kpi.deadlines")}
          value={deadlines.length}
          delta={lateTasks > 0 ? t("hm.kpi.late", { count: lateTasks }) : undefined}
          deltaClass="text-accent-ink"
        />
      </div>

      {/* Projects and today */}
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[1.75_1_460px] flex-col gap-[14px]">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-[21px] font-bold tracking-[-0.01em]">
              {t("hm.projectsTitle")}
            </h2>
            <Link
              href={href("/projects")}
              className="text-[13px] text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg"
            >
              {t("hm.seeProjects")}
            </Link>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-[14px]">
            {cards.slice(0, 6).map((c, i) => (
              <li
                key={c.id}
                className="rise-in"
                style={{ animationDelay: `${i * 70}ms`, animationFillMode: "backwards" }}
              >
                <HomeProjectCard card={c} href={href(`/objects/${c.id}`)} node={byId.get(c.id)} />
              </li>
            ))}
          </ul>
        </div>

        <section className="flex min-w-0 flex-[1_1_300px] flex-col gap-[6px] rounded-[18px] border border-border bg-surface px-[14px] pt-[18px] pb-3 shadow-card">
          <div className="flex items-baseline justify-between px-2 pb-[6px]">
            <h2 className="font-display text-[19px] font-bold">{t("hm.today")}</h2>
            <span className="num text-[11px] text-fg-subtle">
              {t("hm.todayCount", { done: doneToday, total: doneToday + dueNow.length })}
            </span>
          </div>
          {todayRows.length === 0 && (
            <p className="px-2 py-3 text-fg-muted">{t("hm.todayEmpty")}</p>
          )}
          {todayRows.map((task, index) => {
            const gone = leavingIds.has(task.id);
            const p = projectOf.get(task.id);
            const hex = p ? projectColor(p.color, p.id) : "var(--color-fg-subtle)";
            return (
              <div
                key={task.id}
                style={{
                  animation: `rise-in 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) ${index * 60}ms backwards`,
                }}
                className={cn(
                  "flex items-center gap-3 rounded-[12px] px-2 py-[10px] transition-[background-color,opacity] duration-[400ms] hover:bg-sunk",
                  gone && "opacity-60",
                )}
              >
                <button
                  type="button"
                  data-sound="none"
                  aria-label={`${t("hm.finish")} : ${task.title}`}
                  disabled={pending || gone}
                  onClick={(e) => finish(task, e.currentTarget)}
                  className={cn(
                    "grid size-[23px] flex-none place-items-center rounded-[7px] border-[1.6px] p-0 transition-all duration-[350ms] hover:scale-[1.14] hover:border-accent active:scale-[0.8]",
                    gone ? "border-positive bg-positive" : "border-fg-subtle bg-transparent",
                  )}
                  style={{ transitionTimingFunction: SPRING }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 12.5l4.5 4.5L19 7.5"
                      strokeDasharray="22"
                      strokeDashoffset={gone ? 0 : 22}
                      style={{ transition: "stroke-dashoffset .35s ease .05s" }}
                    />
                  </svg>
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <Link
                    href={href(`/objects/${task.id}`)}
                    className={cn("truncate text-[14px] hover:underline", gone && "line-through")}
                  >
                    {task.title}
                  </Link>
                  <span className="flex items-center gap-[6px] text-[11.5px] text-fg-subtle">
                    <i className="size-[7px] rounded-[2px]" style={{ background: hex }} />
                    {p ? (
                      <Link href={href(`/objects/${p.id}`)} className="truncate hover:underline">
                        {p.title}
                      </Link>
                    ) : null}
                  </span>
                </div>
                <span className="num text-[10.5px] text-fg-subtle">
                  {due(task) ? f.date(due(task) as string) : ""}
                </span>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => openCreate({ type: "task" })}
            className="mt-1 flex items-center gap-[10px] rounded-[12px] border border-dashed border-border-strong bg-transparent px-2 py-[10px] text-[13px] text-fg-subtle transition-colors duration-(--duration-hover) hover:border-fg-subtle hover:text-fg"
          >
            <Icon24 d="M12 5v14M5 12h14" />
            {t("hm.addTask")}
            <span className="num ml-auto text-[10px]">N</span>
          </button>
        </section>
      </div>

      {/* The week and the deadlines */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-6">
        <section className="flex flex-col gap-4 rounded-[18px] border border-border bg-surface px-5 py-[18px] shadow-card">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-[17px] font-bold">{t("hm.thisWeek")}</h3>
            <span className="num text-[11px] text-fg-subtle">
              {t("hm.weekTotal", { count: weekEntries.length })}
            </span>
          </div>
          <div className="flex h-[140px] items-end gap-[10px]">
            {weekBars.map((b, i) => (
              <Link
                key={b.day}
                href={href(historyHref(b.day))}
                aria-label={cellText(b)}
                className="flex h-full flex-1 flex-col items-center justify-end gap-[7px]"
              >
                <span className="num text-[10.5px] text-fg-subtle">{b.future ? "" : b.count}</span>
                <span
                  className="w-full max-w-[30px] transition-transform duration-300 hover:scale-y-[1.04]"
                  style={{
                    height: `${Math.max(6, (b.count / weekMax) * 104)}px`,
                    background: b.today
                      ? "var(--color-accent)"
                      : b.future
                        ? "transparent"
                        : "var(--color-heat-1)",
                    border: b.future ? "1.5px dashed var(--color-border-strong)" : undefined,
                    borderRadius: "9px 9px 4px 4px",
                    transformOrigin: "bottom",
                    animation: `bar-grow 0.8s ${SPRING} ${i * 50}ms backwards`,
                  }}
                />
                <span
                  className={cn(
                    "text-[11.5px] font-semibold",
                    b.today ? "text-accent-ink" : "text-fg-subtle",
                  )}
                >
                  {weekdayLetter(b.day)}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-[10px] rounded-[18px] border border-border bg-surface px-5 py-[18px] shadow-card">
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-[17px] font-bold">{t("hm.deadlines")}</h3>
            <Link
              href={href("/timeline")}
              className="text-[12.5px] text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg"
            >
              {t("nav.timeline")} →
            </Link>
          </div>
          {deadlines.length === 0 && <p className="text-fg-muted">{t("hm.deadlinesEmpty")}</p>}
          {deadlines.slice(0, 4).map(({ n, d }) => {
            const p = projectOf.get(n.id) ?? (n.type === "project" ? n : undefined);
            const days = diffDays(today, d);
            const dt = new Date(`${d}T12:00:00Z`);
            return (
              <Link
                key={n.id}
                href={href(`/objects/${n.id}`)}
                className="-mx-2 flex items-center gap-3 rounded-[12px] px-2 py-[6px] transition-colors duration-(--duration-hover) hover:bg-sunk"
              >
                <span className="flex w-[42px] flex-none flex-col items-center rounded-[10px] bg-sunk py-[5px]">
                  <span className="font-display text-[17px] leading-none font-bold">
                    {dt.getUTCDate()}
                  </span>
                  <span className="num text-[9.5px] text-fg-subtle uppercase">
                    {dt.toLocaleDateString(locale, { month: "short", timeZone: "UTC" })}
                  </span>
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span className="truncate text-[13.5px] font-semibold">{n.title}</span>
                  <span className="flex items-center gap-[6px] text-[11.5px] text-fg-subtle">
                    <i
                      className="size-[7px] rounded-[2px]"
                      style={{
                        background: p ? projectColor(p.color, p.id) : "var(--color-fg-subtle)",
                      }}
                    />
                    {p?.title}
                  </span>
                </span>
                <span
                  className={cn(
                    "num text-[11px]",
                    days <= 2 ? "text-accent-ink" : "text-fg-subtle",
                  )}
                >
                  {rel(days)}
                </span>
              </Link>
            );
          })}
        </section>

        <section className="flex flex-col gap-3 rounded-[18px] bg-code px-5 py-[18px] text-code-ink shadow-card">
          <span className="num text-[10.5px] font-semibold tracking-[0.1em] text-code-ink/60 uppercase">
            {timer.mode === "break" ? t("tm.break") : t("tm.focus")}
          </span>
          <div className="flex items-center gap-4">
            <span className="relative grid size-[84px] flex-none place-items-center">
              <svg viewBox="0 0 84 84" className="absolute inset-0 -rotate-90" aria-hidden="true">
                <circle
                  cx="42"
                  cy="42"
                  r="38"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.15"
                  strokeWidth="6"
                />
                <circle
                  cx="42"
                  cy="42"
                  r="38"
                  fill="none"
                  stroke={timer.mode === "break" ? "var(--color-positive)" : "var(--color-accent)"}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 38}
                  strokeDashoffset={2 * Math.PI * 38 * (1 - timerFrac)}
                  style={{ transition: "stroke-dashoffset .9s linear" }}
                />
              </svg>
              <span className="num text-[16px] font-medium">{clock(timerLeft)}</span>
            </span>
            <p className="min-w-0 flex-1 font-display text-[17px] leading-[1.25] font-bold">
              {timer.mode === "break"
                ? t("tm.breakTask")
                : timerTarget.task || (timerTarget.projectId ? t("tm.freeWork") : t("tm.homeNone"))}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={timerActions.toggle}
              className="inline-flex h-9 items-center gap-2 rounded-[11px] bg-accent px-4 text-[13px] font-semibold text-on-accent transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-px active:scale-[0.95]"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d={
                    timer.running && timer.mode === "focus"
                      ? "M7 5h4v14H7zM13 5h4v14h-4z"
                      : "M8 5v14l11-7z"
                  }
                />
              </svg>
              {timer.mode === "break"
                ? t("tm.onBreak")
                : timer.running
                  ? t("tm.pause")
                  : t("tm.start")}
            </button>
            <Link
              href={href("/timer")}
              className="inline-flex h-9 items-center rounded-[11px] border border-code-ink/25 px-4 text-[13px] font-semibold transition-colors hover:bg-code-ink/10"
            >
              {t("tm.open")}
            </Link>
          </div>
        </section>
      </div>

      {/* Work history */}
      <section className="flex flex-wrap items-center gap-8 rounded-[18px] border border-border bg-surface px-[22px] py-5 shadow-card">
        <div className="flex min-w-[180px] flex-col gap-[6px]">
          <h3 className="font-display text-[17px] font-bold">{t("hm.history")}</h3>
          <span className="text-[13px] text-fg-muted">
            {t("hm.streak")} <b className="text-accent-ink">{t("hm.streakDays", { count: run })}</b>
          </span>
          <Link
            href={href(historyHref())}
            className="mt-[6px] self-start text-[12.5px] text-fg-muted transition-colors duration-(--duration-hover) hover:text-fg"
          >
            {t("hm.allHistory")}
          </Link>
        </div>
        <div className="min-w-0 flex-1">
          <HeatGrid
            grid={yearGrid(entries, today, 22)}
            size={15}
            gap={4}
            showMonths={false}
            showWeekdays={false}
            label={t("hist.gridLabel")}
            hrefFor={(day) => href(historyHref(day))}
            ariaFor={cellText}
            tip={(c) => <p className="font-semibold">{cellText(c)}</p>}
          />
        </div>
      </section>
    </div>
  );
}

function HomeProjectCard({
  card,
  href,
  node,
}: {
  card: ProjectCard;
  href: string;
  node: ApiObject | undefined;
}) {
  const { t, f } = useI18n();
  const hex = projectColor(card.color, card.id);
  const kind = typeof node?.details?.kind === "string" ? node.details.kind : "";
  const total = card.tasksOpen + card.tasksDone;
  const pct = card.progress === null ? 0 : Math.round(card.progress * 100);
  return (
    <Link
      href={href}
      className="relative flex h-full flex-col gap-[14px] overflow-hidden rounded-[18px] border border-border bg-surface p-[18px] text-left shadow-card transition-[transform,box-shadow,border-color] duration-500 ease-(--ease-spring) hover:-translate-y-[5px] hover:-rotate-[0.5deg] hover:border-border-strong hover:shadow-pop active:scale-[0.98]"
    >
      <div
        aria-hidden="true"
        className="absolute -top-[34px] -right-[34px] size-[104px] rounded-full"
        style={{ background: tint(hex, 14) }}
      />
      <div className="relative flex items-center justify-between">
        <span className="num flex items-center gap-[7px] text-[11px] text-fg-muted">
          <i className="size-[9px] rounded-[3px]" style={{ background: hex }} />
          {kind}
        </span>
        <span className="text-[11.5px] font-semibold text-fg-muted">
          {t(
            `hm.status.${card.status === "dropped" ? "draft" : card.status}` as "hm.status.active",
          )}
        </span>
      </div>
      <div className="relative min-h-[44px] font-display text-[19px] leading-[1.15] font-bold tracking-[-0.015em] text-balance">
        {card.title}
      </div>
      <div className="flex flex-col gap-[7px]">
        <div className="flex justify-between text-xs text-fg-muted">
          <span>
            {total === 0
              ? t("hm.noOpenTasks")
              : card.tasksOpen === 1
                ? t("hm.openTask")
                : t("hm.openTasks", { count: card.tasksOpen })}
          </span>
          <span className="num font-semibold text-fg">
            {card.progress === null ? "—" : `${pct}%`}
          </span>
        </div>
        <div className="h-[7px] overflow-hidden rounded-[7px] bg-sunk">
          <div
            className="h-full rounded-[7px] transition-[width] duration-[900ms]"
            style={{
              width: `${pct}%`,
              background: hex,
              transitionTimingFunction: "cubic-bezier(0.34, 1.3, 0.64, 1)",
            }}
          />
        </div>
      </div>
      <div className="mt-auto flex justify-between text-xs text-fg-subtle">
        <span>
          {card.targetDate ? t("hm.due", { date: f.date(card.targetDate) }) : t("proj.noDate")}
        </span>
        <span>
          {card.subProjects.length === 0
            ? t("hm.noSubs")
            : card.subProjects.length === 1
              ? t("hm.sub1")
              : t("hm.subs", { count: card.subProjects.length })}
        </span>
      </div>
    </Link>
  );
}
