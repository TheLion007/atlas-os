"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BackSide, Color, type CanvasTexture, type Mesh } from "three";
import { SPACE_COLORS as C } from "@/design/tokens";
import { buildEarthTextures } from "./earth-texture";

export const GLOBE_RADIUS = 10;

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A Fresnel rim: faint face-on, brighter at the grazing edge, so the sphere reads as a lit
// planet with a thin atmosphere rather than a flat disc. Cheap, and the only shader in the scene.
const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 glowColor;
  varying vec3 vNormal;
  void main() {
    float rim = pow(1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0), 2.4);
    gl_FragColor = vec4(glowColor, rim * 0.7);
  }
`;

/**
 * The planet itself: a real sphere textured from the same Natural Earth data the rest of Atlas
 * uses (see `earth-texture.ts`), lit so the far side falls dark, with a thin additive
 * atmosphere shell. No photograph is loaded — the "day" and "emissive" maps are drawn from real
 * vector geography at load time and cached.
 */
export function Globe({ meshRef }: { meshRef: React.RefObject<Mesh | null> }) {
  const [textures, setTextures] = useState<{ map: CanvasTexture; emissive: CanvasTexture } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    void buildEarthTextures("50m").then((t) => {
      if (!cancelled) setTextures(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const atmosphereUniforms = useMemo(() => ({ glowColor: { value: new Color(C.fgMuted) } }), []);
  const oceanRef = useRef<Mesh>(null);

  return (
    <group>
      {/* The ocean: a plain sphere in the app's own background colour, visible until (and
          faintly through) the textured land shell, so the two stay the same restrained palette. */}
      <mesh ref={oceanRef}>
        <sphereGeometry args={[GLOBE_RADIUS * 0.998, 64, 64]} />
        <meshBasicMaterial color={C.bg} />
      </mesh>

      <mesh ref={meshRef} renderOrder={1}>
        <sphereGeometry args={[GLOBE_RADIUS, 96, 96]} />
        {textures ? (
          <meshStandardMaterial
            map={textures.map}
            emissiveMap={textures.emissive}
            emissive={0xffffff}
            emissiveIntensity={0.6}
            roughness={1}
            metalness={0}
            transparent
          />
        ) : (
          <meshBasicMaterial color={C.bg} transparent opacity={0} />
        )}
      </mesh>

      {/* The atmosphere: a slightly larger, backside-only shell so it only shows at the limb. */}
      <mesh scale={1.045}>
        <sphereGeometry args={[GLOBE_RADIUS, 64, 64]} />
        <shaderMaterial
          vertexShader={ATMOSPHERE_VERTEX}
          fragmentShader={ATMOSPHERE_FRAGMENT}
          uniforms={atmosphereUniforms}
          transparent
          depthWrite={false}
          side={BackSide}
        />
      </mesh>
    </group>
  );
}
