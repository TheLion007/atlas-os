"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useProgress } from "@/client/hooks";
import { useSource } from "@/client/provider";
import { enrich, projectColor } from "@/design/palette";
import type { ApiEdge, ApiObject } from "@/domain/api-types";
import { riskLevel } from "@/domain/engine";
import { yearGrid } from "@/domain/history";
import { descendantsOf, projectBoard, projectCards, type BoardColumn } from "@/domain/project-view";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { playSound } from "@/lib/feedback/sound";
import { useTimer } from "@/lib/timer-store";
import { HeatGrid } from "./HeatGrid";
import { historyHref } from "../lenses/HistoryLens";
import { hrefKeepingState } from "../shell/nav";
import { useUi } from "../shell/ui-store";
import { KanbanBoard } from "./KanbanBoard";
import { useTaskStatus } from "./useTaskStatus";

const TABS = ["overview", "tasks", "notes", "files", "timeline", "budget"] as const;
type Tab = (typeof TABS)[number];
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const tint = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const card =
  "flex flex-col rounded-[18px] border border-border bg-surface px-[22px] py-5 shadow-card";
const cardTitle = "font-display text-[17px] font-bold";

interface ProjectPageProps {
  project: ApiObject;
  nodes: readonly ApiObject[];
  edges: readonly ApiEdge[];
  /** The app's own actions on an object (add, edit, delete): kept, in a discreet menu. */
  actions?: ReactNode;
}

/**
 * A project as the design draws it: the switcher between projects, the header card (domain, name,
 * description, badges, progress ring), its sub-projects, then six tabs — Overview, Tasks (the
 * board), Notes, Vault, Timeline, Budget and risks. Everything is read from the real graph.
 */
export function ProjectPage({ project, nodes, edges, actions }: ProjectPageProps) {
  const { t, f, locale } = useI18n();
  const source = useSource();
  const today = source?.today() ?? new Date().toISOString().slice(0, 10);
  const params = useSearchParams();
  const router = useRouter();
  const openCreate = useUi((s) => s.openCreate);
  const [tab, setTab] = useState<Tab>("tasks");
  const { setStatus } = useTaskStatus();
  const journal = useProgress(140);

  const cards = useMemo(() => projectCards(nodes, edges, today), [nodes, edges, today]);
  const mine = cards.find((c) => c.id === project.id) ?? null;
  const color = enrich(projectColor(project.color, project.id), 1.2);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const inside = useMemo(() => descendantsOf(project.id, edges), [project.id, edges]);
  const board = useMemo(
    () => projectBoard(project.id, nodes, edges, today),
    [project.id, nodes, edges, today],
  );
  const href = (id: string) => hrefKeepingState(`/objects/${id}`, params);

  const linked = useMemo(() => {
    const scope = new Set([project.id, ...inside]);
    const found = new Map<string, ApiObject>();
    for (const e of edges) {
      if (e.kind !== "references") continue;
      const other = scope.has(e.to) ? e.from : scope.has(e.from) ? e.to : null;
      const n = other ? byId.get(other) : undefined;
      if (n && (n.type === "note" || n.type === "document")) found.set(n.id, n);
    }
    return [...found.values()];
  }, [edges, byId, inside, project.id]);
  const notes = linked.filter((n) => n.type === "note");
  const files = linked.filter((n) => n.type === "document");

  const ofType = (type: ApiObject["type"]) =>
    [...inside]
      .map((id) => byId.get(id))
      .filter((n): n is ApiObject => !!n && n.type === type && n.status !== "dropped");
  const milestones = ofType("milestone").sort((a, b) =>
    str(a.details?.date) < str(b.details?.date) ? -1 : 1,
  );
  const decisions = ofType("decision");
  const risks = ofType("risk").map((n) => ({
    id: n.id,
    title: n.title,
    mitigation: str(n.details?.mitigation),
    p: num(n.details?.probability) ?? 1,
    i: num(n.details?.impact) ?? 1,
  }));
  const subs = mine?.subProjects ?? [];
  const nextMilestone = milestones.find((m) => m.status !== "done");
  const dueTasks = Object.values(board)
    .flat()
    .filter((c) => c.status !== "done" && c.due)
    .sort((a, b) => ((a.due as string) < (b.due as string) ? -1 : 1))
    .slice(0, 4);

  const budget = num(project.details?.budgetAmount);
  const currency = str(project.details?.budgetCurrency) || null;
  const total = (mine?.tasksOpen ?? 0) + (mine?.tasksDone ?? 0);
  const pct = mine?.progress == null ? 0 : Math.round(mine.progress * 100);
  const kind = str(project.details?.kind);
  const prio = num(project.details?.priority) ?? 2;
  const description = str(project.details?.description);
  const grid = useMemo(
    () => yearGrid(journal.data ?? [], today, 18, project.id),
    [journal.data, today, project.id],
  );
  const cellText = (c: { count: number; day: string }) =>
    c.count === 0
      ? t("hist.cell0", { day: f.date(c.day) })
      : c.count === 1
        ? t("hist.cell1", { day: f.date(c.day) })
        : t("hist.cell", { count: c.count, day: f.date(c.day) });

  const onMove = (id: string, to: BoardColumn, at: { x: number; y: number }) => {
    const c = Object.values(board)
      .flat()
      .find((x) => x.id === id);
    if (c) setStatus({ id, title: c.title, due: c.due, status: c.status }, to, at, today);
  };

  const levelStyle = (p: number, i: number) => {
    const lv = riskLevel(p, i);
    return {
      label: t(`risk.${lv}`),
      bg:
        lv === "low"
          ? "var(--color-sunk)"
          : tint(
              lv === "critical"
                ? "var(--color-critical)"
                : lv === "high"
                  ? "var(--color-warn)"
                  : "var(--color-accent)",
              18,
            ),
      fg:
        lv === "low"
          ? "var(--color-fg-muted)"
          : lv === "critical"
            ? "var(--color-critical)"
            : "var(--color-fg)",
    };
  };

  return (
    <div className="mx-auto -my-4 flex max-w-[1440px] flex-col gap-[22px] px-4 pt-[22px] pb-[60px] md:-my-6 md:px-9">
      <nav
        aria-label={t("proj.cards")}
        className="flex flex-wrap gap-1 self-start rounded-[14px] bg-heat-0 p-1"
      >
        {cards.map((q) => {
          const here = q.id === project.id;
          return (
            <Link
              key={q.id}
              href={hrefKeepingState(`/projects?p=${q.id}`, params)}
              aria-current={here ? "page" : undefined}
              className={cn(
                "flex items-center gap-[7px] rounded-[10px] border px-[11px] py-[6px] text-[12.5px] font-semibold transition-all duration-[250ms] hover:text-fg",
                here
                  ? "border-border-strong bg-surface text-fg"
                  : "border-transparent text-fg-subtle",
              )}
            >
              <i
                className="size-2 rounded-[3px]"
                style={{ background: enrich(projectColor(q.color, q.id), 1.2) }}
              />
              {q.title}
            </Link>
          );
        })}
      </nav>

      <header className="relative flex flex-wrap items-center gap-[30px] overflow-hidden rounded-[24px] border border-border bg-surface px-7 py-[26px] shadow-card">
        <div
          aria-hidden="true"
          className="absolute -top-20 -right-[60px] size-[260px] rounded-full"
          style={{ background: tint(color, 14) }}
        />
        <div className="relative flex min-w-[320px] flex-1 flex-col gap-[10px]">
          <span className="num flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
            <i className="size-[10px] rounded-[3px]" style={{ background: color }} />
            {t("proj.cards")} / {kind && kind !== "general" ? kind : t("map2.misc")}
          </span>
          <h1 className="font-display text-[40px] leading-[1.02] font-extrabold tracking-[-0.03em]">
            {project.title}
          </h1>
          {description && (
            <p className="max-w-[620px] text-[15px] text-fg-muted text-pretty">{description}</p>
          )}
          <div className="mt-[6px] flex flex-wrap gap-2">
            <span
              className="rounded-full px-[11px] py-[5px] text-xs font-semibold text-on-accent"
              style={{ background: color }}
            >
              {t(
                `hm.status.${project.status === "dropped" ? "draft" : project.status}` as "hm.status.active",
              )}
            </span>
            <span className="rounded-full bg-sunk px-[11px] py-[5px] text-xs">
              {t("pp.priority", { level: t(`map2.prio.${prio}` as "map2.prio.1") })}
            </span>
            <span className="rounded-full bg-sunk px-[11px] py-[5px] text-xs">
              {mine?.targetDate ? t("hm.due", { date: f.date(mine.targetDate) }) : t("proj.noDate")}
            </span>
            {budget !== null && currency && (
              <span className="rounded-full bg-sunk px-[11px] py-[5px] text-xs">
                {t("pp.budget", { amount: f.money(budget, currency) })}
              </span>
            )}
          </div>
        </div>
        <div className="relative flex items-center gap-[18px]">
          <div className="relative size-[116px]">
            <svg
              width="116"
              height="116"
              viewBox="0 0 116 116"
              className="-rotate-90"
              aria-hidden="true"
            >
              <circle
                cx="58"
                cy="58"
                r="46"
                fill="none"
                stroke="var(--color-sunk)"
                strokeWidth="10"
              />
              <circle
                cx="58"
                cy="58"
                r="46"
                fill="none"
                stroke={color}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray="289"
                strokeDashoffset={289 - (289 * pct) / 100}
                style={{ transition: "stroke-dashoffset 1s cubic-bezier(.34,1.3,.64,1)" }}
              />
            </svg>
            <span
              role="progressbar"
              aria-label={t("proj.progressOf", { title: project.title })}
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="absolute inset-0 grid place-items-center font-display text-[26px] font-extrabold tracking-[-0.02em]"
            >
              {mine?.progress == null ? "—" : `${pct} %`}
            </span>
          </div>
          <span className="text-[13px] text-fg-muted">
            {total === 0
              ? t("proj.noTasks")
              : t("pp.tasksOf", { open: mine?.tasksOpen ?? 0, total })}
          </span>
          <button
            type="button"
            onClick={() => {
              playSound("click");
              useTimer.getState().setProject(project.id, null);
              router.push(href("/timer"));
            }}
            className="inline-flex h-9 items-center gap-2 rounded-[11px] bg-fg px-4 text-[13px] font-semibold text-bg transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-px active:scale-[0.95]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            {t("tm.focusOn")}
          </button>
        </div>
        {actions && (
          <details className="absolute top-3 right-4 z-10">
            <summary
              aria-label={t("pp.more")}
              className="grid size-8 cursor-pointer list-none place-items-center rounded-[10px] text-fg-subtle transition-colors hover:bg-sunk hover:text-fg [&::-webkit-details-marker]:hidden"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </summary>
            <div className="pop-in absolute right-0 mt-1 w-[min(520px,80vw)] rounded-[16px] border border-border bg-surface p-3 shadow-pop">
              {actions}
            </div>
          </details>
        )}
      </header>

      {subs.length > 0 && (
        <div className="flex flex-wrap items-center gap-[10px]">
          <span className="num mr-1 text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
            {t("pp.subs")}
          </span>
          {subs.map((x) => {
            const p = Math.round((x.progress ?? 0) * 100);
            return (
              <Link
                key={x.id}
                href={href(x.id)}
                className="flex items-center gap-[10px] rounded-[12px] border border-border bg-surface px-3 py-[7px] text-[13px] font-medium transition-transform duration-[350ms] hover:-translate-y-0.5"
                style={{ transitionTimingFunction: SPRING }}
              >
                {x.title}
                <span className="h-[5px] w-11 overflow-hidden rounded-[5px] bg-sunk">
                  <span className="block h-full" style={{ width: `${p}%`, background: color }} />
                </span>
                <span className="num text-[10.5px] text-fg-subtle">{p}%</span>
              </Link>
            );
          })}
        </div>
      )}

      <div
        role="tablist"
        aria-label={t("proj.tabs")}
        className="flex gap-[26px] overflow-x-auto border-b border-border"
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`proj-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`proj-panel-${id}`}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px border-b-[2.5px] pt-[10px] pb-3 text-[14px] font-semibold whitespace-nowrap transition-colors duration-200 hover:text-fg",
              tab === id ? "border-accent text-fg" : "border-transparent text-fg-subtle",
            )}
          >
            {t(`proj.tab.${id}`)}
          </button>
        ))}
      </div>

      <div
        key={tab}
        role="tabpanel"
        id={`proj-panel-${tab}`}
        aria-labelledby={`proj-tab-${tab}`}
        className="rise-in"
      >
        {tab === "tasks" && (
          <KanbanBoard
            board={board}
            color={color}
            onMove={onMove}
            onOpen={(id) => router.push(href(id))}
            hrefFor={href}
            onAdd={() =>
              openCreate({
                type: "task",
                parent: { id: project.id, type: "project", title: project.title },
              })
            }
          />
        )}

        {tab === "overview" && (
          <div className="flex flex-wrap items-start gap-5">
            <div className="flex min-w-0 flex-[1.4_1_440px] flex-col gap-5">
              <section className={cn(card, "gap-1")}>
                <h3 className={cn(cardTitle, "mb-3")}>{t("pp.followUp")}</h3>
                {milestones.length === 0 && (
                  <p className="text-fg-muted">{t("proj.noMilestones")}</p>
                )}
                {milestones.map((m, i) => {
                  const done = m.status === "done";
                  const next = m.id === nextMilestone?.id;
                  return (
                    <Link key={m.id} href={href(m.id)} className="group flex gap-[14px]">
                      <span className="flex w-4 flex-col items-center">
                        <i
                          className="mt-[3px] size-[14px] flex-none rounded-full border-[2.5px]"
                          style={{
                            background: done ? color : "var(--color-surface)",
                            borderColor: done || next ? color : "var(--color-border-strong)",
                            boxShadow: next ? `0 0 0 4px ${tint(color, 20)}` : undefined,
                          }}
                        />
                        {i < milestones.length - 1 && (
                          <i
                            className="min-h-6 w-0.5 flex-1"
                            style={{ background: done ? color : "var(--color-border)" }}
                          />
                        )}
                      </span>
                      <span className="flex flex-1 items-baseline gap-[10px] pb-4">
                        <span
                          className={cn(
                            "text-[14px] group-hover:underline",
                            next ? "font-bold" : "font-medium",
                            done || next ? "text-fg" : "text-fg-muted",
                          )}
                        >
                          {m.title}
                        </span>
                        {next && (
                          <span className="text-[11px] font-semibold text-accent-ink">
                            {t("pp.next")}
                          </span>
                        )}
                        <span className="num ml-auto text-[11.5px] text-fg-subtle">
                          {str(m.details?.date) ? f.date(str(m.details?.date)) : ""}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </section>

              <section className={cn(card, "gap-3")}>
                <h3 className={cardTitle}>{t("pp.decisions")}</h3>
                {decisions.length === 0 && <p className="text-fg-muted">{t("pp.noDecisions")}</p>}
                {decisions.map((d) => (
                  <Link
                    key={d.id}
                    href={href(d.id)}
                    className="grid grid-cols-[70px_1fr] gap-3 border-t border-border py-[10px] hover:bg-sunk/50"
                  >
                    <span className="num pt-0.5 text-[11.5px] text-fg-subtle">
                      {str(d.details?.resolvedAt)
                        ? f.date(str(d.details?.resolvedAt).slice(0, 10))
                        : str(d.details?.deadline)
                          ? f.date(str(d.details?.deadline))
                          : ""}
                    </span>
                    <span className="flex flex-col gap-[3px]">
                      <span className="text-[14px] font-semibold">{d.title}</span>
                      <span className="text-[13px] text-fg-muted">
                        {str(d.details?.rationale) || str(d.details?.question)}
                      </span>
                    </span>
                  </Link>
                ))}
              </section>

              <section className={cn(card, "gap-[14px]")}>
                <div className="flex items-baseline justify-between">
                  <h3 className={cardTitle}>{t("pp.activity")}</h3>
                  <span className="text-xs text-fg-subtle">{t("pp.weeks", { count: 18 })}</span>
                </div>
                <HeatGrid
                  grid={grid}
                  size={15}
                  gap={4}
                  showMonths={false}
                  showWeekdays={false}
                  label={t("hist.gridLabel")}
                  hrefFor={(day) => hrefKeepingState(historyHref(day, project.id), params)}
                  ariaFor={cellText}
                  tip={(c) => <p className="font-semibold">{cellText(c)}</p>}
                />
              </section>
            </div>

            <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-5">
              <section className="flex flex-col gap-3 rounded-[18px] bg-fg px-[22px] py-5 text-bg shadow-card">
                <span className="num text-[10.5px] font-semibold tracking-[0.08em] uppercase opacity-60">
                  {t("pp.budgetLabel")}
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-[32px] font-extrabold tracking-[-0.02em]">
                    {budget !== null && currency ? f.money(budget, currency) : "—"}
                  </span>
                </div>
                <span className="text-[12.5px] opacity-70">
                  {budget !== null ? t("pp.budgetPlanned") : t("proj.noBudget")}
                </span>
              </section>

              <section className={cn(card, "gap-[10px]")}>
                <h3 className={cn(cardTitle, "mb-1")}>{t("proj.risks")}</h3>
                {risks.length === 0 && <p className="text-fg-muted">{t("proj.noRisks")}</p>}
                {risks.map((r) => {
                  const lv = levelStyle(r.p, r.i);
                  return (
                    <Link
                      key={r.id}
                      href={href(r.id)}
                      className="flex items-start gap-[10px] border-t border-border py-2 hover:bg-sunk/50"
                    >
                      <span
                        className="flex-none rounded-[6px] px-2 py-[3px] text-[11px] font-bold"
                        style={{ background: lv.bg, color: lv.fg }}
                      >
                        {lv.label}
                      </span>
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[13.5px] font-semibold">{r.title}</span>
                        <span className="text-[12.5px] text-fg-muted">{r.mitigation}</span>
                      </span>
                    </Link>
                  );
                })}
              </section>

              <section className={cn(card, "gap-[10px]")}>
                <h3 className={cn(cardTitle, "mb-1")}>{t("pp.reminders")}</h3>
                {dueTasks.length === 0 && <p className="text-fg-muted">{t("hm.deadlinesEmpty")}</p>}
                {dueTasks.map((c) => (
                  <Link
                    key={c.id}
                    href={href(c.id)}
                    className="flex items-center gap-3 py-[6px] hover:underline"
                  >
                    <span className="size-2 flex-none rounded-full border-2 border-accent" />
                    <span className="flex-1 text-[13.5px]">{c.title}</span>
                    <span className="num text-[11px] text-fg-subtle">
                      {c.due ? f.date(c.due) : ""}
                    </span>
                  </Link>
                ))}
              </section>
            </div>
          </div>
        )}

        {tab === "notes" && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-[14px]">
            {notes.length === 0 && <li className="text-fg-muted">{t("proj.noNotes")}</li>}
            {notes.map((n) => {
              const blocks = Array.isArray(n.details?.blocks)
                ? (n.details.blocks as { text?: string }[])
                : [];
              return (
                <li key={n.id}>
                  <Link
                    href={href(n.id)}
                    className="flex h-full flex-col gap-2 rounded-[16px] border border-border bg-surface p-[18px] shadow-card transition-[transform,box-shadow] duration-[450ms] hover:-translate-y-1 hover:shadow-pop"
                    style={{ transitionTimingFunction: SPRING }}
                  >
                    <span className="font-display text-[16px] font-bold">{n.title}</span>
                    <span className="text-[13px] text-fg-muted text-pretty">
                      {blocks.find((b, i) => i > 0 && b.text)?.text ?? blocks[0]?.text ?? ""}
                    </span>
                    <span className="num text-[11px] text-fg-subtle">
                      {t("pp.blocks", { count: blocks.length })} ·{" "}
                      {f.date(n.updatedAt.slice(0, 10))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {tab === "files" && (
          <div className="overflow-hidden rounded-[18px] border border-border bg-surface shadow-card">
            {files.length === 0 && <p className="p-5 text-fg-muted">{t("proj.noFiles")}</p>}
            {files.map((n) => {
              const ext = (
                str(n.details?.originalName).split(".").pop() ||
                str(n.details?.mime).split("/").pop() ||
                ""
              )
                .slice(0, 4)
                .toUpperCase();
              const kb = num(n.details?.sizeBytes);
              return (
                <Link
                  key={n.id}
                  href={href(n.id)}
                  className="flex w-full items-center gap-[14px] border-b border-border px-[18px] py-[13px] last:border-b-0 hover:bg-sunk"
                >
                  <span className="num w-10 rounded-[7px] bg-sunk py-1 text-center text-[10px] font-bold text-fg-muted">
                    {ext}
                  </span>
                  <span className="flex-1 text-[14px] font-medium">{n.title}</span>
                  <span className="text-xs text-fg-subtle">
                    {kb ? `${t("proj.sizeKb", { n: Math.max(1, Math.round(kb / 1024)) })} · ` : ""}
                    {f.date(n.createdAt.slice(0, 10))}
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        {tab === "timeline" && (
          <TimelineTab
            subs={subs}
            milestones={milestones}
            board={board}
            color={color}
            today={today}
            start={str(project.details?.startDate)}
            end={mine?.targetDate ?? ""}
            href={href}
            locale={locale}
          />
        )}

        {tab === "budget" && (
          <div className="flex flex-wrap items-start gap-5">
            <section className={cn(card, "min-w-0 flex-[1.4_1_440px] gap-[6px]")}>
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className={cardTitle}>{t("pp.budgetTitle")}</h3>
                <span className="num text-[13px] font-semibold">
                  {budget !== null && currency ? f.money(budget, currency) : "—"}
                </span>
              </div>
              {budget === null && <p className="text-fg-muted">{t("proj.noBudget")}</p>}
            </section>
            <section className={cn(card, "min-w-0 flex-[1_1_300px] gap-3")}>
              <h3 className={cardTitle}>{t("pp.matrix")}</h3>
              <RiskGrid risks={risks} t={t} />
              {risks.map((r) => (
                <Link
                  key={r.id}
                  href={href(r.id)}
                  className="flex items-center gap-[10px] text-[13px] hover:underline"
                >
                  <span
                    className="size-2 flex-none rounded-full"
                    style={{ background: levelStyle(r.p, r.i).fg }}
                  />
                  {r.title}
                </Link>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** The 3 × 3 risk grid of the design: probability across, impact up; each cell counts its risks. */
function RiskGrid({
  risks,
  t,
}: {
  risks: { id: string; title: string; p: number; i: number }[];
  t: ReturnType<typeof useI18n>["t"];
}) {
  const bucket = (v: number) => (v <= 2 ? 1 : v <= 3 ? 2 : 3);
  const cells = [3, 2, 1].flatMap((i) =>
    [1, 2, 3].map((p) => ({
      p,
      i,
      n: risks.filter((r) => bucket(r.p) === p && bucket(r.i) === i),
    })),
  );
  return (
    <div className="grid grid-cols-[22px_repeat(3,1fr)] items-stretch gap-[6px]">
      <span className="row-span-3 rotate-180 text-center text-[11px] text-fg-subtle [writing-mode:vertical-rl]">
        {t("pp.impact")}
      </span>
      {cells.map((c) => {
        const score = c.p * c.i;
        const bg =
          score >= 6
            ? "var(--color-critical)"
            : score >= 3
              ? "var(--color-warn)"
              : "var(--color-positive)";
        return (
          <div
            key={`${c.p}-${c.i}`}
            title={c.n.map((r) => r.title).join(", ")}
            className="grid aspect-[1.3] place-items-center rounded-[10px]"
            style={{ background: tint(bg, 16) }}
          >
            {c.n.length > 0 && (
              <span
                className="num grid size-7 place-items-center rounded-full text-[13px] font-bold text-on-accent"
                style={{ background: bg }}
              >
                {c.n.length}
              </span>
            )}
          </div>
        );
      })}
      <span />
      <span className="col-span-3 text-center text-[11px] text-fg-subtle">
        {t("pp.probability")} →
      </span>
    </div>
  );
}

/** Gantt of the design: months across, one bar per sub-project filling with its progress, today as a line. */
function TimelineTab({
  subs,
  milestones,
  board,
  color,
  today,
  start,
  end,
  href,
  locale,
}: {
  subs: { id: string; title: string; progress: number | null }[];
  milestones: ApiObject[];
  board: Record<BoardColumn, { due: string | null; group: string | null }[]>;
  color: string;
  today: string;
  start: string;
  end: string;
  href: (id: string) => string;
  locale: string;
}) {
  const { t } = useI18n();
  const dates = [
    start,
    end,
    ...milestones.map((m) => str(m.details?.date)),
    ...Object.values(board).flatMap((c) => c.map((x) => x.due ?? "")),
  ]
    .filter(Boolean)
    .sort();
  if (dates.length < 2) return <p className="text-fg-muted">{t("proj.noTimeline")}</p>;
  const t0 = Date.parse(`${dates[0]}T00:00:00Z`);
  const t1 = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`) + 86_400_000;
  const span = Math.max(1, t1 - t0);
  const pos = (iso: string) =>
    Math.max(0, Math.min(100, ((Date.parse(`${iso}T00:00:00Z`) - t0) / span) * 100));
  const months: { label: string; left: number; width: number }[] = [];
  for (
    let d = new Date(t0);
    d.getTime() < t1;
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  ) {
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).getTime();
    months.push({
      label: d.toLocaleDateString(locale, { month: "short", timeZone: "UTC" }),
      left: ((d.getTime() - t0) / span) * 100,
      width: ((Math.min(next, t1) - d.getTime()) / span) * 100,
    });
  }
  const rows = subs.map((s) => {
    const own = board.draft
      .concat(board.active, board.done)
      .filter((x) => x.group === s.title && x.due)
      .map((x) => x.due as string)
      .sort();
    const a = own[0] ?? dates[0]!;
    const b = own[own.length - 1] ?? dates[dates.length - 1]!;
    return { ...s, left: pos(a), width: Math.max(6, pos(b) - pos(a)) };
  });
  return (
    <div className="flex flex-col gap-3 overflow-x-auto rounded-[18px] border border-border bg-surface p-[22px] shadow-card">
      <div className="grid min-w-[760px] grid-cols-[180px_1fr] gap-4">
        <span />
        <div className="relative flex h-6 border-b border-border">
          {months.map((m) => (
            <span
              key={m.left}
              className="num absolute border-l border-border pb-2 pl-2 text-[11px] font-semibold text-fg-subtle uppercase"
              style={{ left: `${m.left}%`, width: `${m.width}%` }}
            >
              {m.label}
            </span>
          ))}
        </div>
      </div>
      {rows.map((r) => {
        const p = Math.round((r.progress ?? 0) * 100);
        return (
          <div key={r.id} className="grid min-w-[760px] grid-cols-[180px_1fr] items-center gap-4">
            <Link href={href(r.id)} className="text-[13.5px] font-semibold hover:underline">
              {r.title}
            </Link>
            <div className="relative h-[34px]">
              <div
                className="absolute -top-1.5 -bottom-1.5 w-0.5 rounded-[2px] bg-accent"
                style={{ left: `${pos(today)}%` }}
              />
              <div
                className="absolute top-[5px] h-6 overflow-hidden rounded-[8px] transition-transform duration-[350ms] hover:scale-y-[1.12]"
                style={{
                  left: `${r.left}%`,
                  width: `${r.width}%`,
                  background: tint(color, 22),
                  transitionTimingFunction: SPRING,
                }}
              >
                <div
                  className="h-full rounded-[8px]"
                  style={{ width: `${p}%`, background: color }}
                />
                <span className="num absolute top-1 right-2 text-[10.5px] font-semibold">{p}%</span>
              </div>
            </div>
          </div>
        );
      })}
      <div className="mt-2 grid min-w-[760px] grid-cols-[180px_1fr] gap-4">
        <span className="text-[13px] text-fg-subtle">{t("proj.milestones")}</span>
        <div className="relative h-14">
          {milestones.map((m) => (
            <Link
              key={m.id}
              href={href(m.id)}
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center gap-[6px]"
              style={{ left: `${pos(str(m.details?.date) || dates[0]!)}%` }}
            >
              <i className="size-3 rotate-45 rounded-[2px]" style={{ background: color }} />
              <span className="text-[11px] whitespace-nowrap text-fg-muted">{m.title}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
