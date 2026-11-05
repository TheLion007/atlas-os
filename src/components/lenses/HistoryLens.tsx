"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { describeError, useGraph, useProgress } from "@/client/hooks";
import { useSource } from "@/client/provider";
import { projectColor } from "@/design/palette";
import type { ApiObject, ProgressEntry } from "@/domain/api-types";
import {
  activeDays,
  bestDay,
  bestWeek,
  byProject,
  entriesOn,
  streaks,
  yearGrid,
  type GridCell,
} from "@/domain/history";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { HeatGrid, LEVEL_BG } from "../project/HeatGrid";
import { ProgressBar } from "../project/ProjectCardView";
import { hrefKeepingState } from "../shell/nav";
import { Icon } from "../ui/Icon";
import { ErrorState, LoadingState } from "../ui/states";

const WEEKS = 53;
const DAYS = WEEKS * 7 + 7;

/** The shape of a link back to this screen with a day and/or a project selected. */
export const historyHref = (day?: string | null, project?: string | null): string => {
  const q = new URLSearchParams();
  if (project) q.set("project", project);
  if (day) q.set("day", day);
  const s = q.toString();
  return s ? `/history?${s}` : "/history";
};

/**
 * The Work History: a year of days as squares (darker where more happened), a day's detail with
 * every advance leading to its object, streaks and records, how the work spreads over projects,
 * and the latest advances. It reads the progress journal; picking a day or a project is kept in
 * the address so a link reproduces the view (and the Home bars lead here).
 */
export function HistoryLens() {
  const { t, f, locale } = useI18n();
  const graph = useGraph();
  const source = useSource();
  const journal = useProgress(DAYS);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = source?.today() ?? new Date().toISOString().slice(0, 10);

  const day = params.get("day");
  const projectId = params.get("project");
  const go = (nextDay: string | null, nextProject: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (nextDay) q.set("day", nextDay);
    else q.delete("day");
    if (nextProject) q.set("project", nextProject);
    else q.delete("project");
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const entries = useMemo(() => journal.data ?? [], [journal.data]);
  const byId = useMemo(
    () => new Map<string, ApiObject>((graph.data?.nodes ?? []).map((n) => [n.id, n])),
    [graph.data],
  );
  const projects = useMemo(
    () =>
      (graph.data?.nodes ?? [])
        .filter((n) => n.type === "project" && n.status !== "dropped")
        .sort((a, b) => a.title.localeCompare(b.title)),
    [graph.data],
  );

  const grid = useMemo(
    () => yearGrid(entries, today, WEEKS, projectId),
    [entries, today, projectId],
  );
  const since = grid.columns[0]?.[0]?.day ?? today;
  const scoped = useMemo(
    () => entries.filter((e) => (!projectId || e.projectId === projectId) && e.day >= since),
    [entries, projectId, since],
  );
  const run = useMemo(() => streaks(scoped, today), [scoped, today]);
  const best = useMemo(() => bestDay(scoped), [scoped]);
  const week = useMemo(() => bestWeek(scoped), [scoped]);
  const spread = useMemo(
    () =>
      byProject(
        entries.filter((e) => e.day >= since),
        undefined,
      ),
    [entries, since],
  );
  const spreadMax = Math.max(1, ...spread.map((s) => s.count));
  const spreadTotal = spread.reduce((n, s) => n + s.count, 0);
  const detail = useMemo(
    () => (day ? entriesOn(entries, day, projectId) : []),
    [entries, day, projectId],
  );
  const feed = useMemo(
    () =>
      [...scoped].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id)).slice(0, 12),
    [scoped],
  );

  const href = (id: string) => hrefKeepingState(`/objects/${id}`, params);
  const projectName = (id: string | null) =>
    id ? (byId.get(id)?.title ?? t("hist.objectGone")) : t("hist.noProject");
  const colorOf = (id: string | null) =>
    id ? projectColor(byId.get(id)?.color, id) : "var(--color-fg-subtle)";

  const count = (n: number) => (n === 1 ? t("hist.advance1") : t("hist.advances", { count: n }));
  const dayCount = (n: number) => (n === 1 ? t("hist.day1") : t("hist.days", { count: n }));
  const cellText = (c: GridCell) =>
    c.count === 0
      ? t("hist.cell0", { day: f.date(c.day) })
      : c.count === 1
        ? t("hist.cell1", { day: f.date(c.day) })
        : t("hist.cell", { count: c.count, day: f.date(c.day) });

  if (graph.isPending || journal.isPending)
    return <LoadingState label={t("hist.title")} lines={5} />;
  if (graph.isError || journal.isError) {
    const { title, message } = describeError(graph.error ?? journal.error, t);
    return (
      <ErrorState
        title={title}
        message={message}
        onRetry={() => {
          void graph.refetch();
          void journal.refetch();
        }}
      />
    );
  }

  const entryRow = (e: ProgressEntry, withDay: boolean) => {
    const obj = e.objectId ? byId.get(e.objectId) : undefined;
    return (
      <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="label w-32 shrink-0">{t(`hist.kind.${e.kind}`)}</span>
        {obj ? (
          <Link
            href={href(obj.id)}
            aria-label={t("hist.openObject", { title: obj.title })}
            className="min-w-0 truncate font-medium hover:underline"
          >
            {obj.title}
          </Link>
        ) : (
          <span className="text-fg-muted">{t("hist.objectGone")}</span>
        )}
        {e.projectId && byId.get(e.projectId) ? (
          <Link
            href={href(e.projectId)}
            className="inline-flex items-center gap-2 rounded-full border border-border px-2 py-1 text-xs text-fg-muted transition-colors duration-(--duration-hover) hover:bg-hover hover:text-fg"
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ background: colorOf(e.projectId) }}
            />
            {projectName(e.projectId)}
          </Link>
        ) : (
          <span className="text-xs text-fg-subtle">{t("hist.noProject")}</span>
        )}
        {withDay && (
          <Link
            href={historyHref(e.day, projectId)}
            aria-label={t("hist.openDay", { day: f.date(e.day) })}
            className="num ml-auto text-xs text-fg-muted hover:text-fg hover:underline"
          >
            {f.date(e.day)}
          </Link>
        )}
      </li>
    );
  };

  // Advances per calendar month over the last twelve, the latest in the accent.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (11 - i));
    const key = d.toISOString().slice(0, 7);
    return {
      key,
      label: d.toLocaleDateString(locale, { month: "short", timeZone: "UTC" }).replace(".", ""),
      n: scoped.filter((e) => e.day.startsWith(key)).length,
    };
  });
  const monthMax = Math.max(1, ...months.map((m) => m.n));
  const perActiveDay = scoped.length / Math.max(1, activeDays(scoped));
  const share = (n: number) => Math.round((n / Math.max(1, spreadTotal)) * 100);
  const nowMs = new Date(`${today}T23:59:59Z`).getTime();
  const when = (e: ProgressEntry) => {
    const days = Math.round((nowMs - Date.parse(e.at)) / 86_400_000);
    return days <= 0 ? f.ago(e.at, new Date(nowMs)) : f.date(e.day);
  };
  const chip = (on: boolean) =>
    cn(
      "flex items-center gap-2 rounded-full border px-3 py-[6px] text-[12.5px] font-semibold transition-[background-color,transform] duration-200 hover:-translate-y-px",
      on ? "border-fg bg-fg text-bg" : "border-border-strong bg-surface hover:bg-sunk",
    );
  const card = "rounded-[20px] border border-border bg-surface p-5 shadow-card";

  return (
    <div className="mx-auto -my-4 flex max-w-[1100px] flex-col gap-5 px-4 pt-[26px] pb-[60px] md:-my-6 md:px-8">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-[40px] leading-none font-extrabold tracking-[-0.03em]">
          {t("hist.title")}
        </h1>
        <p className="text-[14px] text-fg-muted">{t("hist.sub")}</p>
      </div>

      <div role="group" aria-label={t("hist.project")} className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={!projectId}
          onClick={() => go(day, null)}
          className={chip(!projectId)}
        >
          <i className="size-2 rounded-full bg-fg-subtle" />
          {t("hist.allProjects")}
        </button>
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={projectId === p.id}
            onClick={() => go(day, projectId === p.id ? null : p.id)}
            className={chip(projectId === p.id)}
          >
            <i className="size-2 rounded-full" style={{ background: colorOf(p.id) }} />
            {p.title}
          </button>
        ))}
      </div>

      <section className={card}>
        <HeatGrid
          grid={grid}
          label={t("hist.gridLabel")}
          selectedDay={day}
          onPick={(d) => go(d === day ? null : d, projectId)}
          ariaFor={cellText}
          tip={(c) => (
            <div className="flex flex-col gap-1">
              <p className="font-semibold">{cellText(c)}</p>
              {Object.entries(
                entriesOn(entries, c.day, projectId).reduce<Record<string, number>>((acc, e) => {
                  const k = e.projectId ?? "";
                  acc[k] = (acc[k] ?? 0) + 1;
                  return acc;
                }, {}),
              ).map(([pid, n]) => (
                <p key={pid} className="flex items-center gap-2 text-fg-muted">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ background: colorOf(pid || null) }}
                  />
                  {projectName(pid || null)} · {n}
                </p>
              ))}
            </div>
          )}
        />
        <div className="mt-3 flex items-center justify-between text-[11.5px] text-fg-subtle">
          <span>{t("hist.hover")}</span>
          <span className="flex items-center gap-[6px]">
            {t("hist.less")}
            {[0, 1, 2, 3, 4].map((l) => (
              <span
                key={l}
                aria-hidden="true"
                className={cn(
                  "inline-block size-3 rounded-[3px]",
                  LEVEL_BG[l as 0 | 1 | 2 | 3 | 4],
                )}
              />
            ))}
            {t("hist.more")}
          </span>
        </div>
      </section>

      {day && (
        <section aria-label={t("hist.detail", { day: f.date(day) })} className={card}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-[17px] font-bold">
              {t("hist.detail", { day: f.date(day) })}
            </h2>
            <button
              type="button"
              onClick={() => go(null, projectId)}
              aria-label={t("common.close")}
              className="inline-flex size-7 items-center justify-center rounded-[9px] text-fg-muted transition-colors hover:bg-sunk hover:text-fg"
            >
              <Icon name="close" />
            </button>
          </div>
          {detail.length === 0 ? (
            <p className="text-[13px] text-fg-subtle">{t("hist.detailEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">{detail.map((e) => entryRow(e, false))}</ul>
          )}
        </section>
      )}

      <section aria-label={t("hist.stats")} className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {(
          [
            [String(scoped.length), t("hist.stat.year"), ""],
            [dayCount(run.current), t("hist.stat.current"), "text-accent-ink"],
            [dayCount(run.longest), t("hist.stat.longest"), ""],
            [
              perActiveDay.toFixed(1).replace(".", locale === "fr" ? "," : "."),
              t("hist.stat.perDay"),
              "",
            ],
          ] as const
        ).map(([v, l, c]) => (
          <div
            key={l}
            className="flex flex-col gap-1 rounded-[16px] border border-border bg-surface px-5 py-4 shadow-card"
          >
            <span
              className={cn(
                "font-display text-[34px] leading-none font-extrabold tracking-[-0.03em]",
                c,
              )}
            >
              {v}
            </span>
            <span className="text-[12.5px] text-fg-muted">{l}</span>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <section className={card}>
            <h2 className="mb-4 font-display text-[19px] font-bold">{t("hist.spread")}</h2>
            {spread.length === 0 ? (
              <p className="text-[13px] text-fg-subtle">{t("hist.spreadEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {spread.map((sp) => {
                  const active = projectId === sp.projectId;
                  return (
                    <li key={sp.projectId ?? "none"}>
                      <button
                        type="button"
                        disabled={sp.projectId === null}
                        aria-pressed={active}
                        onClick={() => go(day, active ? null : sp.projectId)}
                        className={cn(
                          "flex w-full flex-col gap-[6px] rounded-[10px] px-1 py-1 text-left transition-colors enabled:hover:bg-sunk",
                          active && "bg-sunk",
                        )}
                      >
                        <span className="flex items-center gap-2 text-[13px]">
                          <i
                            className="size-2 rounded-full"
                            style={{ background: colorOf(sp.projectId) }}
                          />
                          <span className="min-w-0 flex-1 truncate font-semibold">
                            {projectName(sp.projectId)}
                          </span>
                          <span className="num text-[11px] text-fg-subtle">
                            {sp.count} · {share(sp.count)} %
                          </span>
                        </span>
                        <ProgressBar
                          value={sp.count / spreadMax}
                          color={colorOf(sp.projectId)}
                          label={`${projectName(sp.projectId)} · ${count(sp.count)}`}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className={card}>
            <h2 className="mb-4 font-display text-[19px] font-bold">{t("hist.monthly")}</h2>
            <div className="flex h-[150px] items-end gap-[10px]">
              {months.map((m, i) => (
                <div
                  key={m.key}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-[6px]"
                >
                  <span className="num text-[10.5px] text-fg-subtle">{m.n}</span>
                  <span
                    title={`${m.key} · ${count(m.n)}`}
                    className={cn(
                      "w-full rounded-[7px_7px_3px_3px]",
                      i === 11 ? "bg-accent" : "bg-heat-2",
                    )}
                    style={{ height: `${Math.max(4, (m.n / monthMax) * 100)}px` }}
                  />
                  <span className="text-[10.5px] text-fg-subtle">{m.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-3" aria-label={t("hist.records")}>
            {(
              [
                [
                  t("hist.stat.bestDay"),
                  best ? count(best.count) : "—",
                  best ? f.date(best.day) : "",
                ],
                [
                  t("hist.stat.bestWeek"),
                  week ? count(week.count) : "—",
                  week ? t("hist.weekOf", { day: f.date(week.start) }) : "",
                ],
                [
                  t("hist.stat.activeDays"),
                  `${activeDays(scoped)} / ${DAYS - 7}`,
                  t("hist.ofYear", {
                    pct: Math.round((activeDays(scoped) / (DAYS - 7)) * 100),
                  }),
                ],
                [
                  t("hist.stat.topProject"),
                  spread[0] ? projectName(spread[0].projectId) : "—",
                  spread[0] ? count(spread[0].count) : "",
                ],
              ] as const
            ).map(([l, v, d]) => (
              <div key={l} className="flex flex-col gap-1 rounded-[16px] bg-sunk px-4 py-3">
                <span className="num text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
                  {l}
                </span>
                <span className="text-[15px] font-bold">{v}</span>
                <span className="text-[11.5px] text-fg-subtle">{d}</span>
              </div>
            ))}
          </section>
        </div>

        <section className={card}>
          <h2 className="mb-3 font-display text-[19px] font-bold">{t("hist.latest")}</h2>
          {feed.length === 0 ? (
            <p className="text-[13px] text-fg-subtle">{t("hist.feedEmpty")}</p>
          ) : (
            <ul className="flex flex-col">
              {feed.map((e) => {
                const obj = e.objectId ? byId.get(e.objectId) : undefined;
                return (
                  <li
                    key={e.id}
                    className="flex items-start gap-3 border-b border-border py-[10px] last:border-b-0"
                  >
                    <i
                      className="mt-[6px] size-2 flex-none rounded-full"
                      style={{ background: colorOf(e.projectId) }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                      <span className="text-[11.5px] text-fg-subtle">
                        {t(`hist.kind.${e.kind}`)} · {projectName(e.projectId)}
                      </span>
                      {obj ? (
                        <Link
                          href={href(obj.id)}
                          aria-label={t("hist.openObject", { title: obj.title })}
                          className="truncate text-[13.5px] font-semibold hover:underline"
                        >
                          {obj.title}
                        </Link>
                      ) : (
                        <span className="text-[13.5px] text-fg-subtle">{t("hist.objectGone")}</span>
                      )}
                    </span>
                    <Link
                      href={historyHref(e.day, projectId)}
                      aria-label={t("hist.openDay", { day: f.date(e.day) })}
                      className="num flex-none text-[11px] text-fg-subtle hover:text-fg hover:underline"
                    >
                      {when(e)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
