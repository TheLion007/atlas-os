import { createContext, useContext } from "react";
import type { MascotKind } from "@/lib/feedback/prefs";

/** What sets the three creatures apart in 3D; the face, arms and expressions are shared. */
export interface Character {
  body: string;
  belly: string;
  /** Body proportions (x, y, z). */
  shape: [number, number, number];
  /** Height of the belly or muzzle patch and its size. */
  patch: { y: number; scale: [number, number, number] };
  accent: string;
  accentDark: string;
}

export const CHARACTER: Record<MascotKind, Character> = {
  pip: {
    body: "#E8AC3E",
    belly: "#F4CC7E",
    shape: [1.1, 0.98, 0.95],
    patch: { y: -0.42, scale: [0.62, 0.42, 0.22] },
    accent: "#DD5530",
    accentDark: "#1D221F",
  },
  moka: {
    body: "#8E5C88",
    belly: "#C29CBC",
    shape: [1.14, 1.0, 0.95],
    patch: { y: -0.36, scale: [0.82, 0.52, 0.22] },
    accent: "#74466F",
    accentDark: "#E8AC3E",
  },
  fil: {
    body: "#6B8F55",
    belly: "#A2C186",
    shape: [1.1, 0.98, 0.95],
    patch: { y: -0.45, scale: [0.6, 0.4, 0.22] },
    accent: "#86AD68",
    accentDark: "#3F5E32",
  },
};

const KindContext = createContext<MascotKind>("pip");
export const KindProvider = KindContext.Provider;
export const useKind = () => useContext(KindContext);
