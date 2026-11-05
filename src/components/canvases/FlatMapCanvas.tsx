"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { OBJECT_TYPE_STYLE } from "@/design/object-types";
import { CANVAS_COLORS as C, typeColor } from "@/design/tokens";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { useElementSize } from "@/lib/use-element-size";
import { borderPaths, landPaths, project, type Point } from "./globe/equirect";
import { loadWorld } from "./globe/world-data";
import type { MapHandle, MapStatus } from "./MapCanvas";
import { dominantType, geoBox, groupMarkers, targetForPlace, type MapModel } from "./map-model";

/** The world is drawn once at this size and then scaled by the camera. */
const MAP_W = 2048;
const MAP_H = 1024;
const MAX_ZOOM = 60;
const MIN_ZOOM = 0.9;

interface Cam {
  /** Zoom relative to "the whole world fits". */
  z: number;
  /** Where the map's centre sits, in screen px from the canvas centre. */
  x: number;
  y: number;
}

interface FlatMapCanvasProps {
  model: MapModel;
  selectedPlaceId: string | null;
  onSelectPlace: (id: string | null) => void;
  pick?: boolean;
  onPick?: (coords: { lat: number; lng: number }) => void;
  onStatus?: (status: MapStatus) => void;
  handleRef?: Ref<MapHandle>;
  className?: string;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * The flat world map: the same real Natural Earth geography as the globe, as a plain
 * equirectangular planisphere you can pan and zoom. It shares the globe's model and handle, so
 * the lens swaps between the two without anything else changing: same places, same selection,
 * same "click to place" mode.
 */
export function FlatMapCanvas({
  model,
  selectedPlaceId,
  onSelectPlace,
  pick = false,
  onPick,
  onStatus,
  handleRef,
  className,
}: FlatMapCanvasProps) {
  const { t } = useI18n();
  const [measure, size] = useElementSize<HTMLDivElement>({ width: 960, height: 520 });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<MapStatus>("loading");
  const [geo, setGeo] = useState<{ land: Point[][]; borders: Point[][] } | null>(null);
  const cam = useRef<Cam>({ z: 1, x: 0, y: 0 });
  const tween = useRef<{ from: Cam; to: Cam; start: number; ms: number } | null>(null);
  const hover = useRef<string | null>(null);
  const raf = useRef(0);
  const latest = useRef({ model, selectedPlaceId, onSelectPlace, pick, onPick, size, geo });
  useEffect(() => {
    latest.current = { model, selectedPlaceId, onSelectPlace, pick, onPick, size, geo };
  });

  const placed = useMemo(() => [...model.places.values()].filter((p) => p.lat !== null), [model]);

  useEffect(() => {
    let alive = true;
    loadWorld("50m")
      .then((w) => {
        if (!alive) return;
        setGeo({
          land: landPaths(w.land, MAP_W, MAP_H),
          borders: borderPaths(w.borders, MAP_W, MAP_H),
        });
        setStatus("ready");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  const draw = (now: number) => {
    raf.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const { geo: g, size: sz } = latest.current;
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, sz.width, sz.height);

    if (tween.current) {
      const { from, to, start, ms } = tween.current;
      const p = Math.min(1, (now - start) / ms);
      const e = ease(p);
      cam.current = {
        z: from.z + (to.z - from.z) * e,
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
      };
      if (p >= 1) tween.current = null;
    }
    const c = cam.current;
    const s = Math.min(sz.width / MAP_W, sz.height / MAP_H);
    const k = s * c.z;

    if (g) {
      ctx.save();
      ctx.translate(sz.width / 2 + c.x - (MAP_W / 2) * k, sz.height / 2 + c.y - (MAP_H / 2) * k);
      ctx.scale(k, k);
      // Ocean frame and graticule.
      ctx.fillStyle = C.surface;
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      for (let lng = -180; lng <= 180; lng += 30) {
        const x = ((lng + 180) / 360) * MAP_W;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, MAP_H);
      }
      for (let lat = -90; lat <= 90; lat += 30) {
        const y = ((90 - lat) / 180) * MAP_H;
        ctx.moveTo(0, y);
        ctx.lineTo(MAP_W, y);
      }
      ctx.stroke();
      // Land.
      ctx.beginPath();
      for (const ring of g.land) {
        ctx.moveTo(ring[0]!.x, ring[0]!.y);
        for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i]!.x, ring[i]!.y);
      }
      ctx.fillStyle = C.border;
      ctx.fill();
      ctx.strokeStyle = C.fgMuted;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 0.9 / k;
      ctx.stroke();
      // Country borders.
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      for (const line of g.borders) {
        ctx.moveTo(line[0]!.x, line[0]!.y);
        for (let i = 1; i < line.length; i++) ctx.lineTo(line[i]!.x, line[i]!.y);
      }
      ctx.lineWidth = 0.6 / k;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Connections, then markers (grouped when they would overlap), then the selected label.
    const { model: m, selectedPlaceId: sel } = latest.current;
    const at = (lat: number, lng: number) =>
      toScreenWith(project(lng, lat, MAP_W, MAP_H), c, s, sz.width, sz.height);
    ctx.strokeStyle = C.fgMuted;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const { a, b } of m.connections) {
      const pa = m.places.get(a);
      const pb = m.places.get(b);
      if (!pa || !pb || pa.lat === null || pa.lng === null || pb.lat === null || pb.lng === null)
        continue;
      const A = at(pa.lat, pa.lng);
      const B = at(pb.lat, pb.lng);
      const mx = (A.x + B.x) / 2;
      const my = (A.y + B.y) / 2 - Math.hypot(B.x - A.x, B.y - A.y) * 0.18;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.quadraticCurveTo(mx, my, B.x, B.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    const groups = groupMarkers(
      [...m.places.values()].filter((p) => p.lat !== null),
      (p) => at(p.lat as number, p.lng as number),
      22,
    );
    ctx.font = "12px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    for (const grp of groups) {
      const { x, y } = at(grp.lat, grp.lng);
      const single = grp.placeIds.length === 1 ? m.places.get(grp.placeIds[0]!) : undefined;
      const isSel = !!sel && grp.placeIds.includes(sel);
      const isHover = !!hover.current && grp.placeIds.includes(hover.current);
      const color = single
        ? typeColor(dominantType(m, single), OBJECT_TYPE_STYLE[dominantType(m, single)].color)
        : C.fg;
      const r = single ? 6 : 11;
      if (isSel) {
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.strokeStyle = C.bg;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r + (isHover ? 1.5 : 0), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (!single) {
        ctx.fillStyle = C.bg;
        ctx.fillText(String(grp.placeIds.length), x, y + 0.5);
      } else if (isSel || isHover) {
        const w = ctx.measureText(single.title).width + 14;
        ctx.fillStyle = C.surface;
        ctx.strokeStyle = C.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - r - 28, w, 22, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = C.fg;
        ctx.fillText(single.title, x, y - r - 17);
      }
    }
    if (tween.current) raf.current = requestAnimationFrame(draw);
  };

  const schedule = () => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  };

  // Redraw whenever anything it shows changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(size.width * dpr);
      canvas.height = Math.round(size.height * dpr);
    }
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draw reads everything from refs
  }, [size, geo, model, selectedPlaceId]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  const fly = (to: Cam, ms = 700) => {
    tween.current = { from: { ...cam.current }, to, start: performance.now(), ms };
    schedule();
  };

  /** A camera that centres a lng/lat on the canvas at zoom `z`. */
  const centreOn = (lng: number, lat: number, z: number): Cam => {
    const p = project(lng, lat, MAP_W, MAP_H);
    const k = Math.min(size.width / MAP_W, size.height / MAP_H) * z;
    return { z, x: -(p.x - MAP_W / 2) * k, y: -(p.y - MAP_H / 2) * k };
  };

  const clampZ = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const api = useMemo<MapHandle>(
    () => ({
      flyToPlace: (id) => {
        const target = targetForPlace(latest.current.model, id);
        if (!target) return;
        const sz = latest.current.size;
        const s = Math.min(sz.width / MAP_W, sz.height / MAP_H);
        const centreCam = (lng: number, lat: number, z: number): Cam => {
          const p = project(lng, lat, MAP_W, MAP_H);
          return { z, x: -(p.x - MAP_W / 2) * s * z, y: -(p.y - MAP_H / 2) * s * z };
        };
        if (target.kind === "center") {
          // The flat map has no street level: cap at a zoom where a city is still readable.
          fly(centreCam(target.lng, target.lat, clampZ(Math.min(target.zoom * 1.6, 30))));
        } else {
          const { box } = target;
          const w = Math.max(2, box.east - box.west);
          const h = Math.max(2, box.north - box.south);
          const z = clampZ(Math.min((0.7 * 360) / w, (0.7 * 180) / h));
          fly(centreCam((box.west + box.east) / 2, (box.north + box.south) / 2, z));
        }
      },
      earth: () => fly({ z: 1, x: 0, y: 0 }, 600),
      fitAll: () => {
        const box = geoBox([...latest.current.model.places.values()]);
        if (!box) return;
        const w = Math.max(8, box.east - box.west);
        const h = Math.max(8, box.north - box.south);
        const z = clampZ(Math.min((0.7 * 360) / w, (0.7 * 180) / h));
        fly(centreOn((box.west + box.east) / 2, (box.north + box.south) / 2, z));
      },
      zoomBy: (factor) => {
        const c = cam.current;
        const z = clampZ(c.z * factor);
        const r = z / c.z;
        fly({ z, x: c.x * r, y: c.y * r }, 220);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads size/model via refs and closure
    [size],
  );
  useImperativeHandle(handleRef, () => api, [api]);

  // Fly to a place selected elsewhere (the panel, the palette, another lens's peek).
  const flownTo = useRef<string | null>(null);
  useEffect(() => {
    if (selectedPlaceId && selectedPlaceId !== flownTo.current) {
      flownTo.current = selectedPlaceId;
      api.flyToPlace(selectedPlaceId);
    }
    if (!selectedPlaceId) flownTo.current = null;
  }, [selectedPlaceId, api]);

  // ── Pointer: drag to pan, wheel to zoom toward the cursor, click to select or place. ──
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(
    null,
  );
  const pointAt = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hitMarker = (px: number, py: number): string | null => {
    const { model: m, size: sz } = latest.current;
    const c = cam.current;
    const s = Math.min(sz.width / MAP_W, sz.height / MAP_H);
    const groups = groupMarkers(
      [...m.places.values()].filter((p) => p.lat !== null),
      (p) =>
        toScreenWith(
          project(p.lng as number, p.lat as number, MAP_W, MAP_H),
          c,
          s,
          sz.width,
          sz.height,
        ),
      22,
    );
    for (const g of groups) {
      const a = toScreenWith(project(g.lng, g.lat, MAP_W, MAP_H), c, s, sz.width, sz.height);
      if (Math.hypot(a.x - px, a.y - py) <= (g.placeIds.length === 1 ? 12 : 16)) {
        return g.placeIds.length === 1 ? g.placeIds[0]! : `group:${g.placeIds.join(",")}`;
      }
    }
    return null;
  };

  const onWheel = (e: React.WheelEvent) => {
    tween.current = null;
    const { x, y } = pointAt(e);
    const c = cam.current;
    const z = clampZ(c.z * (e.deltaY < 0 ? 1.18 : 1 / 1.18));
    const r = z / c.z;
    const ox = x - size.width / 2;
    const oy = y - size.height / 2;
    cam.current = { z, x: ox - (ox - c.x) * r, y: oy - (oy - c.y) * r };
    schedule();
  };

  return (
    <div
      ref={measure}
      role="group"
      aria-label={t("map.aria", { places: placed.length })}
      data-status={status}
      data-testid="flat-map-canvas"
      className={cn("relative h-full w-full overflow-hidden bg-bg", className)}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 touch-none"
        style={{
          width: size.width,
          height: size.height,
          cursor: pick ? "crosshair" : "grab",
        }}
        onWheel={onWheel}
        onPointerDown={(e) => {
          tween.current = null;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            cx: cam.current.x,
            cy: cam.current.y,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) {
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            if (d.moved) {
              cam.current = { ...cam.current, x: d.cx + dx, y: d.cy + dy };
              schedule();
            }
            return;
          }
          const { x, y } = pointAt(e);
          const hit = hitMarker(x, y);
          const id = hit && !hit.startsWith("group:") ? hit : null;
          if (id !== hover.current) {
            hover.current = id;
            schedule();
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved) return;
          const { x, y } = pointAt(e);
          const hit = hitMarker(x, y);
          if (hit) {
            if (hit.startsWith("group:")) {
              const ids = hit.slice(6).split(",");
              const box = geoBox(ids.flatMap((i) => latest.current.model.places.get(i) ?? []));
              if (box) {
                const w = Math.max(2, box.east - box.west);
                const h = Math.max(2, box.north - box.south);
                fly(
                  centreOn(
                    (box.west + box.east) / 2,
                    (box.north + box.south) / 2,
                    clampZ(Math.min((0.6 * 360) / w, (0.6 * 180) / h, cam.current.z * 4)),
                  ),
                );
              }
            } else latest.current.onSelectPlace(hit);
            return;
          }
          if (latest.current.pick) {
            const c = cam.current;
            const sz = latest.current.size;
            const k = Math.min(sz.width / MAP_W, sz.height / MAP_H) * c.z;
            const mx = (x - sz.width / 2 - c.x) / k + MAP_W / 2;
            const my = (y - sz.height / 2 - c.y) / k + MAP_H / 2;
            const lng = (mx / MAP_W) * 360 - 180;
            const lat = 90 - (my / MAP_H) * 180;
            if (lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90)
              latest.current.onPick?.({ lat, lng });
          } else latest.current.onSelectPlace(null);
        }}
        onPointerLeave={() => {
          if (hover.current) {
            hover.current = null;
            schedule();
          }
        }}
      />
      {status === "loading" && (
        <p
          role="status"
          className="label absolute top-4 left-1/2 -translate-x-1/2 rounded-control bg-bg px-3 py-2"
        >
          {t("map.loading")}
        </p>
      )}
    </div>
  );
}

function toScreenWith(p: Point, c: Cam, s: number, w: number, h: number) {
  return {
    x: w / 2 + c.x + (p.x - MAP_W / 2) * s * c.z,
    y: h / 2 + c.y + (p.y - MAP_H / 2) * s * c.z,
  };
}
