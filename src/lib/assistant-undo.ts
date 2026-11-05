"use client";

import { create } from "zustand";

/** Points the assistant earns for each thing it creates (taken back when it is undone). */
export const POINTS_PER_TASK = 2;

/** What the last assistant creation made, so the whole operation can be undone in one click. */
export interface CreatedBatch {
  /** Created objects, in creation order. */
  objectIds: string[];
  /** Relations added between objects that already existed (an existing project put in a plan). */
  edgeIds: string[];
}

interface UndoStore {
  batch: CreatedBatch | null;
  remember: (batch: CreatedBatch | null) => void;
  /** Some of the batch were deleted one by one: they are no longer the batch's to undo. */
  forget: (ids: string[]) => void;
  /** A deletion was undone: they are the batch's again. Returns how many came back. */
  readd: (ids: string[]) => number;
}

export const useAssistantUndo = create<UndoStore>((set, get) => ({
  batch: null,
  remember: (batch) => set({ batch }),
  forget: (ids) => {
    const batch = get().batch;
    if (!batch) return;
    const gone = new Set(ids);
    set({ batch: { ...batch, objectIds: batch.objectIds.filter((id) => !gone.has(id)) } });
  },
  readd: (ids) => {
    const batch = get().batch;
    if (!batch) return 0;
    const have = new Set(batch.objectIds);
    const back = ids.filter((id) => !have.has(id));
    set({ batch: { ...batch, objectIds: [...batch.objectIds, ...back] } });
    return back.length;
  },
}));

export const batchSize = (b: CreatedBatch) => b.objectIds.length + b.edgeIds.length;
