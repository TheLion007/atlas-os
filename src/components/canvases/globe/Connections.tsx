"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { Mesh } from "three";
import { CatmullRomCurve3 } from "three";
import { SPACE_COLORS as C } from "@/design/tokens";
import type { MapModel } from "../map-model";
import { GLOBE_RADIUS } from "./Globe";
import { greatCircleArc } from "./geo3d";

const PERIOD_SECONDS = 3.4;
/** Golden-ratio spacing: deterministic, but each successive arc's phase lands somewhere new,
 *  so a page with several connections never pulses in lockstep. */
const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;

function Arc({ curve, phase }: { curve: CatmullRomCurve3; phase: number }) {
  const dot = useRef<Mesh>(null);
  const points = useMemo(() => curve.getPoints(64), [curve]);

  useFrame(({ clock }) => {
    if (!dot.current) return;
    const t = (((clock.elapsedTime / PERIOD_SECONDS + phase) % 1) + 1) % 1;
    curve.getPointAt(t, dot.current.position);
    const fade = Math.sin(Math.PI * t);
    const material = dot.current.material as { opacity: number };
    material.opacity = 0.15 + fade * 0.75;
  });

  return (
    <>
      <Line points={points} color={C.fgMuted} transparent opacity={0.3} lineWidth={1} />
      <mesh ref={dot}>
        <sphereGeometry args={[GLOBE_RADIUS * 0.01, 8, 8]} />
        <meshBasicMaterial color={C.accent} transparent />
      </mesh>
    </>
  );
}

/**
 * Elegant, restrained arcs between two locations that relate to each other through the shared
 * graph (see `map-model.ts`'s `connections`) — a project's dependency reaching from one place to
 * another, for instance. One soft line each, with a single point of light travelling it to
 * suggest direction and motion; nothing here is decorative for its own sake.
 */
export function Connections({ model }: { model: MapModel }) {
  const curves = useMemo(() => {
    const out: CatmullRomCurve3[] = [];
    for (const c of model.connections) {
      const a = model.places.get(c.a);
      const b = model.places.get(c.b);
      if (!a || !b || a.lat === null || a.lng === null || b.lat === null || b.lng === null)
        continue;
      const points = greatCircleArc(a.lat, a.lng, b.lat, b.lng, GLOBE_RADIUS);
      out.push(new CatmullRomCurve3(points));
    }
    return out;
  }, [model]);

  return (
    <>
      {curves.map((curve, i) => (
        <Arc key={i} curve={curve} phase={(i * GOLDEN_RATIO_CONJUGATE) % 1} />
      ))}
    </>
  );
}
