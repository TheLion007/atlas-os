"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { CHARACTER, useKind } from "./character";

const L = {
  shell: "#C9CED6",
  shellDark: "#9AA1AD",
  keys: "#2B3038",
  glow: "#7DB7FF",
} as const;

/** One hand resting on the keyboard that taps in time with the other. */
function TypingHand({ x, phase }: { x: number; phase: number }) {
  const hand = useRef<Group>(null);
  const c = CHARACTER[useKind()];
  useFrame((s) => {
    const h = hand.current;
    if (!h) return;
    const t = s.clock.elapsedTime * 15 + phase;
    h.position.y = -0.74 + Math.max(0, Math.sin(t)) * 0.07;
    h.position.z = 1.08 + Math.sin(t * 0.5) * 0.04;
  });
  return (
    <group ref={hand} position={[x, -0.74, 1.08]}>
      <mesh scale={[1, 0.9, 1]}>
        <sphereGeometry args={[0.15, 20, 16]} />
        <meshPhysicalMaterial color={c.body} roughness={0.5} clearcoat={0.25} />
      </mesh>
    </group>
  );
}

/**
 * A laptop in front of Pip, seen from behind the lid (the classic "peeking over the laptop" pose),
 * with both hands tapping the keys at its sides. Shown while Pip works, i.e. while the timer runs.
 */
export function Laptop3D() {
  const glow = useRef<Group>(null);
  useFrame((s) => {
    if (glow.current) glow.current.scale.setScalar(1 + Math.sin(s.clock.elapsedTime * 3) * 0.06);
  });
  return (
    <group>
      {/* Base with the keyboard, wider than the lid so the hands show on both sides. */}
      <mesh position={[0, -0.86, 1.2]}>
        <boxGeometry args={[2.5, 0.09, 1.0]} />
        <meshStandardMaterial color={L.shell} roughness={0.35} metalness={0.3} />
      </mesh>
      <mesh position={[0, -0.805, 1.12]}>
        <boxGeometry args={[2.25, 0.01, 0.72]} />
        <meshStandardMaterial color={L.keys} roughness={0.6} />
      </mesh>
      {/* Lid, tilted back a little, its back towards us. */}
      <group position={[0, -0.82, 1.68]} rotation={[-0.2, 0, 0]}>
        <mesh position={[0, 0.37, 0]}>
          <boxGeometry args={[1.3, 0.76, 0.06]} />
          <meshStandardMaterial color={L.shell} roughness={0.3} metalness={0.35} />
        </mesh>
        <mesh position={[0, 0.37, 0.035]}>
          <boxGeometry args={[1.18, 0.64, 0.01]} />
          <meshStandardMaterial color={L.shellDark} roughness={0.4} metalness={0.3} />
        </mesh>
        <group ref={glow} position={[0, 0.39, 0.045]}>
          <mesh>
            <circleGeometry args={[0.11, 28]} />
            <meshBasicMaterial color={L.glow} />
          </mesh>
        </group>
      </group>
      <TypingHand x={-1.0} phase={0} />
      <TypingHand x={1.0} phase={Math.PI} />
      <pointLight position={[0, -0.2, 1.4]} color={L.glow} intensity={1.6} distance={3} />
    </group>
  );
}
