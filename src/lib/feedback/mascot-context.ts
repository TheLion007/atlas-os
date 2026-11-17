"use client";

import { create } from "zustand";

const ERROR_MS = 4200;
const GREET_MS = 3400;
const DIZZY_MS = 2800;

/**
 * What the mascot can sense, apart from the satisfaction layer (celebrate.ts) and the timer:
 * a problem just happened, the assistant is thinking, the screen is being shaken about, the
 * machine is offline or left alone. Nothing here persists; it is the "moment", not data.
 */
interface MascotContextState {
  thinking: boolean;
  offline: boolean;
  idle: boolean;
  errorUntil: number;
  greetUntil: number;
  dizzyUntil: number;
  setThinking: (on: boolean) => void;
  setOffline: (on: boolean) => void;
  setIdle: (on: boolean) => void;
  flagError: () => void;
  greet: () => void;
  flagDizzy: () => void;
}

export const useMascotContext = create<MascotContextState>((set) => ({
  thinking: false,
  offline: false,
  idle: false,
  errorUntil: 0,
  greetUntil: 0,
  dizzyUntil: 0,
  setThinking: (thinking) => set({ thinking }),
  setOffline: (offline) => set({ offline }),
  setIdle: (idle) => set({ idle }),
  flagError: () => set({ errorUntil: Date.now() + ERROR_MS }),
  greet: () => set({ greetUntil: Date.now() + GREET_MS }),
  flagDizzy: () => set({ dizzyUntil: Date.now() + DIZZY_MS }),
}));
