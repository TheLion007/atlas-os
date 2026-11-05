import type { ApiEdge, ApiObject } from "@/domain/api-types";
import { buildConstellation, type Constellation } from "@/domain/memory-constellation";
import type { MemoryRow } from "@/domain/memory-model";
import { layoutConstellation, type Point3 } from "./constellation-layout";

export interface ConstellationJob {
  seq: number;
  rows: readonly MemoryRow[];
  objects: readonly ApiObject[];
  edges: readonly ApiEdge[];
  previous: [string, Point3][];
}

export interface ConstellationResult {
  seq: number;
  constellation: Constellation;
  positions: [string, Point3][];
}

export interface ComputedConstellation {
  constellation: Constellation;
  positions: Map<string, Point3>;
}

/**
 * Computes the constellation (model + layout) in a Web Worker when the browser has one, and on
 * the spot otherwise (tests, very old browsers). Only the latest request is answered: a result
 * that arrives after a newer request was made is dropped.
 */
export class ConstellationCompute {
  private worker: Worker | null = null;
  private seq = 0;
  private pending: {
    seq: number;
    resolve: (r: ComputedConstellation | null) => void;
    local: () => ComputedConstellation;
  } | null = null;

  /** Set once a worker has failed: from then on everything is computed on the spot. */
  private broken = typeof Worker === "undefined";

  /** The worker, created on first use (and again after `dispose`, e.g. a remount). */
  private ensureWorker(): Worker | null {
    if (this.worker || this.broken) return this.worker;
    try {
      const worker = new Worker(new URL("./constellation.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (e: MessageEvent<ConstellationResult>) => {
        const p = this.pending;
        if (!p || e.data.seq !== p.seq) return; // a stale answer
        this.pending = null;
        p.resolve({ constellation: e.data.constellation, positions: new Map(e.data.positions) });
      };
      // A worker that fails falls back to computing on the spot, for this job and all others.
      worker.onerror = () => {
        worker.terminate();
        this.worker = null;
        this.broken = true;
        const p = this.pending;
        this.pending = null;
        p?.resolve(p.local());
      };
      this.worker = worker;
    } catch {
      this.broken = true;
    }
    return this.worker;
  }

  /** Resolves with the result, or `null` when a newer request superseded this one. */
  run(
    rows: readonly MemoryRow[],
    objects: readonly ApiObject[],
    edges: readonly ApiEdge[],
    previous: ReadonlyMap<string, Point3> | undefined,
  ): Promise<ComputedConstellation | null> {
    const seq = ++this.seq;
    const local = (): ComputedConstellation => {
      const constellation = buildConstellation(rows, objects, edges);
      return { constellation, positions: layoutConstellation(constellation, previous) };
    };
    this.pending?.resolve(null);
    this.pending = null;
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve(local());
    return new Promise((resolve) => {
      this.pending = { seq, resolve, local };
      try {
        worker.postMessage({
          seq,
          rows,
          // Only what the model reads crosses to the worker (no object details).
          objects: objects.map((o) => ({ ...o, details: undefined })),
          edges,
          previous: previous ? [...previous] : [],
        } satisfies ConstellationJob);
      } catch {
        this.pending = null;
        resolve(local());
      }
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending?.resolve(null);
    this.pending = null;
  }
}
