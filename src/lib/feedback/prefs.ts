"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThemeChoice = "light" | "dark" | "system";
export type SoundKind = "click" | "check" | "done" | "create" | "drop" | "error";
export type MascotKind = "pip" | "moka" | "fil";
export type ThemePair = "indigo" | "teal" | "violet";
export type SoundProfile = "soft" | "normal" | "crystal";

export const SOUND_KINDS: readonly SoundKind[] = [
  "click",
  "check",
  "done",
  "create",
  "drop",
  "error",
];

/**
 * Per-viewer feel preferences: theme, sounds, motion, celebrations, mascot. Kept in
 * `localStorage` (guarded: it can be blocked); the pre-paint script in the root layout reads the
 * same key, so the theme is right on the very first frame.
 */
export interface PrefsState {
  theme: ThemeChoice;
  /** Which light/dark pair of palettes (provisional picker, see globals.css). */
  pair: ThemePair;
  soundOn: boolean;
  /** 0–100. */
  volume: number;
  /** How bright the sounds are: soft (default), normal or crystal. */
  soundProfile: SoundProfile;
  sounds: Record<SoundKind, boolean>;
  /** false: all animation off (on top of the system's prefers-reduced-motion). */
  motion: boolean;
  /** Confetti and the satisfaction toast when a task is done. */
  celebrations: boolean;
  mascotOn: boolean;
  mascot: MascotKind;
  /** The mascot's eyes follow the pointer. */
  mascotTracks: boolean;
  /** Satisfaction points earned by finishing tasks. */
  points: number;

  set: (patch: Partial<Omit<PrefsState, "set" | "setSound" | "addPoints">>) => void;
  addPoints: (n: number) => void;
  setSound: (kind: SoundKind, on: boolean) => void;
}

export const PREFS_KEY = "atlas-prefs";

const storage = createJSONStorage(() => {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
});

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: "system",
      pair: "indigo",
      soundOn: true,
      volume: 35,
      soundProfile: "soft",
      sounds: { click: true, check: true, done: true, create: true, drop: true, error: true },
      motion: true,
      celebrations: true,
      mascotOn: true,
      mascot: "pip",
      mascotTracks: true,
      points: 0,

      set: (patch) => set(patch),
      addPoints: (n) => set((s) => ({ points: s.points + n })),
      setSound: (kind, on) => set((s) => ({ sounds: { ...s.sounds, [kind]: on } })),
    }),
    {
      name: PREFS_KEY,
      version: 2,
      // Version 2 made the sounds quieter and softer: start everyone from the new default volume.
      migrate: (state, version) => {
        const old = state as Partial<PrefsState>;
        return version < 2 ? { ...old, volume: 35, soundProfile: "soft" } : old;
      },
      storage,
      // Hydrated in an effect, so the first client render matches the server's.
      skipHydration: true,
    },
  ),
);
