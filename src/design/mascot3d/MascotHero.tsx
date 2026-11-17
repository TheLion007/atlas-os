"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { MascotMood } from "@/lib/feedback/celebrate";
import type { MascotKind } from "@/lib/feedback/prefs";
import { Mascot } from "../Mascot";
import type { Outfit } from "./accessories";
import { expressionForMood, type PipExpression } from "./expressions";

// three.js is a heavy, browser-only chunk: it loads only where a 3D mascot is shown.
const Pip3D = dynamic(() => import("./Pip3D").then((m) => m.Pip3D), { ssr: false });

function webgl(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

interface MascotHeroProps {
  kind?: MascotKind;
  mood?: MascotMood;
  /** Overrides the mood: any of Pip's nine expressions. */
  expression?: PipExpression;
  /** What Pip wears. */
  outfit?: Outfit;
  size?: number;
  track?: boolean;
}

/**
 * The big mascot: Pip in 3D wherever the machine can draw it, the flat Pip (and Moka and Fil)
 * everywhere else. It never leaves a hole: the flat one stands in while the 3D one loads.
 */
export function MascotHero({
  kind = "pip",
  mood = "idle",
  expression,
  outfit,
  size = 112,
  track = true,
}: MascotHeroProps) {
  const [gl, setGl] = useState<boolean | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGl(webgl()));
    return () => cancelAnimationFrame(id);
  }, []);

  if (kind !== "pip" || gl === false)
    return <Mascot kind={kind} mood={mood} size={size} track={track} />;
  if (gl === null)
    return <div aria-hidden="true" style={{ width: size, height: size, flex: "none" }} />;
  return (
    <Pip3D
      expression={expression ?? expressionForMood(mood)}
      outfit={outfit}
      size={size}
      track={track}
    />
  );
}
