"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useGraph } from "@/client/hooks";
import { useSource } from "@/client/provider";
import { enrich, projectColor } from "@/design/palette";
import type { ApiObject } from "@/domain/api-types";
import { descendantsOf, projectCards } from "@/domain/project-view";
import { useI18n } from "@/i18n/I18nProvider";
import { hrefKeepingState } from "../shell/nav";
import { LoadingState } from "../ui/states";

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const tint = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;

type Mode = "domain" | "priority" | "progress";

interface Item {
  id: string;
  project: string;
  name: string;
  big: boolean;
  progress: number;
  domain: string;
  prio: number;
  color: string;
}

/** Where each domain's territory sits on the 1600 × 1000 world, as in the design. */
const DOMAIN_SPOTS: Record<string, [number, number]> = {
  Web: [380, 330],
  Produit: [930, 270],
  Docs: [1310, 560],
  Infra: [600, 760],
  Recherche: [1060, 790],
  Divers: [180, 780],
};
const SPARE_SPOTS: [number, number][] = [
  [1400, 200],
  [260, 180],
  [760, 520],
  [1450, 820],
  [300, 500],
  [1000, 540],
];

/**
 * The Map of the design: your projects as territories you can regroup by domain, priority or
 * progress. Each project is a ring that fills with its progress, its sub-projects orbit it, and
 * a click opens its card on the right with a button to the real project page. Drag to pan, wheel
 * or the buttons to zoom. Everything is read from the real graph.
 */
export function TerritoryMap() {
  const { t, f } = useI18n();
  const graph = useGraph();
  const source = useSource();
  const router = useRouter();
  const params = useSearchParams();
  const today = source?.today() ?? new Date().toISOString().slice(0, 10);
  const [mode, setMode] = useState<Mode>("domain");
  const [sel, setSel] = useState<string | null>(null);
  const [view, setView] = useState({ z: 0.62, x: 20, y: 10 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const model = useMemo(() => {
    if (!graph.data) return null;
    const { nodes, edges } = graph.data;
    const cards = projectCards(nodes, edges, today);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const items: Item[] = [];
    for (const c of cards) {
      const node = byId.get(c.id) as ApiObject;
      const kind = typeof node.details?.kind === "string" ? node.details.kind : "";
      const domain = !kind || kind === "general" ? t("map2.misc") : kind;
      const prio = typeof node.details?.priority === "number" ? node.details.priority : 2;
      const color = enrich(projectColor(c.color, c.id));
      items.push({
        id: c.id,
        project: c.id,
        name: c.title,
        big: true,
        progress: Math.round((c.progress ?? 0) * 100),
        domain,
        prio,
        color,
      });
      for (const s of c.subProjects)
        items.push({
          id: s.id,
          project: c.id,
          name: s.title,
          big: false,
          progress: Math.round((s.progress ?? 0) * 100),
          domain,
          prio,
          color,
        });
    }
    return { items, cards, byId, nodes, edges };
  }, [graph.data, today, t]);

  const layout = useMemo(() => {
    if (!model) return null;
    const { items } = model;
    const pos = new Map<string, [number, number]>();
    const regions: {
      key: string;
      label: string;
      count: number;
      x: number;
      y: number;
      w: number;
      h: number;
      round: boolean;
      color: string | null;
      hot: boolean;
    }[] = [];
    const orbit = (parent: [number, number], subs: Item[], rx: number, ry: number) =>
      subs.forEach((s, j) => {
        const a = -Math.PI / 2 + (j + 0.5) * ((2 * Math.PI) / subs.length);
        pos.set(s.id, [parent[0] + Math.cos(a) * rx, parent[1] + Math.sin(a) * ry]);
      });

    if (mode === "domain") {
      const domains = [...new Set(items.filter((i) => i.big).map((i) => i.domain))];
      let spare = 0;
      for (const d of domains) {
        const [cx, cy] = DOMAIN_SPOTS[d] ?? SPARE_SPOTS[spare++ % SPARE_SPOTS.length] ?? [800, 500];
        const ps = items.filter((i) => i.big && i.domain === d);
        regions.push({
          key: d,
          label: d,
          count: items.filter((i) => i.domain === d).length,
          x: cx - 230,
          y: cy - 175,
          w: 460,
          h: 350,
          round: true,
          color: (ps[0] as Item).color,
          hot: false,
        });
        ps.forEach((p, k) => {
          const at: [number, number] = [cx + (k - (ps.length - 1) / 2) * 120, cy + 10];
          pos.set(p.id, at);
          orbit(
            at,
            items.filter((i) => !i.big && i.project === p.id),
            125,
            105,
          );
        });
      }
    } else if (mode === "priority") {
      [1, 2, 3, 4].forEach((pr, i) => {
        const cx = 230 + i * 390;
        const ps = items.filter((x) => x.big && x.prio === pr);
        regions.push({
          key: `p${pr}`,
          label: t(`map2.prio.${pr}` as "map2.prio.1"),
          count: items.filter((x) => x.prio === pr).length,
          x: cx - 175,
          y: 40,
          w: 350,
          h: 920,
          round: false,
          color: null,
          hot: i === 0,
        });
        ps.forEach((p, k) => {
          const at: [number, number] = [cx, 230 + k * 330];
          pos.set(p.id, at);
          orbit(
            at,
            items.filter((x) => !x.big && x.project === p.id),
            110,
            100,
          );
        });
      });
    } else {
      ["0 – 25 %", "25 – 50 %", "50 – 75 %", "75 – 100 %"].forEach((label, i) =>
        regions.push({
          key: `a${i}`,
          label,
          count: items.filter((x) => Math.min(3, Math.floor(x.progress / 25)) === i).length,
          x: 120 + i * 345,
          y: 40,
          w: 335,
          h: 920,
          round: false,
          color: null,
          hot: i === 3,
        }),
      );
      const projects = items.filter((i) => i.big);
      const lane = new Map(projects.map((p, i) => [p.id, 170 + i * 165]));
      for (const x of items) {
        const bx = 120 + (Math.min(99, x.progress) / 100) * 1380;
        const side = x.big ? 0 : x.id.charCodeAt(x.id.length - 1) % 2 ? 62 : -62;
        pos.set(x.id, [Math.max(170, Math.min(1450, bx)), (lane.get(x.project) ?? 800) + side]);
      }
    }
    return { pos, regions };
  }, [model, mode, t]);

  if (graph.isPending || !model || !layout)
    return <LoadingState label={t("map2.title")} lines={4} />;

  const cur = sel ? model.items.find((i) => i.id === sel) : undefined;
  const curCard = cur ? model.cards.find((c) => c.id === cur.project) : undefined;
  const curNode = cur ? model.byId.get(cur.project) : undefined;
  const openTasks = cur
    ? cur.big
      ? (curCard?.tasksOpen ?? 0)
      : [...descendantsOf(cur.id, model.edges)].filter((id) => {
          const n = model.byId.get(id);
          return n?.type === "task" && n.status !== "done" && n.status !== "dropped";
        }).length
    : 0;

  const zoom = (factor: number) =>
    setView((v) => ({ ...v, z: Math.max(0.35, Math.min(1.8, v.z * factor)) }));
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div
      className="relative -m-4 h-[calc(100dvh-var(--topbar-h))] cursor-grab overflow-hidden bg-bg select-none md:-m-6"
      style={{
        backgroundImage: "radial-gradient(var(--color-border-strong) 1px, transparent 1.3px)",
        backgroundSize: "26px 26px",
      }}
      onMouseDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        setDragging(true);
        const move = (ev: globalThis.MouseEvent) => {
          const d = drag.current;
          if (d) setView((v) => ({ ...v, x: d.vx + ev.clientX - d.x, y: d.vy + ev.clientY - d.y }));
        };
        const up = () => {
          drag.current = null;
          setDragging(false);
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
      onWheel={(e) => zoom(e.deltaY < 0 ? 1.08 : 1 / 1.08)}
    >
      <div
        className="absolute top-0 left-0 h-[1000px] w-[1600px] origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
          transition: dragging ? "none" : "transform .45s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {layout.regions.map((r) => {
          const bd = r.color
            ? tint(r.color, 35)
            : r.hot
              ? "color-mix(in srgb, var(--color-accent) 40%, transparent)"
              : "var(--color-border-strong)";
          const ring = r.color ? tint(r.color, 22) : "transparent";
          return (
            <div
              key={r.key}
              className="absolute"
              style={{
                left: r.x,
                top: r.y,
                width: r.w,
                height: r.h,
                borderRadius: r.round ? "50%" : 28,
                background: r.color
                  ? tint(r.color, 7)
                  : r.hot
                    ? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
                    : "var(--color-heat-0)",
                border: `1.5px dashed ${bd}`,
                transition: `all .8s cubic-bezier(.34,1.2,.64,1)`,
              }}
            >
              <div
                className="absolute inset-[26px] border"
                style={{ borderRadius: "inherit", borderColor: ring }}
              />
              <div
                className="absolute inset-[58px] border"
                style={{ borderRadius: "inherit", borderColor: ring }}
              />
              <div className="absolute inset-x-0 top-[18px] flex flex-col items-center gap-[2px]">
                <span className="font-display text-[22px] font-extrabold tracking-[-0.02em]">
                  {r.label}
                </span>
                <span className="num text-[11px] text-fg-subtle">
                  {t("map2.items", { count: r.count })}
                </span>
              </div>
            </div>
          );
        })}

        {model.items.map((m) => {
          const at = layout.pos.get(m.id) ?? [100, 900];
          const size = m.big ? 76 : 40;
          const selected = sel === m.id;
          const style: CSSProperties = {
            left: at[0],
            top: at[1],
            zIndex: m.big ? 3 : 2,
            transition: `left .9s cubic-bezier(.34,1.25,.64,1), top .9s cubic-bezier(.34,1.25,.64,1)`,
          };
          return (
            <div
              key={m.id}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
              style={style}
            >
              <button
                type="button"
                aria-label={m.name}
                aria-pressed={selected}
                onMouseDown={stop}
                onClick={(e) => {
                  stop(e);
                  setSel(m.id);
                }}
                className="grid cursor-pointer place-items-center rounded-full transition-[transform,box-shadow] duration-[400ms] hover:-translate-y-[3px] hover:scale-[1.12]"
                style={{
                  width: size,
                  height: size,
                  background: `conic-gradient(${m.color} ${m.progress * 3.6}deg, var(--color-sunk) 0)`,
                  boxShadow: selected
                    ? `0 0 0 5px ${tint(m.color, 35)}, var(--shadow-pop)`
                    : "var(--shadow-card)",
                  transitionTimingFunction: SPRING,
                }}
              >
                <span
                  className="num grid place-items-center rounded-full bg-surface font-bold"
                  style={{
                    width: size - (m.big ? 14 : 8),
                    height: size - (m.big ? 14 : 8),
                    fontSize: m.big ? 15 : 10,
                    color: m.color,
                  }}
                >
                  {m.progress}
                  {m.big ? " %" : ""}
                </span>
              </button>
              <span
                className="max-w-[160px] rounded-[8px] border border-border bg-surface px-[9px] py-[3px] text-center whitespace-nowrap"
                style={{ fontSize: m.big ? 13.5 : 11.5, fontWeight: m.big ? 700 : 500 }}
              >
                {m.name}
              </span>
            </div>
          );
        })}
      </div>

      <div
        className="absolute top-5 left-6 flex cursor-default flex-wrap items-center gap-[14px]"
        onMouseDown={stop}
      >
        <h2 className="font-display text-[30px] font-extrabold tracking-[-0.03em]">
          {t("map2.title")}
        </h2>
        <div className="flex gap-[2px] rounded-[12px] border border-border bg-panel p-1 shadow-card">
          <span className="px-2 py-[7px] text-[12.5px] text-fg-subtle">{t("map2.groupBy")}</span>
          {(["domain", "priority", "progress"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-sound="drop"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-[9px] px-[13px] py-[7px] text-[13px] font-semibold transition-all duration-[250ms] ${
                mode === m ? "bg-surface text-fg shadow-card" : "text-fg-subtle"
              }`}
            >
              {t(`map2.mode.${m}`)}
            </button>
          ))}
        </div>
      </div>

      <div
        className="absolute bottom-[22px] left-6 flex cursor-default items-center gap-1 rounded-[12px] border border-border bg-surface p-1 shadow-card"
        onMouseDown={stop}
      >
        <button
          type="button"
          aria-label={t("map.zoomOut")}
          onClick={() => zoom(1 / 1.2)}
          className="size-8 rounded-[8px] text-[18px] hover:bg-sunk"
        >
          −
        </button>
        <button
          type="button"
          aria-label={t("map2.resetZoom")}
          onClick={() => setView({ z: 0.62, x: 20, y: 10 })}
          className="num h-8 min-w-[54px] rounded-[8px] text-[11px] hover:bg-sunk"
        >
          {Math.round(view.z * 100)} %
        </button>
        <button
          type="button"
          aria-label={t("map.zoomIn")}
          onClick={() => zoom(1.2)}
          className="size-8 rounded-[8px] text-[18px] hover:bg-sunk"
        >
          +
        </button>
      </div>

      {cur && curNode && (
        <aside
          className="absolute top-5 right-5 flex w-[310px] cursor-default flex-col gap-3 rounded-[22px] border border-border-strong bg-surface p-5 shadow-pop"
          style={{ animation: "slide-in .45s cubic-bezier(.34,1.3,.64,1)" }}
          onMouseDown={stop}
        >
          <div className="flex items-center gap-2">
            <i className="size-[10px] rounded-[3px]" style={{ background: cur.color }} />
            <span className="flex-1 text-xs text-fg-subtle">
              {cur.big ? t("map2.project") : t("map2.subOf", { name: curNode.title })}
            </span>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={() => setSel(null)}
              className="grid size-7 place-items-center rounded-[8px] bg-sunk"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <h3 className="font-display text-[24px] leading-[1.08] font-extrabold tracking-[-0.02em]">
            {cur.name}
          </h3>
          <p className="text-[13.5px] leading-[1.5] text-fg-muted">
            {cur.big
              ? typeof curNode.details?.description === "string"
                ? curNode.details.description
                : ""
              : t("map2.partOf", { name: curNode.title })}
          </p>
          <div className="flex items-center gap-[10px]">
            <div className="h-2 flex-1 overflow-hidden rounded-[8px] bg-sunk">
              <div
                className="h-full rounded-[8px] transition-[width] duration-[600ms]"
                style={{ width: `${cur.progress}%`, background: cur.color }}
              />
            </div>
            <span className="num text-[13px] font-bold">{cur.progress} %</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12.5px]">
            {(
              [
                [t("map2.domain"), cur.domain],
                [t("map2.priority"), t(`map2.prio.${cur.prio}` as "map2.prio.1")],
                [t("map2.due"), curCard?.targetDate ? f.date(curCard.targetDate) : "—"],
                [t("map2.openTasks"), String(openTasks)],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="flex flex-col gap-[2px] rounded-[10px] bg-sunk px-[10px] py-[9px]"
              >
                <span className="text-fg-subtle">{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => router.push(hrefKeepingState(`/objects/${cur.project}`, params))}
            className="rounded-[12px] bg-fg py-[10px] text-[13.5px] font-semibold text-bg transition-transform duration-[350ms] hover:-translate-y-0.5"
            style={{ transitionTimingFunction: SPRING }}
          >
            {t("map2.open")}
          </button>
        </aside>
      )}
    </div>
  );
}
