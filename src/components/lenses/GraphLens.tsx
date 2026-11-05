"use client";

import { useSelectedObject } from "@/lib/deletion-store";
import { DeleteButton } from "../shell/DeleteButton";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { describeError, useGraph } from "@/client/hooks";
import { projectColor } from "@/design/palette";
import type { ApiObject } from "@/domain/api-types";
import { OBJECT_TYPES, type ObjectType } from "@/domain/enums";
import { graphMeta } from "@/domain/project-view";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { useElementSize } from "@/lib/use-element-size";
import { BREAKPOINT, useMediaQuery } from "@/lib/use-media-query";
import { GraphCanvas, type GraphHandle } from "../canvases/GraphCanvas";
import { SHAPE_OF } from "../canvases/graph-shapes";
import { degrees, egoLayout } from "../canvases/graph-view";
import { hrefKeepingState } from "../shell/nav";
import { useUi } from "../shell/ui-store";
import { Icon } from "../ui/Icon";
import { EmptyState, ErrorState, LoadingState } from "../ui/states";
import { EdgeSample, ShapeIcon } from "./GraphGlyphs";

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * The Graph, as designed: a title and one pill per kind of object (click to hide or show it), the
 * canvas on a dotted card with its zoom box, its mini-map and the key to the links, and on the
 * right the card of the selected node: its kind, name, project, description, progress, its
 * connections (click one to move to that node) and an Open button. Double-click a node, or press
 * Open, to reach the real page. The canvas itself (forces, groups, shapes, hover, inertia) is the
 * app's own.
 */
export function GraphLens() {
  const { t, typeLabel } = useI18n();
  const graph = useGraph();
  const router = useRouter();
  const params = useSearchParams();
  const openCreate = useUi((s) => s.openCreate);
  const wide = useMediaQuery(BREAKPOINT.md);
  const [measure, size] = useElementSize<HTMLDivElement>({ width: 960, height: 600 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useSelectedObject(selectedId);
  const [hidden, setHidden] = useState<ReadonlySet<ObjectType>>(new Set());
  const [zoom, setZoom] = useState(100);
  const handle = useRef<GraphHandle | null>(null);

  const nodes = graph.data?.nodes;
  const edges = graph.data?.edges;
  const byId = useMemo(() => new Map((nodes ?? []).map((n) => [n.id, n])), [nodes]);

  // Each node gathers with its project, wears its colour and is sized by progress or weight.
  const styled = useMemo(() => {
    const map = new Map<string, { group: string | null; color: string | null; size?: number }>();
    if (!nodes || !edges) return map;
    const meta = graphMeta(nodes, edges);
    for (const n of nodes) {
      const m = meta.get(n.id);
      const p = m?.group ? byId.get(m.group) : undefined;
      map.set(n.id, {
        group: m?.group ?? null,
        color: p ? projectColor(p.color, p.id) : null,
        size: m?.size,
      });
    }
    return map;
  }, [nodes, edges, byId]);
  const styledNodes = useMemo(
    () =>
      (nodes ?? []).map((n) => ({ id: n.id, type: n.type, title: n.title, ...styled.get(n.id) })),
    [nodes, styled],
  );

  // A narrow screen shows the selected node and its neighbours instead of the whole network.
  const ego = useMemo(() => {
    if (!nodes || !edges || wide) return null;
    const deg = degrees(edges);
    const focus =
      selectedId && nodes.some((n) => n.id === selectedId)
        ? selectedId
        : [...nodes].sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0))[0]?.id;
    if (!focus) return null;
    const view = egoLayout(focus, nodes, edges, size.width, size.height);
    return {
      nodes: view.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        ...styled.get(n.id),
      })),
      edges: view.edges,
      fixed: new Map(view.nodes.map((n) => [n.id, { x: n.x, y: n.y }] as const)),
    };
  }, [nodes, edges, wide, selectedId, size, styled]);

  const counts = useMemo(() => {
    const c = new Map<ObjectType, number>();
    for (const n of nodes ?? []) c.set(n.type, (c.get(n.type) ?? 0) + 1);
    return c;
  }, [nodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (graph.isPending) return <LoadingState label={t("gp.title")} lines={4} />;
  if (graph.isError) {
    const { title, message } = describeError(graph.error, t);
    return <ErrorState title={title} message={message} onRetry={() => void graph.refetch()} />;
  }
  if (!nodes || !edges || nodes.length === 0) {
    return (
      <EmptyState
        title={t("empty.graph.title")}
        description={t("empty.graph.body")}
        action={
          <button
            type="button"
            onClick={() => openCreate({ type: "project" })}
            className="inline-flex h-10 items-center gap-2 rounded-control border border-fg bg-fg px-4 text-bg transition-colors duration-(--duration-hover) hover:border-fg-muted hover:bg-fg-muted"
          >
            <Icon name="plus" />
            {t("create.new.project")}
          </button>
        }
      />
    );
  }

  const href = (id: string) => hrefKeepingState(`/objects/${id}`, params);
  const toggle = (type: ObjectType) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  const select = (id: string) => {
    setSelectedId(id);
    requestAnimationFrame(() => handle.current?.focusOn(id, { neighbours: true }));
  };

  const cur: ApiObject | undefined = selectedId ? byId.get(selectedId) : undefined;
  const curStyle = cur ? styled.get(cur.id) : undefined;
  const curProject = curStyle?.group ? byId.get(curStyle.group) : undefined;
  const hex = cur ? (curStyle?.color ?? `var(--c-type-${cur.type})`) : "";
  const conns = cur
    ? edges
        .filter((e) => e.from === cur.id || e.to === cur.id)
        .map((e) => {
          const out = e.from === cur.id;
          const other = byId.get(out ? e.to : e.from);
          return other
            ? {
                id: e.id,
                other,
                rel: out ? t(`edge.${e.kind}`) : t(`edge.in.${e.kind}` as "edge.in.contains"),
                hex: styled.get(other.id)?.color ?? `var(--c-type-${other.type})`,
              }
            : null;
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
    : [];
  const showProgress = cur?.type === "project" || cur?.type === "sub_project";
  const progress = Math.round((curStyle?.size ?? 0) * 100);
  const detail = cur
    ? cur.type === "sub_project" && curProject
      ? t("gp.subOf", { name: curProject.title })
      : typeof cur.details?.description === "string"
        ? cur.details.description
        : typeof cur.details?.question === "string"
          ? cur.details.question
          : ""
    : "";
  const useEgo = !wide && ego;

  return (
    <div className="-m-4 flex h-[calc(100dvh-var(--topbar-h))] flex-wrap gap-5 overflow-y-auto px-7 pt-[22px] pb-7 md:-m-6 md:flex-nowrap">
      <div className="flex min-h-[420px] min-w-0 flex-[1_1_640px] flex-col gap-[14px] md:h-full">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-[10px] font-display text-[30px] font-extrabold tracking-[-0.03em]">
            {t("gp.title")}
          </h2>
          <div
            role="group"
            aria-label={t("gp.filters")}
            className="flex flex-wrap items-center gap-3"
          >
            {OBJECT_TYPES.filter((ty) => counts.has(ty)).map((ty) => {
              const on = !hidden.has(ty);
              return (
                <button
                  key={ty}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(ty)}
                  className={cn(
                    "flex items-center gap-[7px] rounded-full border py-[6px] pr-[11px] pl-2 text-[12.5px] font-semibold transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.94]",
                    on
                      ? "border-border-strong bg-surface"
                      : "border-border bg-transparent opacity-45",
                  )}
                  style={{ transitionTimingFunction: SPRING }}
                >
                  <span className="text-fg-muted">
                    <ShapeIcon shape={SHAPE_OF[ty]} />
                  </span>
                  {typeLabel(ty, true)}
                  <span className="num text-[10.5px] text-fg-subtle">{counts.get(ty)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div
          ref={measure}
          className="relative min-h-[360px] flex-1 overflow-hidden rounded-[22px] border border-border bg-surface shadow-card"
          style={{
            backgroundImage: "radial-gradient(var(--color-border-strong) 1px, transparent 1.2px)",
            backgroundSize: "22px 22px",
          }}
        >
          <GraphCanvas
            nodes={useEgo ? ego.nodes : styledNodes}
            edges={useEgo ? ego.edges : edges}
            mode={useEgo ? "fixed" : "force"}
            fixed={useEgo ? ego.fixed : undefined}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpen={(id) => router.push(href(id))}
            hiddenTypes={hidden}
            onZoom={setZoom}
            handleRef={handle}
            className="bg-transparent"
            accent
          />

          <div className="pointer-events-none absolute top-[14px] left-4 flex gap-[14px] rounded-[10px] border border-border bg-surface px-[10px] py-[6px] text-[11.5px] text-fg-muted">
            {(["contains", "depends_on", "references"] as const).map((kind) => (
              <span key={kind} className="flex items-center gap-[6px]">
                <EdgeSample kind={kind} />
                {kind === "contains" ? t("edge.in.contains") : t(`edge.${kind}`)}
              </span>
            ))}
          </div>

          <div className="absolute bottom-[14px] left-[14px] flex items-center gap-1 rounded-[12px] border border-border bg-surface p-1 shadow-card">
            <button
              type="button"
              aria-label={t("gp.zoomOut")}
              onClick={() => handle.current?.zoomBy(1 / 1.2)}
              className="size-[30px] rounded-[8px] text-[17px] transition-colors hover:bg-sunk"
            >
              −
            </button>
            <button
              type="button"
              aria-label={t("gp.resetZoom")}
              onClick={() => handle.current?.reset()}
              className="num h-[30px] min-w-[52px] rounded-[8px] text-[11px] transition-colors hover:bg-sunk"
            >
              {zoom} %
            </button>
            <button
              type="button"
              aria-label={t("gp.zoomIn")}
              onClick={() => handle.current?.zoomBy(1.2)}
              className="size-[30px] rounded-[8px] text-[17px] transition-colors hover:bg-sunk"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-w-[270px] flex-[0_1_320px] flex-col gap-[14px] pt-[52px] md:h-full md:overflow-y-auto">
        {cur && (
          <aside
            aria-label={cur.title}
            className="flex flex-col gap-3 rounded-[20px] border border-border bg-surface p-5 shadow-card"
            style={{ animation: `pop-in .35s ${SPRING}` }}
          >
            <span className="num flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
              <i className="size-[9px] rounded-[3px]" style={{ background: hex }} />
              {typeLabel(cur.type)}
            </span>
            <h3 className="font-display text-[23px] leading-[1.1] font-extrabold tracking-[-0.02em]">
              {cur.title}
            </h3>
            {curProject && <span className="text-[13px] text-fg-muted">{curProject.title}</span>}
            {detail && <p className="text-[13.5px] leading-[1.5] text-fg-muted">{detail}</p>}
            {showProgress && (
              <div className="flex items-center gap-[10px]">
                <div className="h-[7px] flex-1 overflow-hidden rounded-[7px] bg-sunk">
                  <div
                    className="h-full rounded-[7px] transition-[width] duration-[600ms]"
                    style={{ width: `${progress}%`, background: hex }}
                  />
                </div>
                <span className="num text-xs font-semibold">{progress} %</span>
              </div>
            )}
            <span className="num mt-[6px] text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase">
              {t("gp.connections", { count: conns.length })}
            </span>
            <ul className="flex flex-col gap-[2px]">
              {conns.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => select(c.other.id)}
                    className="flex w-full items-center gap-[10px] rounded-[10px] p-2 text-left transition-[background-color,transform] duration-300 hover:translate-x-[3px] hover:bg-sunk"
                  >
                    <span className="num w-[82px] flex-none text-[10.5px] text-fg-subtle">
                      {c.rel}
                    </span>
                    <i
                      className="size-[7px] flex-none rounded-[2px]"
                      style={{ background: c.hex }}
                    />
                    <span className="flex-1 text-[13px] font-medium">{c.other.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => router.push(href(cur.id))}
              className="mt-1 rounded-[12px] bg-fg py-[10px] text-[13.5px] font-semibold text-bg transition-transform duration-[350ms] hover:-translate-y-0.5"
              style={{ transitionTimingFunction: SPRING }}
            >
              {t("gp.open")}
            </button>
            <DeleteButton id={cur.id} block />
          </aside>
        )}
        <span className="px-[6px] text-xs leading-[1.5] text-fg-subtle">{t("gp.hint")}</span>
      </div>
    </div>
  );
}
