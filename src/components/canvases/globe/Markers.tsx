"use client";

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState, type RefObject } from "react";
import type { Mesh, Object3D, Vector3 } from "three";
import { OBJECT_TYPE_STYLE } from "@/design/object-types";
import type { TFunction } from "@/i18n";
import {
  dominantType,
  groupMarkers,
  type MapModel,
  type MarkerGroup,
  type Place,
} from "../map-model";
import { GLOBE_RADIUS } from "./Globe";
import { latLngToVector3 } from "./geo3d";

const GROUP_PX = 34;
const RECLUSTER_EVERY = 6; // frames — grouping only needs to track the camera, not every tick

interface MarkersProps {
  model: MapModel;
  selectedPlaceId: string | null;
  onSelect: (id: string | null) => void;
  onSelectGroup: (placeIds: readonly string[]) => void;
  globeRef: RefObject<Mesh | null>;
  t: TFunction;
}

function Pin({
  group,
  model,
  selected,
  holdsSelected,
  onSelect,
  onSelectGroup,
  globeRef,
  t,
}: {
  group: MarkerGroup;
  model: MapModel;
  selected: boolean;
  /** A group that contains the selected place, even though it isn't shown on its own. */
  holdsSelected: boolean;
  onSelect: (id: string | null) => void;
  onSelectGroup: (placeIds: readonly string[]) => void;
  globeRef: RefObject<Mesh | null>;
  t: TFunction;
}) {
  const members = group.placeIds.map((id) => model.places.get(id) as Place);
  const isGroup = members.length > 1;
  const first = members[0] as Place;
  const objectCount = members.reduce((n, p) => n + p.objectIds.length, 0);
  const type = isGroup ? "location" : dominantType(model, first);
  const label = isGroup
    ? t("map.group", { count: members.length })
    : objectCount > 0
      ? t("map.marker", { title: first.title, count: objectCount })
      : t("map.markerEmpty", { title: first.title });

  return (
    // Positioned by the parent `<group position={world}>`: Html only needs to sit at its origin.
    <Html
      center
      occlude={[globeRef as RefObject<Object3D>]}
      zIndexRange={[10, 0]}
      className="pointer-events-none"
    >
      <button
        type="button"
        className="atlas-pin pointer-events-auto"
        style={{ "--pin-color": OBJECT_TYPE_STYLE[type].color } as React.CSSProperties}
        data-selected={selected || holdsSelected ? "true" : "false"}
        data-group={isGroup ? "true" : "false"}
        aria-label={label}
        aria-pressed={!isGroup && selected}
        onClick={(e) => {
          e.stopPropagation();
          if (isGroup) onSelectGroup(group.placeIds);
          else onSelect(selected ? null : first.id);
        }}
      >
        <span className="atlas-pin__dot" />
        {(isGroup || objectCount > 1) && (
          <span className="atlas-pin__count">{isGroup ? members.length : objectCount}</span>
        )}
        {!isGroup && selected && <span className="atlas-pin__label">{first.title}</span>}
      </button>
    </Html>
  );
}

/**
 * Every placed Location as a marker attached to the sphere's surface. Nearby markers (Dorsel's
 * districts, seen from orbit) cluster into one, the same way the flat map used to — clustering
 * is recomputed a few times a second from each place's actual screen position, not a fixed pixel
 * grid, so it holds up at any zoom and for any location anywhere on Earth.
 */
export function Markers({
  model,
  selectedPlaceId,
  onSelect,
  onSelectGroup,
  globeRef,
  t,
}: MarkersProps) {
  const { camera, size } = useThree();
  const [groups, setGroups] = useState<MarkerGroup[]>([]);
  const frame = useRef(0);

  const placed = useMemo(
    () => [...model.places.values()].filter((p) => p.lat !== null && p.lng !== null),
    [model],
  );
  const positions = useMemo(() => {
    const map = new Map<string, Vector3>();
    for (const p of placed)
      map.set(p.id, latLngToVector3(p.lat as number, p.lng as number, GLOBE_RADIUS));
    return map;
  }, [placed]);

  useFrame(() => {
    frame.current = (frame.current + 1) % RECLUSTER_EVERY;
    if (frame.current !== 0) return;
    const next = groupMarkers(
      placed,
      (place) => {
        const world = positions.get(place.id);
        if (!world) return null;
        // Behind the horizon (the far side of the sphere, from here)? Skip it: no marker for a
        // place the camera cannot currently see, matching how the sphere itself occludes it.
        const towardCamera = camera.position.clone().normalize();
        const towardPlace = world.clone().normalize();
        if (towardPlace.dot(towardCamera) < 0.05) return null;
        const ndc = world.clone().project(camera);
        return { x: ((ndc.x + 1) / 2) * size.width, y: ((1 - ndc.y) / 2) * size.height };
      },
      GROUP_PX,
    );
    setGroups(next);
  });

  return (
    <>
      {groups.map((g) => {
        // `groups` is only recomputed every RECLUSTER_EVERY frames, so a place deleted (or moved
        // off the globe) in between can still be named by a stale group until the next recluster
        // — drop it here rather than crashing on a `model.places` lookup that now misses.
        const placeIds = g.placeIds.filter((id) => model.places.has(id));
        if (placeIds.length === 0) return null;
        const world =
          placeIds.length === 1
            ? (positions.get(placeIds[0] as string) as Vector3 | undefined)
            : latLngToVector3(g.lat, g.lng, GLOBE_RADIUS);
        if (!world) return null;
        const selected = placeIds.length === 1 && placeIds[0] === selectedPlaceId;
        const holdsSelected =
          placeIds.length > 1 && !!selectedPlaceId && placeIds.includes(selectedPlaceId);
        return (
          <group key={g.key} position={world}>
            <Pin
              group={{ ...g, placeIds }}
              model={model}
              selected={selected}
              holdsSelected={holdsSelected}
              onSelect={onSelect}
              onSelectGroup={onSelectGroup}
              globeRef={globeRef}
              t={t}
            />
          </group>
        );
      })}
    </>
  );
}
