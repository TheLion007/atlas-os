"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const OLLAMA_KEY = "atlas-ollama";

/**
 * What the person decided about the optional local assistant: which installed model to use, and
 * whether they asked to be left alone ("Plus tard"). Kept in this browser, like the other
 * preferences. `tutorial` is not saved: it only forces the tutorial open for this visit.
 */
interface OllamaStore {
  model: string | null;
  dismissed: boolean;
  tutorial: boolean;

  setModel: (model: string | null) => void;
  dismiss: () => void;
  /** Open the tutorial on purpose (from the Settings or the banner), even after "Later". */
  openTutorial: () => void;
  closeTutorial: () => void;
}

const storage = createJSONStorage(() => {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
});

export const useOllamaStore = create<OllamaStore>()(
  persist(
    (set) => ({
      model: null,
      dismissed: false,
      tutorial: false,

      setModel: (model) => set({ model }),
      dismiss: () => set({ dismissed: true, tutorial: false }),
      openTutorial: () => set({ dismissed: false, tutorial: true }),
      closeTutorial: () => set({ tutorial: false }),
    }),
    {
      name: OLLAMA_KEY,
      version: 1,
      storage,
      skipHydration: true,
      partialize: (s) => ({ model: s.model, dismissed: s.dismissed }),
    },
  ),
);
