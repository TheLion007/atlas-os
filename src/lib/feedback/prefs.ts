"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  seasonKey,
  seasonOf,
  type AccessoryId,
  type Outfit,
  type Slot,
} from "@/design/mascot3d/accessories";

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
  /** What Pip wears (3D Pip only): one piece per slot. */
  outfit: Outfit;
  /** Tasks finished during a season, per season and year (e.g. "halloween-2026"). */
  seasonTasks: Record<string, number>;

  set: (
    patch: Partial<
      Omit<PrefsState, "set" | "setSound" | "addPoints" | "countSeasonTask" | "wear" | "undress">
    >,
  ) => void;
  addPoints: (n: number) => void;
  /** A task was finished: if it is a season, it counts towards that season's pieces. */
  countSeasonTask: (date?: Date) => void;
  wear: (id: AccessoryId, slot: Slot) => void;
  undress: (slot: Slot) => void;
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
      outfit: {},
      seasonTasks: {},

      set: (patch) => set(patch),
      addPoints: (n) => set((s) => ({ points: s.points + n })),
      countSeasonTask: (date = new Date()) => {
        const season = seasonOf(date);
        if (!season) return;
        const key = seasonKey(season, date);
        set((s) => ({ seasonTasks: { ...s.seasonTasks, [key]: (s.seasonTasks[key] ?? 0) + 1 } }));
      },
      wear: (id, slot) => set((s) => ({ outfit: { ...s.outfit, [slot]: id } })),
      undress: (slot) =>
        set((s) => {
          const outfit = { ...s.outfit };
          delete outfit[slot];
          return { outfit };
        }),
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
