"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ApiObject } from "@/domain/api-types";
import type { CreatableType } from "@/domain/creation";
import type { ObjectType } from "@/domain/enums";
import type { MessageKey } from "@/i18n";

/**
 * Ephemeral UI state shared across the shell. Anything a link should reproduce (scenario, the
 * peeked object) lives in the URL instead; this store holds only per-viewer preferences and
 * open/closed flags. Only `sidebar`, `peekPinned` and `recent` persist, and reading storage is
 * guarded because it can be unavailable (private windows, blocked site data).
 */
export type SidebarMode = "auto" | "expanded" | "collapsed";
const RECENT_MAX = 8;

/** A request to create an object, from anywhere: the palette, a collection, an object, a lens. */
export interface CreateRequest {
  /** Omitted: the dialog opens on the type picker. */
  type?: CreatableType;
  /** The object it is created inside; the relation to it follows from the two types. */
  parent?: { id: string; type: ObjectType; title: string } | null;
  /** Prefilled for a location, e.g. from a click on the globe. */
  coords?: { lat: number; lng: number } | null;
  /** Prefilled field values, e.g. "an actual asset" when adding an asset from Finance. */
  preset?: Readonly<Record<string, string>>;
  /** The dialog title, when the request is more specific than the type ("New asset"). */
  titleKey?: MessageKey;
}

export interface Toast {
  id: number;
  text: string;
  /** Satisfaction points earned (a finished task): the toast celebrates instead of confirming. */
  points?: number;
  /** An optional follow-up, e.g. open what was just created. */
  action?: { label: string; href: string };
}
let toastSeq = 0;

export interface UiState {
  /** `auto`: collapsed to icons below the wide breakpoint, expanded above it. */
  sidebar: SidebarMode;
  navOpen: boolean;
  paletteOpen: boolean;
  assistantOpen: boolean;
  /** A pinned peek stays put until closed explicitly; a transient one closes on Escape. */
  peekPinned: boolean;
  /** Most recently peeked object ids, newest first. */
  recent: string[];
  create: CreateRequest | null;
  /** The object being edited in the dialog. */
  edit: ApiObject | null;
  toasts: Toast[];

  openCreate: (request?: CreateRequest) => void;
  closeCreate: () => void;
  openEdit: (node: ApiObject) => void;
  closeEdit: () => void;
  pushToast: (text: string, action?: Toast["action"], points?: number) => void;
  dismissToast: (id: number) => void;
  setSidebar: (mode: SidebarMode) => void;
  setNavOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setAssistantOpen: (open: boolean) => void;
  setPeekPinned: (pinned: boolean) => void;
  pushRecent: (id: string) => void;
}

const safeStorage = createJSONStorage(() => {
  try {
    return window.localStorage;
  } catch {
    // Storage blocked: behave as if nothing is stored.
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
});

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebar: "auto",
      navOpen: false,
      paletteOpen: false,
      assistantOpen: false,
      peekPinned: false,
      recent: [],
      create: null,
      edit: null,
      toasts: [],

      openCreate: (request = {}) => set({ create: request, paletteOpen: false }),
      closeCreate: () => set({ create: null }),
      openEdit: (edit) => set({ edit }),
      closeEdit: () => set({ edit: null }),
      pushToast: (text, action, points) =>
        set((s) => ({ toasts: [...s.toasts, { id: ++toastSeq, text, action, points }].slice(-3) })),
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      setSidebar: (sidebar) => set({ sidebar }),
      setNavOpen: (navOpen) => set({ navOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
      setPeekPinned: (peekPinned) => set({ peekPinned }),
      pushRecent: (id) =>
        set((s) => ({ recent: [id, ...s.recent.filter((r) => r !== id)].slice(0, RECENT_MAX) })),
    }),
    {
      name: "atlas-os.ui",
      storage: safeStorage,
      partialize: (s) => ({ sidebar: s.sidebar, peekPinned: s.peekPinned, recent: s.recent }),
      // Hydrated in an effect by the Shell, so the first client render matches the server's.
      skipHydration: true,
    },
  ),
);
