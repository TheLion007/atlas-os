"use client";

import { useMemo } from "react";
import { CatmullRomCurve3, Vector3 } from "three";
import type { AccessoryId, Outfit } from "./accessories";

/** Colours of the wardrobe (kept here, with the other design colours). */
const C = {
  beanie: "#4F6FE0",
  beanieCuff: "#3C58C0",
  white: "#F7F5F0",
  party: "#E86AA8",
  partyDot: "#FFE27A",
  bow: "#F07AA8",
  gold: "#F2C14E",
  gem: "#E5484D",
  witch: "#6B3FA0",
  witchBand: "#F08A24",
  buckle: "#F2C14E",
  santa: "#D8343A",
  frame: "#6A4B2B",
  lens: "#1D221F",
  ghost: "#F3F1FF",
} as const;

const mat = (color: string, extra?: { metal?: number; rough?: number }) => (
  <meshPhysicalMaterial
    color={color}
    roughness={extra?.rough ?? 0.55}
    metalness={extra?.metal ?? 0}
    clearcoat={0.2}
  />
);

function Beanie() {
  return (
    <group position={[0, 0.5, 0]}>
      <mesh scale={[1, 0.62, 0.95]}>
        <sphereGeometry args={[1.02, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
        {mat(C.beanie)}
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.95, 1]}>
        <torusGeometry args={[0.99, 0.1, 14, 40]} />
        {mat(C.beanieCuff)}
      </mesh>
      <mesh position={[0, 0.7, 0]}>
        <sphereGeometry args={[0.15, 20, 14]} />
        {mat(C.white)}
      </mesh>
    </group>
  );
}

function Party() {
  return (
    <group position={[0.05, 1.3, 0]} rotation={[0, 0, -0.16]}>
      <mesh>
        <coneGeometry args={[0.44, 0.9, 32]} />
        {mat(C.party)}
      </mesh>
      {[0.12, -0.12, 0.26].map((y, i) => (
        <mesh key={y} position={[(i - 1) * 0.12, y - 0.1, 0.3 - Math.abs(y) * 0.5]}>
          <sphereGeometry args={[0.045, 10, 8]} />
          {mat(C.partyDot)}
        </mesh>
      ))}
      <mesh position={[0, 0.47, 0]}>
        <sphereGeometry args={[0.1, 14, 10]} />
        {mat(C.white)}
      </mesh>
    </group>
  );
}

function Bow() {
  return (
    <group position={[0.55, 0.88, 0.45]} rotation={[0.35, 0, -0.5]}>
      {[1, -1].map((s) => (
        <mesh
          key={s}
          position={[s * 0.2, 0, 0]}
          rotation={[0, 0, (s * Math.PI) / 2]}
          scale={[1, 1, 0.55]}
        >
          <coneGeometry args={[0.2, 0.34, 20]} />
          {mat(C.bow)}
        </mesh>
      ))}
      <mesh>
        <sphereGeometry args={[0.1, 16, 12]} />
        {mat(C.bow)}
      </mesh>
    </group>
  );
}

function Crown() {
  return (
    <group position={[0, 0.98, 0]}>
      <mesh>
        <cylinderGeometry args={[0.52, 0.46, 0.24, 28, 1, true]} />
        <meshPhysicalMaterial color={C.gold} metalness={0.7} roughness={0.3} side={2} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.sin(a) * 0.5, 0.26, Math.cos(a) * 0.5]}>
            <coneGeometry args={[0.1, 0.26, 12]} />
            <meshPhysicalMaterial color={C.gold} metalness={0.7} roughness={0.3} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.02, 0.5]}>
        <sphereGeometry args={[0.06, 12, 8]} />
        {mat(C.gem)}
      </mesh>
    </group>
  );
}

function Witch() {
  return (
    <group position={[0, 0.92, 0]} rotation={[0, 0, -0.1]}>
      <mesh scale={[1, 1, 1]}>
        <cylinderGeometry args={[0.92, 0.92, 0.06, 40]} />
        {mat(C.witch)}
      </mesh>
      <mesh position={[0.05, 0.5, 0]} rotation={[0, 0, -0.12]}>
        <coneGeometry args={[0.52, 1.0, 32]} />
        {mat(C.witch)}
      </mesh>
      <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.52, 0.07, 12, 36]} />
        {mat(C.witchBand)}
      </mesh>
      <mesh position={[0, 0.1, 0.55]}>
        <boxGeometry args={[0.14, 0.12, 0.05]} />
        <meshPhysicalMaterial color={C.buckle} metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Santa() {
  return (
    <group position={[0, 0.9, 0]}>
      <mesh position={[0.1, 0.42, 0]} rotation={[0, 0, -0.35]}>
        <coneGeometry args={[0.55, 0.9, 32]} />
        {mat(C.santa)}
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.56, 0.12, 14, 36]} />
        {mat(C.white, { rough: 0.9 })}
      </mesh>
      <mesh position={[0.45, 0.8, 0]}>
        <sphereGeometry args={[0.14, 16, 12]} />
        {mat(C.white, { rough: 0.9 })}
      </mesh>
    </group>
  );
}

function Glasses() {
  const bridge = useMemo(
    () =>
      new CatmullRomCurve3([
        new Vector3(-0.14, 0.12, 0.96),
        new Vector3(0, 0.17, 0.98),
        new Vector3(0.14, 0.12, 0.96),
      ]),
    [],
  );
  return (
    <group>
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, 0.12, 0.96]}>
          <torusGeometry args={[0.24, 0.028, 12, 32]} />
          {mat(C.frame)}
        </mesh>
      ))}
      <mesh>
        <tubeGeometry args={[bridge, 16, 0.022, 8, false]} />
        {mat(C.frame)}
      </mesh>
    </group>
  );
}

function Sunglasses() {
  return (
    <group>
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, 0.12, 0.97]} scale={[1, 0.82, 0.3]}>
          <sphereGeometry args={[0.27, 24, 16]} />
          <meshPhysicalMaterial color={C.lens} roughness={0.15} clearcoat={1} />
        </mesh>
      ))}
      <mesh position={[0, 0.17, 0.98]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.025, 0.22, 4, 8]} />
        {mat(C.lens)}
      </mesh>
    </group>
  );
}

function Ghost() {
  return (
    <mesh position={[0, -0.05, -0.02]} scale={[1.12, 1.15, 1.05]}>
      <sphereGeometry args={[1.16, 40, 24, Math.PI * 0.8, Math.PI * 1.4, 0.5, 2.3]} />
      <meshStandardMaterial color={C.ghost} roughness={0.8} side={2} transparent opacity={0.9} />
    </mesh>
  );
}

const PIECES: Record<AccessoryId, () => React.JSX.Element> = {
  beanie: Beanie,
  party: Party,
  bow: Bow,
  crown: Crown,
  witch: Witch,
  santa: Santa,
  glasses: Glasses,
  sunglasses: Sunglasses,
  ghost: Ghost,
};

/** What Pip is wearing, drawn on his head, face and back. */
export function Outfit3D({ outfit }: { outfit: Outfit }) {
  const Hat = outfit.hat ? PIECES[outfit.hat] : null;
  const Face = outfit.face ? PIECES[outfit.face] : null;
  const Back = outfit.back ? PIECES[outfit.back] : null;
  return (
    <>
      {Back && <Back />}
      {Face && <Face />}
      {Hat && <Hat />}
    </>
  );
}
