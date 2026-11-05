"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import type { ObjectType } from "@/domain/enums";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { useElementSize } from "@/lib/use-element-size";
import {
  GraphEngine,
  type GraphEdgeInput,
  type GraphNodeInput,
  type GraphState,
} from "./graph-engine";

export type { GraphState } from "./graph-engine";

/** What the surrounding controls can ask of the canvas. */
export interface GraphHandle {
  fit: () => void;
  reset: () => void;
  zoomBy: (factor: number) => void;
  /** Move the camera to a node, or to the node and its direct relations. */
  focusOn: (id: string, opts?: { neighbours?: boolean }) => void;
}

interface GraphCanvasProps {
  nodes: readonly GraphNodeInput[];
  edges: readonly GraphEdgeInput[];
  /**
   * `force`: the live simulation places the nodes. `fixed`: positions come from `fixed` (the
   * mobile ego-view); nothing moves, but pan and zoom still work.
   */
  mode?: "force" | "fixed";
  fixed?: ReadonlyMap<string, { x: number; y: number }>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Double-click: open the object. */
  onOpen?: (id: string) => void;
  /** Path mode: the cause → effect chain to light up; everything else recedes. */
  path?: { nodeIds: ReadonlySet<string>; edgeIds: ReadonlySet<string> } | null;
  /** Types hidden by the legend filter. */
  hiddenTypes?: ReadonlySet<ObjectType>;
  /** Focus mode: the selection and its direct relations stay readable, all else is subdued. */
  focusMode?: boolean;
  /** The one focal element of the screen may take the sand accent (the selected node's ring). */
  accent?: boolean;
  onStateChange?: (state: GraphState) => void;
  onZoom?: (percent: number) => void;
  handleRef?: Ref<GraphHandle>;
  className?: string;
}

/**
 * The signature surface: a living network on a 2D canvas. Positions come from a real force
 * simulation (nodes glide into place, settle and stop), you pan and zoom toward the cursor,
 * drag any node and watch its neighbours follow, and select to light up direct relations with a
 * soft flow along them. It is a space to move around in, not a diagram: no grid, no snapping.
 *
 * The canvas itself is decorative to assistive technology; the same objects are offered as a
 * list of buttons, and the surrounding lens adds search, filters and camera controls that work
 * from the keyboard. See `graph-engine.ts` for the mechanics.
 */
export function GraphCanvas({
  nodes,
  edges,
  mode = "force",
  fixed,
  selectedId = null,
  onSelect,
  onOpen,
  path = null,
  hiddenTypes,
  focusMode = false,
  accent = false,
  onStateChange,
  onZoom,
  handleRef,
  className,
}: GraphCanvasProps) {
  const { t, typeLabel } = useI18n();
  const [measure, size] = useElementSize<HTMLDivElement>({ width: 960, height: 600 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const [engine] = useState(
    () =>
      new GraphEngine({
        edgeName: (kind) => kind,
        typeName: (type) => type,
      }),
  );

  const hidden = useMemo(() => hiddenTypes ?? new Set<ObjectType>(), [hiddenTypes]);
  const visibleNodes = useMemo(() => nodes.filter((n) => !hidden.has(n.type)), [nodes, hidden]);
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }, [edges, visibleNodes]);

  // Callbacks and text go in through `configure`, so the engine always speaks the current language.
  useEffect(() => {
    engine.configure({
      onSelect,
      onOpen,
      onState: onStateChange,
      onZoom,
      edgeName: (kind) => t(`edge.${kind}`),
      typeName: (type) => typeLabel(type),
    });
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    engine.attach(canvas);
    return () => engine.dispose();
  }, [engine]);

  useEffect(() => {
    engine.attachMinimap(minimapRef.current);
    return () => engine.attachMinimap(null);
  }, [engine]);

  useEffect(() => {
    engine.setData(visibleNodes, visibleEdges, mode, fixed);
  }, [engine, visibleNodes, visibleEdges, mode, fixed]);

  useEffect(() => {
    engine.setSize(size.width, size.height);
  }, [engine, size]);

  useEffect(() => {
    engine.setView({ selectedId, path, focusMode, accent, hiddenCount: hidden.size });
  }, [engine, selectedId, path, focusMode, accent, hidden]);

  const api = useMemo<GraphHandle>(
    () => ({
      fit: () => engine.fit(),
      reset: () => engine.reset(),
      zoomBy: (factor) => engine.zoomBy(factor),
      focusOn: (id, opts) => engine.focusOn(id, opts),
    }),
    [engine],
  );
  useImperativeHandle(handleRef, () => api, [api]);

  // The same camera controls from the keyboard, whenever focus is inside the graph.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "+" || e.key === "=") api.zoomBy(1.4);
    else if (e.key === "-" || e.key === "_") api.zoomBy(1 / 1.4);
    else if (e.key === "0") api.fit();
    else if (e.key === "Escape" && selectedId) onSelect?.(null);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={measure}
      role="group"
      aria-label={t("graph.aria", { objects: visibleNodes.length, relations: visibleEdges.length })}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        // The nodes are drawn on a canvas: the node under the pointer gets the object menu.
        const canvas = canvasRef.current;
        if (!canvas) return;
        const box = canvas.getBoundingClientRect();
        const node = engine.nodeAt(e.clientX - box.left, e.clientY - box.top);
        if (!node) return;
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("atlas:object-menu", {
            detail: { id: node.id, x: e.clientX, y: e.clientY },
          }),
        );
      }}
      className={cn(
        "relative h-full w-full overflow-hidden",
        !className?.includes("bg-") && "bg-bg",
        className,
      )}
      data-testid="graph-canvas"
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 touch-none"
        style={{ width: size.width, height: size.height }}
      />
      {/* Overview: the whole graph and the window you are looking at; click to jump there. */}
      <canvas
        ref={minimapRef}
        aria-hidden="true"
        data-testid="graph-minimap"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          engine.minimapJump(e.clientX - r.left, e.clientY - r.top);
        }}
        onPointerMove={(e) => {
          // Dragging the rectangle moves the view with it, no easing.
          if (e.buttons !== 1) return;
          const r = e.currentTarget.getBoundingClientRect();
          engine.minimapJump(e.clientX - r.left, e.clientY - r.top, true);
        }}
        className="absolute right-[14px] bottom-[14px] hidden h-[118px] w-[180px] cursor-grab touch-none rounded-[12px] border border-border bg-panel shadow-card md:block"
      />
      {/* The same objects as text, for keyboard and screen-reader use. */}
      <ul className={cn("sr-only")} aria-label={t("graph.listLabel")}>
        {visibleNodes.slice(0, 300).map((n) => (
          <li key={n.id}>
            <button
              type="button"
              aria-pressed={n.id === selectedId}
              onClick={() => onSelect?.(n.id === selectedId ? null : n.id)}
            >
              {typeLabel(n.type)}: {n.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
