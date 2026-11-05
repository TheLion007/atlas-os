"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { describeError, useGraph } from "@/client/hooks";
import { useSource } from "@/client/provider";
import type { TimelineModel } from "@/domain/timeline";
import { buildTimeline } from "@/domain/timeline";
import { useI18n } from "@/i18n/I18nProvider";
import { BREAKPOINT, useMediaQuery } from "@/lib/use-media-query";
import { usePeek } from "@/lib/url-state";
import { cn } from "@/lib/cn";
import { GanttBoard } from "../canvases/GanttBoard";
import { hrefKeepingState } from "../shell/nav";
import { useUi } from "../shell/ui-store";
import { Icon } from "../ui/Icon";
import { ObjectChip } from "../ui/ObjectChip";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";

/** Mobile: a vertical agenda, grouped by month, instead of a horizontal board. */
export function TimelineAgenda({
  model,
  onSelect,
  selectedId,
  hrefFor,
}: {
  model: TimelineModel;
  onSelect: (id: string) => void;
  selectedId: string | null;
  hrefFor: (id: string) => string;
}) {
  const { t, f } = useI18n();
  const items = model.rows
    .flatMap((r) => r.items.map((i) => ({ ...i, project: r.title })))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
  const months = new Map<string, typeof items>();
  for (const i of items) {
    const key = i.date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), i]);
  }
  const monthName = (key: string) => f.monthYear(key);

  return (
    <div className="flex flex-col gap-6" data-view="agenda">
      {[...months.entries()].map(([key, list]) => (
        <section key={key} aria-label={monthName(key)} className="flex flex-col gap-3">
          <h2 className="label">{monthName(key)}</h2>
          <ul className="flex flex-col gap-3">
            {list.map((i) => (
              <li key={i.id} className="flex flex-col gap-1">
                <ObjectChip
                  object={{ id: i.id, type: i.type, title: i.title, status: i.status }}
                  selected={selectedId === i.id}
                  onPeek={onSelect}
                  href={hrefFor(i.id)}
                />
                <p className="num pl-2 text-xs text-fg-muted">
                  {f.date(i.date)} · {i.project}
                  {i.slipDays
                    ? ` · ${t("tl.vsBaseline", { delta: `${i.slipDays > 0 ? "+" : "−"}${Math.abs(i.slipDays)}` })}`
                    : ""}
                  {i.blocked ? ` · ${t("tl.blockedSuffix")}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The Timeline lens: 2026–2032 by default (quarters on zoom), rows by project, milestone
 * diamonds, dependency hairlines, a today line, and slip drawn as a ghost. Below the tablet
 * width it is a vertical agenda. Sand marks the today line here, the one focal element.
 */
export function TimelineLens() {
  const { t } = useI18n();
  const openCreate = useUi((s) => s.openCreate);
  const graph = useGraph();
  const source = useSource();
  const params = useSearchParams();
  const [peekId, setPeek] = usePeek();
  const wide = useMediaQuery(BREAKPOINT.md);
  const [zoom, setZoom] = useState<"year" | "quarter">("quarter");
  const today = source?.today() ?? null;

  const model = useMemo(
    () => (graph.data && today ? buildTimeline(graph.data.nodes, graph.data.edges, today) : null),
    [graph.data, today],
  );

  if (graph.isPending || !model) {
    return graph.isError ? null : <LoadingState label={t("nav.timeline")} lines={4} />;
  }
  if (graph.isError) {
    const { title, message } = describeError(graph.error, t);
    return <ErrorState title={title} message={message} onRetry={() => void graph.refetch()} />;
  }
  if (model.rows.length === 0) {
    return (
      <EmptyState
        title={t("tl.emptyTitle")}
        description={t("tl.emptyBody")}
        action={
          <button
            type="button"
            onClick={() => openCreate({ type: "project" })}
            className="inline-flex h-10 items-center gap-2 rounded-[12px] bg-fg px-4 text-[13.5px] font-semibold text-bg transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-px active:scale-[0.96]"
          >
            <Icon name="plus" />
            {t("tl.emptyCreate")}
          </button>
        }
      />
    );
  }

  const hrefFor = (id: string) => hrefKeepingState(`/objects/${id}`, params);

  return (
    <div className="mx-auto -my-4 flex max-w-[1300px] flex-col gap-5 px-4 pt-[26px] pb-[60px] md:-my-6 md:px-9">
      <h2 className="font-display text-[34px] leading-none font-extrabold tracking-[-0.03em]">
        {t("nav.timeline")}
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-fg-muted">{t("tl.hint")}</p>
        {wide && (
          <div
            role="group"
            aria-label={t("tl.zoom")}
            className="inline-flex gap-1 rounded-full bg-sunk p-1"
          >
            {(["year", "quarter"] as const).map((z) => (
              <button
                key={z}
                type="button"
                aria-pressed={zoom === z}
                onClick={() => setZoom(z)}
                className={cn(
                  "rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors duration-(--duration-hover)",
                  zoom === z ? "bg-surface text-fg shadow-card" : "text-fg-subtle hover:text-fg",
                )}
              >
                {z === "year" ? t("tl.years") : t("tl.quarters")}
              </button>
            ))}
          </div>
        )}
      </div>

      {wide ? (
        <GanttBoard
          model={model}
          today={today as string}
          zoom={zoom}
          selectedId={peekId}
          onSelect={setPeek}
          accentToday
        />
      ) : (
        <TimelineAgenda model={model} onSelect={setPeek} selectedId={peekId} hrefFor={hrefFor} />
      )}
    </div>
  );
}
