import { buildConstellation } from "@/domain/memory-constellation";
import { layoutConstellation } from "./constellation-layout";
import type { ConstellationJob, ConstellationResult } from "./constellation-compute";

/**
 * Builds the constellation and lays it out off the main thread, so a large memory never makes
 * the interface stutter while the picture is composed. See `constellation-compute.ts`.
 */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ConstellationJob>) => void) | null;
  postMessage: (message: ConstellationResult) => void;
};

scope.onmessage = (e) => {
  const { seq, rows, objects, edges, previous } = e.data;
  const constellation = buildConstellation(rows, objects, edges);
  const positions = layoutConstellation(constellation, new Map(previous));
  scope.postMessage({ seq, constellation, positions: [...positions] });
};
