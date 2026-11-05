"use client";

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { GLOBE_RADIUS } from "./Globe";
import type { CameraTarget, GlobeCameraController } from "./camera-controller";

/**
 * The single knob for idle-spin speed: how long one full untouched revolution takes. A physical
 * planet drifting in space, not a loading spinner — tune this one value, nothing else needs to
 * change. ~6 minutes per revolution is "almost stationary" at a glance, with real motion visible
 * only over time.
 */
export const IDLE_ROTATION_SECONDS_PER_REVOLUTION = 360;

/** drei's `autoRotateSpeed` is calibrated so `speed = 2` completes one revolution in 30s at 60fps
 * (i.e. seconds-per-revolution = 60 / speed) — inverted here to hit our target period exactly. */
const IDLE_ROTATION_SPEED = 60 / IDLE_ROTATION_SECONDS_PER_REVOLUTION;

export const MIN_DISTANCE = GLOBE_RADIUS * 1.25;
export const MAX_DISTANCE = GLOBE_RADIUS * 8;

/**
 * Wires the camera controller (the cinematic flies) to a real `OrbitControls` (drag to orbit,
 * wheel to zoom), places the camera at `initialTarget` on the very first frame, and spins gently
 * on its own until anyone touches it — "alive, but controlled", the same spirit as the Graph.
 */
export function CameraRig({
  controller,
  initialTarget,
  spinAtStart,
  paused = false,
}: {
  controller: GlobeCameraController;
  initialTarget: CameraTarget;
  spinAtStart: boolean;
  /** The user's own pause button — stops the idle drift until they resume it, independent of
   *  the drag/release drift-resume dance below. */
  paused?: boolean;
}) {
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const spinning = useRef(spinAtStart);
  const seeded = useRef(false);

  useEffect(() => {
    if (!controls.current) return;
    controller.attach(camera, controls.current);
    if (!seeded.current) {
      seeded.current = true;
      controller.applyImmediate(initialTarget);
    }
    // `initialTarget` is deliberately not a dependency: it is only ever used once, to seed the
    // very first frame — later camera moves go through `flyToPlace`/`earth`/`fitAll`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controller]);

  useFrame(() => {
    const flying = controller.update(performance.now());
    if (controls.current) controls.current.autoRotate = !flying && spinning.current && !paused;
  });

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.55}
      zoomSpeed={0.7}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      autoRotateSpeed={IDLE_ROTATION_SPEED}
      onStart={() => {
        // Any touch — drag or wheel — stops the idle drift immediately, full manual control.
        spinning.current = false;
        controller.cancel();
      }}
      onEnd={() => {
        // Released (pointer up, or a wheel tick's implicit end): drift resumes, so slowly the
        // hand-off is never a jolt.
        spinning.current = true;
      }}
    />
  );
}
