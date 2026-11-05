"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { describeError, useGraph } from "@/client/hooks";
import type { ChipObject } from "@/components/ui/ObjectChip";
import type { ConfidenceBand } from "@/domain/confidence";
import { MEMORY_TYPES, type MemoryType } from "@/domain/enums";
import { analyzeMemoryHealth, type MemoryHealthKind } from "@/domain/memory-health";
import {
  buildMemoryRows,
  DEFAULT_MEMORY_FILTERS,
  filterMemoryRows,
  sortMemoryRows,
  type MemoryFilters,
  type MemoryRow,
  type MemorySort,
} from "@/domain/memory-model";
import { useI18n } from "@/i18n/I18nProvider";
import { usePeek } from "@/lib/url-state";
import { cn } from "@/lib/cn";
import { ConstellationCanvas, type ConstellationHandle } from "../canvases/ConstellationCanvas";
import { hrefKeepingState } from "../shell/nav";
import { useUi } from "../shell/ui-store";
import { ConfidenceMeter } from "../ui/ConfidenceMeter";
import { Icon } from "../ui/Icon";
import { ObjectChip } from "../ui/ObjectChip";
import { TypeGlyph } from "../ui/TypeGlyph";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";

type ViewMode = "list" | "grid" | "graph";
const HEALTH_KINDS: readonly MemoryHealthKind[] = [
  "duplicate",
  "low_confidence",
  "stale",
  "orphaned",
  "possible_contradiction",
];

const selectClass = "h-9 rounded-control border border-border bg-transparent px-2 text-sm text-fg";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-control border border-border p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-control px-3 py-1 text-sm transition-colors duration-(--duration-hover)",
            value === o.value ? "bg-selected text-fg" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function chipObjectOf(row: MemoryRow): ChipObject {
  return { id: row.id, type: "memory", title: row.title, status: row.status };
}

/**
 * The Memory Storage / Memory Core lens: browse, search, filter, sort and inspect every durable
 * memory. List/Grid/Graph are three views over the same `MemoryRow`s built by `memory-model.ts` —
 * not three separate stores (ADR 0002 §0, §8). Health flags are surfaced, never auto-resolved.
 */
export function MemoryLens() {
  const { t, f } = useI18n();
  const graph = useGraph();
  const params = useSearchParams();
  const [peekId, setPeek] = usePeek();
  const openCreate = useUi((s) => s.openCreate);
  const [filters, setFilters] = useState<MemoryFilters>(DEFAULT_MEMORY_FILTERS);
  const [sort, setSort] = useState<MemorySort>("updated");
  const [view, setView] = useState<ViewMode>("list");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [focusFlag, setFocusFlag] = useState<MemoryHealthKind | null>(null);
  const graphHandle = useRef<ConstellationHandle | null>(null);

  const allRows = useMemo(
    () => (graph.data ? buildMemoryRows(graph.data.nodes, graph.data.edges) : []),
    [graph.data],
  );
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const health = useMemo(() => analyzeMemoryHealth(allRows, today), [allRows, today]);
  const flaggedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const flag of health) for (const id of flag.memoryIds) ids.add(id);
    return ids;
  }, [health]);
  const focusIds = useMemo(() => {
    if (!focusFlag) return null;
    const flag = health.find((h) => h.kind === focusFlag);
    return flag ? new Set(flag.memoryIds) : new Set<string>();
  }, [focusFlag, health]);

  const filtered = useMemo(() => filterMemoryRows(allRows, filters), [allRows, filters]);
  const withHealth = useMemo(() => {
    let rows = filtered;
    if (flaggedOnly) rows = rows.filter((r) => flaggedIds.has(r.id));
    if (focusIds) rows = rows.filter((r) => focusIds.has(r.id));
    return rows;
  }, [filtered, flaggedOnly, flaggedIds, focusIds]);
  const rows = useMemo(
    () => sortMemoryRows(withHealth, sort, { query: filters.query, nodes: graph.data?.nodes }),
    [withHealth, sort, filters.query, graph.data],
  );

  const projectOptions = useMemo(
    () =>
      (graph.data?.nodes ?? [])
        .filter((n) => n.type === "project" || n.type === "sub_project")
        .map((n) => ({ id: n.id, title: n.title }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    [graph.data],
  );

  if (graph.isPending) return <LoadingState label={t("memory.title")} lines={6} />;
  if (graph.isError) {
    const { title, message } = describeError(graph.error, t);
    return <ErrorState title={title} message={message} onRetry={() => void graph.refetch()} />;
  }

  const hrefFor = (id: string) => hrefKeepingState(`/objects/${id}`, params);
  const create = () => openCreate({ type: "memory" });

  if (allRows.length === 0) {
    return (
      <div className="mx-auto -my-4 flex max-w-[1300px] flex-col gap-5 px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9">
        <h2 className="font-display text-[34px] leading-none font-extrabold tracking-[-0.03em]">
          {t("memory.title")}
        </h2>
        <EmptyState
          title={t("empty.memory.title")}
          description={t("empty.memory.body")}
          action={
            <button
              type="button"
              onClick={create}
              className="inline-flex h-10 items-center gap-2 rounded-control border border-fg bg-fg px-4 text-bg transition-colors duration-(--duration-hover) hover:border-fg-muted hover:bg-fg-muted"
            >
              <Icon name="plus" />
              {t("create.new.memory")}
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto -my-4 flex max-w-[1300px] flex-col gap-5 px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-[34px] leading-none font-extrabold tracking-[-0.03em]">
            {t("memory.title")}
          </h2>
          <p className="num text-xs text-fg-muted">
            {t("memory.count", { count: allRows.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={create}
          className="inline-flex h-10 items-center gap-2 rounded-control border border-fg bg-fg px-4 text-bg transition-colors duration-(--duration-hover) hover:border-fg-muted hover:bg-fg-muted"
        >
          <Icon name="plus" />
          {t("create.new.memory")}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 min-w-0 grow items-center gap-2 rounded-control border border-border px-3 sm:max-w-xs">
          <Icon name="search" className="shrink-0 text-fg-muted" />
          <label htmlFor="memory-search" className="sr-only">
            {t("memory.searchPlaceholder")}
          </label>
          <input
            id="memory-search"
            type="search"
            value={filters.query}
            onChange={(e) => setFilters((p) => ({ ...p, query: e.target.value }))}
            placeholder={t("memory.searchPlaceholder")}
            autoComplete="off"
            className="h-full min-w-0 grow bg-transparent outline-none placeholder:text-fg-muted"
          />
        </div>

        <label className="sr-only" htmlFor="memory-filter-project">
          {t("memory.filter.project")}
        </label>
        <select
          id="memory-filter-project"
          className={selectClass}
          value={filters.projectId}
          onChange={(e) =>
            setFilters((p) => ({ ...p, projectId: e.target.value as MemoryFilters["projectId"] }))
          }
        >
          <option value="all">{t("memory.filter.allProjects")}</option>
          <option value="none">{t("memory.filter.noProject")}</option>
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="memory-filter-type">
          {t("memory.filter.type")}
        </label>
        <select
          id="memory-filter-type"
          className={selectClass}
          value={filters.memoryType}
          onChange={(e) =>
            setFilters((p) => ({ ...p, memoryType: e.target.value as MemoryType | "all" }))
          }
        >
          <option value="all">{t("memory.filter.allTypes")}</option>
          {MEMORY_TYPES.map((mt) => (
            <option key={mt} value={mt}>
              {t(`memoryType.${mt}`)}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="memory-filter-confidence">
          {t("memory.filter.confidence")}
        </label>
        <select
          id="memory-filter-confidence"
          className={selectClass}
          value={filters.confidenceBand}
          onChange={(e) =>
            setFilters((p) => ({ ...p, confidenceBand: e.target.value as ConfidenceBand | "all" }))
          }
        >
          <option value="all">{t("memory.filter.allConfidence")}</option>
          <option value="high">{t("confidence.high")}</option>
          <option value="medium">{t("confidence.medium")}</option>
          <option value="low">{t("confidence.low")}</option>
          <option value="unset">{t("confidence.unset")}</option>
        </select>

        <button
          type="button"
          aria-pressed={filters.status === "all"}
          onClick={() =>
            setFilters((p) => ({ ...p, status: p.status === "all" ? "active" : "all" }))
          }
          className={cn(
            "h-9 rounded-control border px-3 text-sm transition-colors duration-(--duration-hover)",
            filters.status === "all"
              ? "border-fg-muted bg-selected text-fg"
              : "border-border text-fg-muted hover:text-fg",
          )}
        >
          {filters.status === "all"
            ? t("memory.filter.statusAll")
            : t("memory.filter.statusActive")}
        </button>

        <label className="sr-only" htmlFor="memory-sort">
          {t("memory.sort.label")}
        </label>
        <select
          id="memory-sort"
          className={selectClass}
          value={sort}
          onChange={(e) => setSort(e.target.value as MemorySort)}
        >
          {(["updated", "created", "alphabetical", "confidence", "relevance"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`memory.sort.${s}`)}
            </option>
          ))}
        </select>

        <div className="grow" />
        <Segmented
          value={view}
          onChange={setView}
          label={t("memory.view.list")}
          options={[
            { value: "list", label: t("memory.view.list") },
            { value: "grid", label: t("memory.view.grid") },
            { value: "graph", label: t("memory.view.graph") },
          ]}
        />
      </div>

      {health.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label text-fg-muted">{t("memory.health.needsReview")}</span>
          {HEALTH_KINDS.filter((k) => health.some((h) => h.kind === k)).map((k) => {
            const flag = health.find((h) => h.kind === k)!;
            const active = focusFlag === k;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={active}
                onClick={() => setFocusFlag(active ? null : k)}
                title={t("memory.health.hint")}
                className={cn(
                  "rounded-control border px-2 py-1 text-xs transition-colors duration-(--duration-hover)",
                  active
                    ? "border-fg-muted bg-selected text-fg"
                    : "border-border text-fg-muted hover:text-fg",
                )}
              >
                {t(`memory.health.${k}`, { count: flag.memoryIds.length })}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={flaggedOnly}
            onClick={() => setFlaggedOnly((v) => !v)}
            className={cn(
              "rounded-control border px-2 py-1 text-xs transition-colors duration-(--duration-hover)",
              flaggedOnly
                ? "border-fg-muted bg-selected text-fg"
                : "border-border text-fg-muted hover:text-fg",
            )}
          >
            {t("memory.health.showFlagged")}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-fg-muted" role="status">
          {t("empty.memoryFiltered")}
        </p>
      ) : view === "graph" ? (
        <div className="h-[calc(100dvh-20rem)] min-h-[28rem] overflow-hidden rounded-card border border-border">
          {/* The graph shows exactly the memories the filters leave, like List and Grid. */}
          <ConstellationCanvas
            rows={rows}
            objects={graph.data?.nodes ?? []}
            edges={graph.data?.edges ?? []}
            selectedId={peekId}
            onSelect={setPeek}
            onOpen={(id) => window.location.assign(hrefFor(id))}
            handleRef={graphHandle}
          />
        </div>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-card border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <ObjectChip
                  object={chipObjectOf(r)}
                  contextColor={r.color}
                  selected={peekId === r.id}
                  onPeek={setPeek}
                  href={hrefFor(r.id)}
                  className="max-w-full"
                />
                <span className="label shrink-0 text-fg-muted">
                  {t(`memoryType.${r.memoryType}`)}
                </span>
              </div>
              {r.detail && <p className="line-clamp-2 text-sm text-fg-muted">{r.detail}</p>}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <ConfidenceMeter score={r.confidence} />
                <span className="num text-xs text-fg-muted">
                  {f.date(r.updatedAt.slice(0, 10))}
                </span>
              </div>
              {r.primary && (
                <p className="truncate text-xs text-fg-muted">
                  {r.primary.title}
                  {r.secondary.length > 0 &&
                    ` · ${t("memory.secondaryMore", { count: r.secondary.length })}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <thead className="border-b border-border">
              <tr>
                {(
                  [
                    "title",
                    "type",
                    "context",
                    "confidence",
                    "provenance",
                    "relations",
                    "updated",
                  ] as const
                ).map((col) => (
                  <th key={col} scope="col" className="label px-3 py-2 text-left font-normal">
                    {t(`memory.col.${col}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-hover">
                  <td className="max-w-72 px-3 py-3 align-middle">
                    <ObjectChip
                      object={chipObjectOf(r)}
                      contextColor={r.color}
                      selected={peekId === r.id}
                      onPeek={setPeek}
                      href={hrefFor(r.id)}
                    />
                  </td>
                  <td className="px-3 py-3 align-middle text-fg-muted">
                    {t(`memoryType.${r.memoryType}`)}
                  </td>
                  <td className="px-3 py-3 align-middle text-fg-muted">
                    {r.primary ? (
                      <span className="truncate">
                        {r.primary.title}
                        {r.secondary.length > 0 && ` +${r.secondary.length}`}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <ConfidenceMeter score={r.confidence} />
                  </td>
                  <td className="px-3 py-3 align-middle text-fg-muted">
                    <span
                      className="inline-flex items-center gap-1"
                      title={t(`memory.source.${r.sourceKind}`)}
                    >
                      <TypeGlyph
                        type={r.derivedFrom[0]?.type ?? "memory"}
                        colored={r.derivedFrom.length > 0}
                      />
                      {r.derivedFrom[0]?.title ?? t(`memory.source.${r.sourceKind}`)}
                    </span>
                  </td>
                  <td className="num px-3 py-3 align-middle text-fg-muted">
                    {r.relationshipCount}
                  </td>
                  <td className="num px-3 py-3 align-middle text-fg-muted">
                    {f.date(r.updatedAt.slice(0, 10))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
