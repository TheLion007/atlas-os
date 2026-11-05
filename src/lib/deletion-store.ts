"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { DeleteReceipt } from "@/domain/api-types";
import type { ObjectType } from "@/domain/enums";

/** How long a deletion can be undone before it becomes final. */
export const UNDO_DELAY_MS = 8000;

/** A deletion that can still be undone. */
export interface PendingDeletion {
  key: number;
  title: string;
  type: ObjectType;
  /** How many objects went in this step (the root and what went with it). */
  count: number;
  receipt: DeleteReceipt;
  hasDocuments: boolean;
  /** Objects the assistant had just created: their creation points were taken back. */
  assistantIds: string[];
}

interface DeletionStore {
  /** The object a confirmation is open for. */
  confirmId: string | null;
  pending: PendingDeletion[];
  /** Where a context menu is open, and for which object. */
  menu: { id: string; x: number; y: number } | null;
  /** The object a lens has selected on its own (the vault, the notes, the graph). */
  selection: string | null;
  setSelection: (id: string | null) => void;
  askConfirm: (id: string | null) => void;
  push: (d: Omit<PendingDeletion, "key">) => PendingDeletion;
  drop: (key: number) => void;
  openMenu: (menu: DeletionStore["menu"]) => void;
}

let seq = 0;

export const useDeletion = create<DeletionStore>((set) => ({
  confirmId: null,
  pending: [],
  menu: null,
  selection: null,
  setSelection: (selection) => set({ selection }),
  askConfirm: (id) => set({ confirmId: id }),
  push: (d) => {
    const entry = { ...d, key: ++seq };
    set((s) => ({ pending: [...s.pending, entry] }));
    return entry;
  },
  drop: (key) => set((s) => ({ pending: s.pending.filter((p) => p.key !== key) })),
  openMenu: (menu) => set({ menu }),
}));

/**
 * A lens that keeps its own selection (not the URL's `?peek=`) tells the shell which object is
 * selected, so the Del key acts on it. Cleared when the lens goes away.
 */
export function useSelectedObject(id: string | null | undefined) {
  const set = useDeletion((s) => s.setSelection);
  useEffect(() => {
    set(id ?? null);
    return () => set(null);
  }, [id, set]);
}
