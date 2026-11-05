"use client";

import { Stars } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import type { Mesh } from "three";
import { SPACE_COLORS as C, GLOBE_COLORS as G } from "@/design/tokens";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { CameraRig, MAX_DISTANCE, MIN_DISTANCE } from "./globe/CameraRig";
import { GlobeCameraController, type CameraTarget } from "./globe/camera-controller";
import { Connections } from "./globe/Connections";
import { Globe, GLOBE_RADIUS } from "./globe/Globe";
import { boxCenter, distanceToFitBox, vector3ToLatLng, zoomToDistance } from "./globe/geo3d";
import { Markers } from "./globe/Markers";
import { geoBox, targetForPlace, type MapModel } from "./map-model";

/** What the surrounding controls can ask of the globe. */
export interface MapHandle {
  /** Fly to a place: to the place itself at the zoom of its level, or around what is inside it. */
  flyToPlace: (id: string) => void;
  /** Pull back to Earth, seen from space. */
  earth: () => void;
  fitAll: () => void;
  zoomBy: (factor: number) => void;
}

export type MapStatus = "loading" | "ready" | "error";

interface MapCanvasProps {
  model: MapModel;
  selectedPlaceId: string | null;
  onSelectPlace: (id: string | null) => void;
  /** While active, a click on the globe places something: it reports the coordinates. */
  pick?: boolean;
  onPick?: (coords: { lat: number; lng: number }) => void;
  onStatus?: (status: MapStatus) => void;
  handleRef?: Ref<MapHandle>;
  className?: string;
  /** Stops the globe's idle rotation until the caller flips it back. */
  paused?: boolean;
}

const FOV_DEG = 42;
/** A pleasant default tilt so "back to world" never stares straight down a pole. */
const DEFAULT_LAT = 18;

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

const zoomToOrbit = (zoom: number) => zoomToDistance(zoom, MIN_DISTANCE, MAX_DISTANCE);

/**
 * A real 3D Earth: a textured sphere with a thin atmosphere, lit so a day and night side both
 * read, that the user can orbit and zoom, built from the same generic Location hierarchy as the
 * rest of Atlas (see `map-model.ts`) — Borland and the Uplands, or any place added later, all work
 * the same way, and nothing here is specific to one city.
 *
 * The camera is a small state machine (`GlobeCameraController`): dragging and the wheel hand it
 * to `OrbitControls`; selecting a place, "fit all" or "back to world" hand it a cinematic tween
 * instead, and either way it settles back to the same interactive orbit.
 */
export function MapCanvas({
  model,
  selectedPlaceId,
  onSelectPlace,
  pick = false,
  onPick,
  onStatus,
  handleRef,
  className,
  paused = false,
}: MapCanvasProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<MapStatus>(() => (hasWebGL() ? "loading" : "error"));
  const globeRef = useRef<Mesh>(null) as RefObject<Mesh | null>;
  // A plain instance, not a ref: it is read during render (passed to `CameraRig`), and a ref's
  // `.current` may only be read in an effect or an event handler.
  const [controller] = useState(() => new GlobeCameraController());
  const latest = useRef({ model, pick, onPick, onSelectPlace });
  useEffect(() => {
    latest.current = { model, pick, onPick, onSelectPlace };
  });

  const placedCount = useMemo(
    () => [...model.places.values()].filter((p) => p.lat !== null).length,
    [model],
  );

  // `CameraRig` only ever reads this once, to seed the very first frame; later camera moves go
  // through `flyToPlace`/`earth`/`fitAll`, never by re-reading this on a later render.
  const initialTarget = useMemo<CameraTarget>(() => {
    const placed = [...model.places.values()].filter((p) => p.lat !== null);
    const box = geoBox(placed);
    const lng = box ? (box.west + box.east) / 2 : 10;
    return { lat: DEFAULT_LAT, lng, distance: MAX_DISTANCE };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally computed once
  }, []);

  const api = useMemo<MapHandle>(
    () => ({
      flyToPlace: (id) => {
        const target = targetForPlace(latest.current.model, id);
        if (!target) return;
        if (target.kind === "center") {
          controller.flyTo(
            { lat: target.lat, lng: target.lng, distance: zoomToOrbit(target.zoom) },
            2000,
          );
        } else {
          const centre = boxCenter(target.box);
          const distance = Math.max(
            distanceToFitBox(target.box, GLOBE_RADIUS, FOV_DEG),
            zoomToOrbit(target.maxZoom),
          );
          controller.flyTo({ lat: centre.lat, lng: centre.lng, distance }, 2000);
        }
      },
      earth: () => {
        const { lng } = controller.current();
        controller.flyTo({ lat: DEFAULT_LAT, lng, distance: MAX_DISTANCE }, 1800);
      },
      fitAll: () => {
        const placed = [...latest.current.model.places.values()].filter((p) => p.lat !== null);
        const box = geoBox(placed);
        if (!box) return;
        const centre = boxCenter(box);
        controller.flyTo(
          {
            lat: centre.lat,
            lng: centre.lng,
            distance: distanceToFitBox(box, GLOBE_RADIUS, FOV_DEG),
          },
          1800,
        );
      },
      zoomBy: (factor) => {
        const cur = controller.current();
        const distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, cur.distance / factor));
        controller.flyTo({ lat: cur.lat, lng: cur.lng, distance }, 260);
      },
    }),
    [controller],
  );
  useImperativeHandle(handleRef, () => api, [api]);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  // Flies to a place selected elsewhere (the panel, the palette, another lens's peek).
  const flownTo = useRef<string | null>(null);
  useEffect(() => {
    if (selectedPlaceId && selectedPlaceId !== flownTo.current) {
      flownTo.current = selectedPlaceId;
      api.flyToPlace(selectedPlaceId);
    }
    if (!selectedPlaceId) flownTo.current = null;
  }, [selectedPlaceId, api]);

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden bg-bg", className)}
      role="group"
      aria-label={t("map.aria", { places: placedCount })}
      data-status={status}
      data-testid="map-canvas"
      style={{ cursor: pick ? "crosshair" : undefined }}
    >
      {status !== "error" && (
        <Canvas
          gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
          camera={{ fov: FOV_DEG, near: 0.1, far: MAX_DISTANCE * 4 }}
          onCreated={() => setStatus("ready")}
          onPointerMissed={() => latest.current.onSelectPlace(null)}
        >
          <color attach="background" args={[C.bg]} />
          <ambientLight intensity={0.55} />
          <directionalLight position={[8, 5, 6]} intensity={1.5} color={G.sun} />
          <Stars
            radius={GLOBE_RADIUS * 18}
            depth={GLOBE_RADIUS * 6}
            count={2200}
            factor={2.4}
            fade
            speed={0}
          />
          <Globe meshRef={globeRef} />
          {/* An invisible shell, very slightly larger than the globe, that only exists to catch
              clicks: a click that reaches it either places a pin (in pick mode) or deselects
              (otherwise). `opacity={0}` keeps it a genuine raycast target — unlike `visible`,
              which some raycasters skip — without drawing anything or writing depth. */}
          <mesh
            onClick={(e) => {
              e.stopPropagation();
              if (latest.current.pick) {
                const { lat, lng } = vector3ToLatLng(e.point, GLOBE_RADIUS);
                latest.current.onPick?.({ lat, lng });
              } else {
                latest.current.onSelectPlace(null);
              }
            }}
          >
            <sphereGeometry args={[GLOBE_RADIUS * 1.001, 48, 48]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          <Markers
            model={model}
            selectedPlaceId={selectedPlaceId}
            onSelect={onSelectPlace}
            onSelectGroup={(placeIds) => {
              const box = geoBox(
                placeIds.flatMap((id) => {
                  const p = model.places.get(id);
                  return p ? [p] : [];
                }),
              );
              if (!box) return;
              const centre = boxCenter(box);
              const closer = Math.max(
                distanceToFitBox(box, GLOBE_RADIUS, FOV_DEG, 2.2),
                MIN_DISTANCE,
              );
              const distance = Math.min(closer, controller.current().distance);
              controller.flyTo({ lat: centre.lat, lng: centre.lng, distance }, 1100);
            }}
            globeRef={globeRef}
            t={t}
          />
          <Connections model={model} />
          <CameraRig
            controller={controller}
            initialTarget={initialTarget}
            spinAtStart={!selectedPlaceId}
            paused={paused}
          />
        </Canvas>
      )}
      {status === "loading" && (
        <p
          role="status"
          className="label absolute top-4 left-1/2 -translate-x-1/2 rounded-control bg-bg px-3 py-2"
        >
          {t("map.loading")}
        </p>
      )}
      {status === "error" && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center"
        >
          <p className="text-base font-medium">{t("map.webglError")}</p>
          <p className="max-w-prose text-fg-muted">{t("map.webglErrorBody")}</p>
        </div>
      )}
    </div>
  );
}
