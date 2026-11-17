"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  CatmullRomCurve3,
  MathUtils,
  NoToneMapping,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Mesh,
} from "three";
import { EXPRESSIONS, PIP, type PipExpression } from "./expressions";

interface Look {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

function Ink({ opacity = 1 }: { opacity?: number }) {
  return (
    <meshStandardMaterial
      color={PIP.ink}
      roughness={0.6}
      transparent={opacity < 1}
      opacity={opacity}
    />
  );
}

/** One round eye: a white ball, a pupil that follows the look target, and a catch-light. */
function OpenEye({ x, look }: { x: number; look: React.RefObject<Look> }) {
  const pupil = useRef<Group>(null);
  useFrame(() => {
    const p = pupil.current;
    if (!p) return;
    p.position.x = look.current.x * 0.085;
    p.position.y = look.current.y * 0.07;
  });
  return (
    <group position={[x, 0.12, 0.8]}>
      <mesh scale={[1, 1, 0.45]}>
        <sphereGeometry args={[0.24, 32, 24]} />
        <meshStandardMaterial color={PIP.white} roughness={0.3} />
      </mesh>
      <group ref={pupil} position={[0, 0, 0.07]}>
        <mesh scale={[1, 1, 0.5]}>
          <sphereGeometry args={[0.125, 24, 16]} />
          <Ink />
        </mesh>
        <mesh position={[0.045, 0.05, 0.06]}>
          <sphereGeometry args={[0.04, 12, 8]} />
          <meshBasicMaterial color={PIP.white} />
        </mesh>
      </group>
    </group>
  );
}

function Arc({
  x,
  y,
  flip,
  radius = 0.17,
}: {
  x: number;
  y: number;
  flip?: boolean;
  radius?: number;
}) {
  return (
    <mesh position={[x, y, 0.93]} rotation={[0, 0, flip ? Math.PI : 0]}>
      <torusGeometry args={[radius, 0.04, 12, 28, Math.PI]} />
      <Ink />
    </mesh>
  );
}

function Swirl({ x, dir }: { x: number; dir: 1 | -1 }) {
  const spin = useRef<Group>(null);
  const curve = useMemo(() => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 4.4;
      const r = 0.02 + (i / 40) * 0.17;
      pts.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    return new CatmullRomCurve3(pts);
  }, []);
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.z += dir * dt * 7;
  });
  return (
    <group position={[x, 0.12, 0.8]}>
      <mesh scale={[1, 1, 0.45]}>
        <sphereGeometry args={[0.24, 32, 24]} />
        <meshStandardMaterial color={PIP.white} roughness={0.3} />
      </mesh>
      <group ref={spin} position={[0, 0, 0.12]}>
        <mesh>
          <tubeGeometry args={[curve, 64, 0.022, 8, false]} />
          <Ink />
        </mesh>
      </group>
    </group>
  );
}

function Eyes({ style, look }: { style: string; look: React.RefObject<Look> }) {
  if (style === "happy")
    return (
      <>
        <Arc x={-0.38} y={0.1} />
        <Arc x={0.38} y={0.1} />
      </>
    );
  if (style === "sleep")
    return (
      <>
        <Arc x={-0.38} y={0.18} flip />
        <Arc x={0.38} y={0.18} flip />
      </>
    );
  if (style === "flat")
    return (
      <>
        {[-0.38, 0.38].map((x) => (
          <mesh key={x} position={[x, 0.1, 0.93]} rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.04, 0.26, 4, 10]} />
            <Ink />
          </mesh>
        ))}
      </>
    );
  if (style === "dizzy")
    return (
      <>
        <Swirl x={-0.38} dir={1} />
        <Swirl x={0.38} dir={-1} />
      </>
    );
  return (
    <>
      <OpenEye x={-0.38} look={look} />
      <OpenEye x={0.38} look={look} />
    </>
  );
}

function Mouth({ style }: { style: string }) {
  const wavy = useMemo(() => {
    const pts = [-0.16, -0.08, 0, 0.08, 0.16].map(
      (x, i) => new Vector3(x, i % 2 ? -0.02 : 0.02, 0),
    );
    return new CatmullRomCurve3(pts);
  }, []);
  if (style === "grin")
    return (
      <mesh position={[0, -0.16, 0.95]}>
        <circleGeometry args={[0.15, 28, Math.PI, Math.PI]} />
        <meshStandardMaterial color={PIP.mouthInside} roughness={0.7} side={2} />
      </mesh>
    );
  if (style === "flat")
    return (
      <mesh position={[0, -0.22, 0.95]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.025, 0.14, 4, 8]} />
        <Ink />
      </mesh>
    );
  if (style === "small")
    return (
      <mesh position={[0, -0.22, 0.95]}>
        <torusGeometry args={[0.045, 0.022, 10, 20]} />
        <Ink />
      </mesh>
    );
  if (style === "wavy")
    return (
      <mesh position={[0, -0.22, 0.95]}>
        <tubeGeometry args={[wavy, 32, 0.022, 8, false]} />
        <Ink />
      </mesh>
    );
  return (
    <mesh position={[0, -0.12, 0.95]} rotation={[0, 0, Math.PI]}>
      <torusGeometry args={[0.1, 0.024, 10, 24, Math.PI]} />
      <Ink />
    </mesh>
  );
}

function Hand({ side, pivot }: { side: 1 | -1; pivot: React.RefObject<Group | null> }) {
  return (
    <group ref={pivot} position={[side * 1.0, -0.12, 0.2]} scale={[side, 1, 1]}>
      <mesh position={[0.27, -0.19, 0.06]} scale={[1, 1.15, 0.9]}>
        <sphereGeometry args={[0.16, 20, 16]} />
        <meshPhysicalMaterial color={PIP.body} roughness={0.5} clearcoat={0.25} />
      </mesh>
    </group>
  );
}

/** Little bubbles over the head: violet while thinking, blue while working, red on error. */
function Bubbles({ color, speed }: { color: string; speed: number }) {
  const dots = useRef<Array<Mesh | null>>([]);
  useFrame((s) => {
    dots.current.forEach((m, i) => {
      if (!m) return;
      const k = 0.7 + 0.3 * Math.sin(s.clock.elapsedTime * speed - i * 0.9);
      m.scale.setScalar(k);
    });
  });
  return (
    <group position={[0.95, 1.05, 0.2]}>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            dots.current[i] = m;
          }}
          position={[i * 0.2, i * 0.1, 0]}
        >
          <sphereGeometry args={[0.06 + i * 0.03, 14, 10]} />
          <meshStandardMaterial color={color} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Zzz() {
  const g = useRef<Group>(null);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (!g.current) return;
    g.current.position.y = 1.0 + ((t * 0.25) % 1) * 0.35;
    g.current.scale.setScalar(0.8 + ((t * 0.25) % 1) * 0.5);
  });
  return (
    <group ref={g} position={[0.85, 1.0, 0.3]}>
      <mesh position={[0, 0.1, 0]}>
        <boxGeometry args={[0.22, 0.04, 0.04]} />
        <meshStandardMaterial color={PIP.sleep} />
      </mesh>
      <mesh rotation={[0, 0, 0.8]}>
        <boxGeometry args={[0.3, 0.04, 0.04]} />
        <meshStandardMaterial color={PIP.sleep} />
      </mesh>
      <mesh position={[0, -0.1, 0]}>
        <boxGeometry args={[0.22, 0.04, 0.04]} />
        <meshStandardMaterial color={PIP.sleep} />
      </mesh>
    </group>
  );
}

function Sweat() {
  return (
    <mesh position={[0.85, 0.55, 0.65]} scale={[0.8, 1.1, 0.8]}>
      <sphereGeometry args={[0.09, 14, 10]} />
      <meshStandardMaterial color={PIP.sweat} roughness={0.3} />
    </mesh>
  );
}

function PipModel({
  expression,
  track,
  calm,
}: {
  expression: PipExpression;
  track: boolean;
  calm: boolean;
}) {
  const spec = EXPRESSIONS[expression];
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const crest = useRef<Group>(null);
  const ground = useRef<Mesh>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const look = useRef<Look>({ x: 0, y: 0, tx: 0, ty: 0 });
  const entered = useRef(0);
  const clock = useRef(0);

  useEffect(() => {
    entered.current = clock.current;
    invalidate();
  }, [expression, invalidate]);

  useEffect(() => {
    if (!track) return;
    const el = gl.domElement;
    const move = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const m = Math.min(1, d / 220);
      look.current.tx = (dx / d) * m;
      look.current.ty = (-dy / d) * m;
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, [gl, track]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    clock.current = t;
    const l = look.current;
    const tx = spec.look ? spec.look.x : l.tx;
    const ty = spec.look ? spec.look.y : l.ty;
    l.x = MathUtils.damp(l.x, tx, 9, dt);
    l.y = MathUtils.damp(l.y, ty, 9, dt);

    const since = t - entered.current;
    const hop = spec.hop ? Math.max(0, Math.sin(since * 9)) * 0.34 * Math.exp(-since * 1.5) : 0;
    const bounce = spec.bounce ? Math.abs(Math.sin(t * spec.bobSpeed)) * spec.bobAmp * 2.6 : 0;
    const bob = spec.bounce ? 0 : Math.sin(t * spec.bobSpeed) * spec.bobAmp;
    const shake =
      expression === "error" && since < 1.4 ? Math.sin(since * 40) * 0.05 * (1 - since / 1.4) : 0;

    if (root.current) {
      root.current.position.set(shake, bob + hop + bounce, 0);
      root.current.rotation.x = -l.y * 0.12 + spec.tilt * 0.4;
      root.current.rotation.y =
        l.x * 0.32 + (expression === "dancing" ? Math.sin(t * 3.5) * 0.5 : 0);
      root.current.rotation.z = Math.sin(t * spec.swaySpeed) * spec.sway + spec.tilt;
    }
    if (body.current) {
      const breathe = 1 + Math.sin(t * (expression === "sleeping" ? 1.2 : 2)) * 0.017;
      const squash = hop > 0.01 ? 1 - hop * 0.12 : 1;
      body.current.scale.set(
        1 / Math.sqrt(breathe * squash),
        breathe * squash,
        1 / Math.sqrt(breathe * squash),
      );
    }
    if (crest.current)
      crest.current.rotation.z = Math.sin(t * 2.2 - 0.6) * 0.1 - root.current!.rotation.z * 0.3;
    if (ground.current) {
      const s = 1 - (bob + hop + bounce) * 0.45;
      ground.current.scale.set(s, 0.4 * s, 1);
    }

    const right = armR.current;
    const left = armL.current;
    if (right && left) {
      let rz = Math.sin(t * 1.8) * 0.05;
      let lz = Math.sin(t * 1.8 + 1) * 0.05;
      if (spec.arms === "wave") rz = 1.95 + Math.sin(t * 10) * 0.28;
      if (spec.arms === "swing") {
        rz = 1.2 + Math.sin(t * spec.swaySpeed * 1.4) * 0.8;
        lz = 1.2 + Math.sin(t * spec.swaySpeed * 1.4 + Math.PI) * 0.8;
      }
      if (spec.arms === "type") {
        rz = 0.5 + Math.sin(t * 16) * 0.12;
        lz = 0.5 + Math.sin(t * 16 + 2) * 0.12;
      }
      right.rotation.z = MathUtils.damp(right.rotation.z, rz, 12, dt);
      left.rotation.z = MathUtils.damp(left.rotation.z, lz, 12, dt);
    }
  });

  // Reduced motion: one still pose per expression, no bobbing (the frame loop is on demand).
  void calm;

  return (
    <group ref={root} position={[0, -0.1, 0]}>
      <group ref={body}>
        <mesh scale={[1.1, 0.98, 0.95]}>
          <sphereGeometry args={[1, 56, 40]} />
          <meshPhysicalMaterial
            color={PIP.body}
            roughness={0.5}
            clearcoat={0.3}
            clearcoatRoughness={0.5}
          />
        </mesh>
        <mesh position={[0, -0.42, 0.74]} scale={[0.62, 0.42, 0.22]}>
          <sphereGeometry args={[1, 40, 28]} />
          <meshPhysicalMaterial color={PIP.belly} roughness={0.55} />
        </mesh>
        <Eyes style={spec.eyes} look={look} />
        <Mouth style={spec.mouth} />
        {[-1, 1].map((s) => (
          <mesh
            key={s}
            position={[s * 0.66, -0.1, 0.72]}
            rotation={[0, s * 0.65, 0]}
            scale={[1, 0.62, 0.25]}
          >
            <sphereGeometry args={[0.17, 20, 14]} />
            <meshBasicMaterial color={PIP.cheek} transparent opacity={0.6 * spec.cheeks} />
          </mesh>
        ))}
        <group ref={crest} position={[0, 0.86, 0]}>
          <mesh position={[0, 0.28, 0]} scale={[1, 1, 0.55]}>
            <coneGeometry args={[0.19, 0.62, 4]} />
            <meshPhysicalMaterial color={PIP.crest} roughness={0.45} clearcoat={0.3} />
          </mesh>
          <mesh position={[0, 0.16, 0.07]}>
            <sphereGeometry args={[0.06, 12, 8]} />
            <Ink />
          </mesh>
        </group>
        <Hand side={1} pivot={armR} />
        <Hand side={-1} pivot={armL} />
      </group>
      {expression === "thinking" && <Bubbles color={PIP.think} speed={3} />}
      {expression === "working" && <Bubbles color={PIP.work} speed={7} />}
      {expression === "error" && (
        <>
          <Bubbles color={PIP.alert} speed={9} />
          <Sweat />
        </>
      )}
      {expression === "sleeping" && <Zzz />}
      <mesh ref={ground} position={[0, -1.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.85, 40]} />
        <meshBasicMaterial color={PIP.ink} transparent opacity={0.14} depthWrite={false} />
      </mesh>
    </group>
  );
}

export interface Pip3DProps {
  expression?: PipExpression;
  size?: number;
  /** Pupils and head follow the pointer. */
  track?: boolean;
  className?: string;
}

/** Pip as a real little 3D creature: lit, squashy, expressive, built from plain shapes in code. */
export function Pip3D({ expression = "idle", size = 128, track = true, className }: Pip3DProps) {
  const calm = useMemo(
    () =>
      typeof window !== "undefined" &&
      (document.documentElement.dataset.motion === "off" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    [],
  );
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{ width: size, height: size, flex: "none" }}
    >
      <Canvas
        dpr={[1, 2]}
        frameloop={calm ? "demand" : "always"}
        camera={{ position: [0, 0.15, 6.4], fov: 30 }}
        gl={{
          alpha: true,
          antialias: true,
          toneMapping: NoToneMapping,
          outputColorSpace: SRGBColorSpace,
        }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={1.9} />
        <directionalLight position={[2.5, 3.5, 5]} intensity={1.5} />
        <directionalLight position={[-3, 1, 2]} intensity={0.45} color="#FFE9C9" />
        <PipModel expression={expression} track={track} calm={calm} />
      </Canvas>
    </div>
  );
}
