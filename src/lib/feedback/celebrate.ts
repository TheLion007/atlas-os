"use client";

import { create } from "zustand";
import { CONFETTI_COLORS } from "@/design/palette";
import { usePrefs } from "./prefs";
import { playSound } from "./sound";

export type MascotMood = "idle" | "happy" | "cheer" | "sleep";

interface Particle {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  r: number;
  c: string;
  w: number;
}

/**
 * The satisfaction layer's live state: confetti in flight and what the mascot is feeling and
 * saying. Nothing here persists; it is the "moment", not data.
 */
interface FeedbackState {
  confetti: Particle[];
  mood: MascotMood;
  say: string | null;
  burst: (x: number, y: number) => void;
  react: (mood: MascotMood, line?: string | null) => void;
}

let seq = 0;
let moodTimer: ReturnType<typeof setTimeout> | undefined;

export const useFeedback = create<FeedbackState>((set) => ({
  confetti: [],
  mood: "idle",
  say: null,
  burst: (x, y) => {
    const prefs = usePrefs.getState();
    if (!prefs.celebrations || !prefs.motion) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const parts: Particle[] = Array.from({ length: 18 }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 80;
      return {
        id: ++seq,
        x,
        y,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed - 40,
        r: Math.random() * 600 - 300,
        c: CONFETTI_COLORS[i % CONFETTI_COLORS.length] as string,
        w: 5 + Math.random() * 4,
      };
    });
    set((s) => ({ confetti: [...s.confetti, ...parts] }));
    setTimeout(
      () => set((s) => ({ confetti: s.confetti.filter((p) => !parts.includes(p)) })),
      1100,
    );
  },
  react: (mood, line = null) => {
    clearTimeout(moodTimer);
    set({ mood, say: line });
    moodTimer = setTimeout(() => set({ mood: "idle", say: null }), 2800);
  },
}));

const CHEERS = [
  "Bravo ! Une de moins.",
  "Superbe avancée !",
  "Je le savais : tu gères.",
  "Et hop, terminé !",
  "Encore une, on est lancés !",
];

/**
 * A task is done: the sound, the confetti from where the click happened, and the mascot cheers.
 * (The toast is pushed by the caller, which owns the translated text.)
 */
export function celebrate(origin?: { x: number; y: number }): void {
  playSound("done");
  const x = origin?.x ?? (typeof window !== "undefined" ? window.innerWidth / 2 : 0);
  const y = origin?.y ?? (typeof window !== "undefined" ? window.innerHeight / 2 : 0);
  const { burst, react } = useFeedback.getState();
  burst(x, y);
  react("cheer", CHEERS[Math.floor(Math.random() * CHEERS.length)]);
}
