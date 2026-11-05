import type { ApiEdge, ApiObject } from "./api-types";
import type { ChipRef } from "./command-center";
import type { MemorySourceKind } from "./enums";

/**
 * Provenance: what lets a Memory answer "why does Atlas remember this?" (ADR 0002 §9, brief §4).
 * Nothing here is a free-text field — it is read entirely off the object's own `sourceKind` and
 * its edges, so provenance can never be typed in and drift from what actually happened.
 */
export interface MemoryProvenance {
  sourceKind: MemorySourceKind;
  /** What this memory was extracted from, if anything (a Project, a Decision, a Note, ...). */
  derivedFrom: ChipRef[];
  /** What this memory concerns. */
  about: ChipRef[];
  /** The source material backing the statement (documents). */
  supportedBy: ChipRef[];
}

const ref = (n: ApiObject): ChipRef => ({ id: n.id, type: n.type, title: n.title });

function targetsOf(kind: ApiEdge["kind"], memoryId: string, edges: readonly ApiEdge[]): string[] {
  return edges.filter((e) => e.kind === kind && e.from === memoryId).map((e) => e.to);
}

export function memoryProvenance(
  memoryId: string,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): MemoryProvenance | null {
  const memory = nodes.find((n) => n.id === memoryId && n.type === "memory");
  if (!memory) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const resolve = (ids: string[]): ChipRef[] =>
    ids.flatMap((id) => {
      const n = byId.get(id);
      return n ? [ref(n)] : [];
    });

  const sourceKind = (memory.details?.sourceKind as MemorySourceKind | undefined) ?? "user";
  return {
    sourceKind,
    derivedFrom: resolve(targetsOf("derived_from", memoryId, edges)),
    about: resolve(targetsOf("about", memoryId, edges)),
    supportedBy: resolve(targetsOf("supported_by", memoryId, edges)),
  };
}
