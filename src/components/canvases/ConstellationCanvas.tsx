"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type Ref,
} from "react";
import type { ApiEdge, ApiObject } from "@/domain/api-types";
import { MEMORY_TYPES } from "@/domain/enums";
import { memoryGraphSubset, type MemoryRow } from "@/domain/memory-model";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { useElementSize } from "@/lib/use-element-size";
import { useMediaQuery } from "@/lib/use-media-query";
import { Icon, type IconName } from "../ui/Icon";
import { ConstellationCompute } from "./constellation-compute";
import { ConstellationEngine, webglAvailable } from "./constellation-engine";
import { GraphCanvas, type GraphHandle } from "./GraphCanvas";

export interface ConstellationHandle {
  fit: () => void;
  zoomBy: (factor: number) => void;
  focusOn: (id: string) => void;
}

interface ConstellationCanvasProps {
  /** The memories to show (already filtered by the lens). */
  rows: readonly MemoryRow[];
  /** The whole object graph, for hubs, related objects and stored relations. */
  objects: readonly ApiObject[];
  edges: readonly ApiEdge[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onOpen?: (id: string) => void;
  handleRef?: Ref<ConstellationHandle>;
  className?: string;
}

const noop = () => () => {};

const control =
  "inline-flex size-8 items-center justify-center text-fg-muted transition-colors duration-(--duration-hover) hover:bg-hover hover:text-fg";

function ControlButton({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={control} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/**
 * The Memory Graph: every memory as a point of light in a dark space, grouped into clusters by
 * project, joined by fibres that are real relations. A WebGL scene (see `constellation-engine.ts`)
 * with minimal HTML labels over it; where WebGL is unavailable, the regular Graph canvas shows
 * the same memories instead, so nothing is ever lost.
 *
 * As with the Graph, the canvas is decorative to assistive technology: the same memories are
 * offered as a list of buttons, and camera controls work from the keyboard.
 */
export function ConstellationCanvas({
  rows,
  objects,
  edges,
  selectedId = null,
  onSelect,
  onOpen,
  handleRef,
  className,
}: ConstellationCanvasProps) {
  const { t, typeLabel } = useI18n();
  const supported = useSyncExternalStore(noop, webglAvailable, () => null);
  const [measure, size] = useElementSize<HTMLDivElement>({ width: 960, height: 600 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const [engine] = useState(() => new ConstellationEngine());
  const [failed, setFailed] = useState(false);
  const coarse = useMediaQuery("(pointer: coarse)");
  const fallbackHandle = useRef<GraphHandle | null>(null);

  const [compute] = useState(() => new ConstellationCompute());
  const [counts, setCounts] = useState({ clusters: 0, relations: 0 });
  const [composing, setComposing] = useState(true);

  useEffect(() => {
    engine.configure(
      { onSelect, onOpen },
      {
        meta: (node, cluster) => {
          const where =
            cluster?.source === "unfiled" ? t("memory.graph.unfiled") : (cluster?.title ?? "");
          if (node.kind === "memory")
            return [
              node.memoryType && MEMORY_TYPES.includes(node.memoryType)
                ? t(`memoryType.${node.memoryType}`)
                : "",
              where,
            ]
              .filter(Boolean)
              .join(" · ");
          return typeLabel(node.type);
        },
        cluster: (c) => (c.source === "unfiled" ? t("memory.graph.unfiled") : c.title),
      },
    );
  });

  const webgl = supported === true && !failed;
  // Until the browser has been asked (server render, first paint) neither view is committed to.
  const fallbackMode = supported === false || failed;

  useEffect(() => {
    const canvas = canvasRef.current;
    const labels = labelsRef.current;
    if (!webgl || !canvas || !labels) return;
    if (!engine.attach(canvas, labels)) {
      // A browser that reports WebGL but cannot create a context still gets a graph.
      queueMicrotask(() => setFailed(true));
      return;
    }
    return () => engine.dispose();
  }, [engine, webgl]);

  // The model and its layout are composed off the main thread, then handed to the renderer.
  useEffect(() => {
    if (!webgl) return;
    let live = true;
    void compute.run(rows, objects, edges, engine.placedPositions).then((result) => {
      if (!live || !result) return;
      engine.setData(result.constellation, result.positions);
      setCounts({
        clusters: result.constellation.clusters.length,
        relations: result.constellation.links.length,
      });
      setComposing(false);
    });
    return () => {
      live = false;
    };
  }, [engine, compute, webgl, rows, objects, edges]);

  useEffect(() => () => compute.dispose(), [compute]);

  useEffect(() => {
    if (webgl) engine.setSize(size.width, size.height);
  }, [engine, webgl, size]);

  useEffect(() => {
    if (webgl) engine.setSelected(selectedId);
  }, [engine, webgl, selectedId]);

  const api = useMemo<ConstellationHandle>(
    () => ({
      fit: () => (webgl ? engine.fit() : fallbackHandle.current?.fit()),
      zoomBy: (f) => (webgl ? engine.zoomBy(f) : fallbackHandle.current?.zoomBy(f)),
      focusOn: (id) =>
        webgl ? engine.focusOn(id) : fallbackHandle.current?.focusOn(id, { neighbours: true }),
    }),
    [engine, webgl],
  );
  useImperativeHandle(handleRef, () => api, [api]);

  const fallback = useMemo(() => {
    if (!fallbackMode) return null;
    const subset = memoryGraphSubset(objects, edges, { depth: 1 });
    const shown = new Set(rows.map((r) => r.id));
    const nodes = subset.nodes.filter((n) => n.type !== "memory" || shown.has(n.id));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: subset.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  }, [fallbackMode, objects, edges, rows]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "+" || e.key === "=") api.zoomBy(1.4);
    else if (e.key === "-" || e.key === "_") api.zoomBy(1 / 1.4);
    else if (e.key === "0") api.fit();
    else if (e.key === "Escape" && selectedId) onSelect?.(null);
    else return;
    e.preventDefault();
  };

  const memoryCount = rows.length;
  return (
    <div
      ref={measure}
      role="group"
      aria-label={t("memory.graph.aria", {
        memories: memoryCount,
        clusters: counts.clusters,
        relations: counts.relations,
      })}
      onKeyDown={onKeyDown}
      className={cn("relative h-full w-full overflow-hidden bg-bg", className)}
      data-testid="memory-constellation"
    >
      {fallback ? (
        <GraphCanvas
          nodes={fallback.nodes}
          edges={fallback.edges}
          selectedId={selectedId}
          onSelect={onSelect}
          onOpen={onOpen}
          handleRef={fallbackHandle}
        />
      ) : (
        <>
          <canvas
            ref={canvasRef}
            aria-hidden="true"
            className="absolute inset-0 touch-none"
            style={{ width: size.width, height: size.height }}
          />
          <div ref={labelsRef} className="cst-layer" aria-hidden="true" />
          {composing && (
            <p
              role="status"
              className="label pointer-events-none absolute inset-0 flex items-center justify-center normal-case tracking-normal"
            >
              {t("memory.graph.composing")}
            </p>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
            <p className="label max-w-[70%] truncate normal-case tracking-normal opacity-70">
              {coarse ? t("memory.graph.hintTouch") : t("memory.graph.hint")}
            </p>
            <div
              role="group"
              aria-label={t("graph.controls")}
              className="pointer-events-auto flex overflow-hidden rounded-control border border-border bg-bg"
            >
              <ControlButton
                icon="plus"
                label={t("graph.zoomIn")}
                onClick={() => api.zoomBy(1.5)}
              />
              <ControlButton
                icon="minus"
                label={t("graph.zoomOut")}
                onClick={() => api.zoomBy(1 / 1.5)}
              />
              <ControlButton icon="fit" label={t("graph.fit")} onClick={() => api.fit()} />
            </div>
          </div>
          <p className="label pointer-events-none absolute top-3 left-3 normal-case tracking-normal opacity-60">
            {t("memory.graph.legend")}
          </p>
          {/* The same memories as text, for keyboard and screen-reader use. */}
          <ul className="sr-only" aria-label={t("memory.title")}>
            {rows.slice(0, 500).map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-pressed={r.id === selectedId}
                  onClick={() => {
                    onSelect?.(r.id === selectedId ? null : r.id);
                    if (r.id !== selectedId) api.focusOn(r.id);
                  }}
                >
                  {typeLabel("memory")}: {r.title}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
