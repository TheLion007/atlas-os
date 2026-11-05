"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { describeError, useGraph } from "@/client/hooks";
import { buildCollection, filterCollection, sortCollection } from "@/domain/collection";
import { isCreatable } from "@/domain/creation";
import { LIFECYCLE_STATUSES, type LifecycleStatus, type ObjectType } from "@/domain/enums";
import { useI18n } from "@/i18n/I18nProvider";
import { usePeek } from "@/lib/url-state";
import { cn } from "@/lib/cn";
import { hrefKeepingState } from "../shell/nav";
import { useUi } from "../shell/ui-store";
import { Icon } from "../ui/Icon";
import { ObjectChip } from "../ui/ObjectChip";
import { ProgressRail } from "../ui/ProgressRail";
import { StatusBadge } from "../ui/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";

const PRIMARY =
  "inline-flex h-10 items-center gap-2 rounded-[12px] bg-fg px-4 text-[13.5px] font-semibold text-bg transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-px active:scale-[0.96]";

const EMPTY_KEYS = {
  project: ["empty.project.title", "empty.project.body"],
  task: ["empty.task.title", "empty.task.body"],
  decision: ["empty.decision.title", "empty.decision.body"],
  risk: ["empty.risk.title", "empty.risk.body"],
  note: ["empty.note.title", "empty.note.body"],
} as const;

/**
 * A typed collection: every project, every task, every decision... It is the plain, sortable
 * list beside the graph, and the natural place to start: the create button is right here, and
 * an empty collection says what to do next instead of showing an empty table. Progress, blocked
 * and risk level are derived by the engine from the same graph everything else reads.
 */
export function CollectionLens({ type }: { type: ObjectType }) {
  const { t, f, typeLabel } = useI18n();
  const graph = useGraph();
  const params = useSearchParams();
  const [peekId, setPeek] = usePeek();
  const openCreate = useUi((s) => s.openCreate);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LifecycleStatus | "all">("all");

  const all = useMemo(
    () =>
      graph.data ? sortCollection(buildCollection(type, graph.data.nodes, graph.data.edges)) : [],
    [graph.data, type],
  );
  const rows = useMemo(() => filterCollection(all, { query, status }), [all, query, status]);

  if (graph.isPending) return <LoadingState label={typeLabel(type, true)} lines={5} />;
  if (graph.isError) {
    const { title, message } = describeError(graph.error, t);
    return <ErrorState title={title} message={message} onRetry={() => void graph.refetch()} />;
  }

  const creatable = isCreatable(type);
  const newLabel = creatable ? t(`create.new.${type}`) : "";
  const create = () => creatable && openCreate({ type });
  const examples = all.filter((r) => r.example).length;
  const keys = EMPTY_KEYS[type as keyof typeof EMPTY_KEYS];

  if (all.length === 0) {
    return (
      <div className="mx-auto -my-4 flex max-w-[1300px] flex-col gap-5 px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9">
        <h2 className="font-display text-[34px] leading-none font-extrabold tracking-[-0.03em]">
          {typeLabel(type, true)}
        </h2>
        <EmptyState
          title={keys ? t(keys[0]) : t("empty.location.title")}
          description={keys ? t(keys[1]) : undefined}
          action={
            creatable ? (
              <button type="button" onClick={create} className={PRIMARY}>
                <Icon name="plus" />
                {newLabel}
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const hrefFor = (id: string) => hrefKeepingState(`/objects/${id}`, params);
  const cell = "px-3 py-3 align-middle";
  const head = "label px-3 py-2 text-left font-normal";
  const showProgress = type === "project" || type === "sub_project";

  return (
    <div className="mx-auto -my-4 flex max-w-[1300px] flex-col gap-5 px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[34px] leading-none font-extrabold tracking-[-0.03em]">
            {typeLabel(type, true)}
          </h2>
          <p className="num text-xs text-fg-muted">
            {t("collection.count", { count: all.length })}
            {examples > 0 && ` · ${t("collection.examples", { count: examples })}`}
          </p>
        </div>
        {creatable && (
          <button type="button" onClick={create} className={PRIMARY}>
            <Icon name="plus" />
            {newLabel}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 min-w-0 grow items-center gap-2 rounded-[12px] border border-border bg-surface px-3 sm:max-w-xs">
          <Icon name="search" className="shrink-0 text-fg-muted" />
          <label htmlFor="collection-filter" className="sr-only">
            {t("collection.filter")}
          </label>
          <input
            id="collection-filter"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("collection.filter")}
            autoComplete="off"
            className="h-full min-w-0 grow bg-transparent outline-none placeholder:text-fg-muted"
          />
        </div>
        <div
          role="group"
          aria-label={t("form.status")}
          className="inline-flex gap-1 rounded-full bg-sunk p-1"
        >
          {(["all", ...LIFECYCLE_STATUSES] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors duration-(--duration-hover)",
                status === s ? "bg-surface text-fg shadow-card" : "text-fg-subtle hover:text-fg",
              )}
            >
              {s === "all" ? t("collection.all") : t(`status.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-fg-muted" role="status">
          {t("empty.filtered")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[20px] border border-border bg-surface shadow-card">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead className="border-b border-border">
              <tr>
                <th scope="col" className={head}>
                  {t("col.name")}
                </th>
                <th scope="col" className={head}>
                  {t("col.status")}
                </th>
                {showProgress && (
                  <th scope="col" className={cn(head, "hidden w-48 md:table-cell")}>
                    {t("col.progress")}
                  </th>
                )}
                {type === "risk" && (
                  <th scope="col" className={head}>
                    {t("col.risk")}
                  </th>
                )}
                {type === "task" && (
                  <th scope="col" className={cn(head, "hidden md:table-cell")}>
                    {t("col.project")}
                  </th>
                )}
                {type === "note" && (
                  <th scope="col" className={cn(head, "hidden md:table-cell")}>
                    {t("col.about")}
                  </th>
                )}
                {type === "note" ? (
                  <th scope="col" className={head}>
                    {t("col.updated")}
                  </th>
                ) : type !== "risk" ? (
                  <th scope="col" className={head}>
                    {showProgress
                      ? t("col.target")
                      : type === "decision"
                        ? t("col.decideBy")
                        : t("col.due")}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-sunk">
                  <td className={cn(cell, "max-w-72")}>
                    <div className="flex items-center gap-2">
                      <ObjectChip
                        object={{ id: r.id, type: r.type, title: r.title, status: r.status }}
                        selected={peekId === r.id}
                        onPeek={setPeek}
                        href={hrefFor(r.id)}
                      />
                      {r.example && (
                        <span className="label shrink-0" title={t("object.exampleHint")}>
                          {t("common.example")}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={cell}>
                    <StatusBadge status={r.status} blocked={r.blocked} />
                  </td>
                  {showProgress && (
                    <td className={cn(cell, "hidden md:table-cell")}>
                      <ProgressRail
                        label={t("cc.progressOf", { title: r.title })}
                        actual={r.progress}
                      />
                    </td>
                  )}
                  {type === "risk" && (
                    <td className={cn(cell, "num")}>
                      {r.risk
                        ? `${r.risk.probability} × ${r.risk.impact} · ${t(`risk.${r.risk.level}`)}`
                        : "—"}
                    </td>
                  )}
                  {type === "task" && (
                    <td className={cn(cell, "hidden text-fg-muted md:table-cell")}>
                      {r.parent?.title ?? "—"}
                    </td>
                  )}
                  {type === "note" && (
                    <td className={cn(cell, "hidden text-fg-muted md:table-cell")}>
                      {r.parent?.title ?? "—"}
                    </td>
                  )}
                  {type === "note" ? (
                    <td className={cn(cell, "num text-fg-muted")}>
                      {f.date(r.updatedAt.slice(0, 10))}
                    </td>
                  ) : type !== "risk" ? (
                    <td className={cn(cell, "num text-fg-muted")}>
                      {r.date ? f.date(r.date) : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
