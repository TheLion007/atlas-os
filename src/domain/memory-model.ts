import type { ApiEdge, ApiObject } from "./api-types";
import type { ChipRef } from "./command-center";
import { confidenceBand, type ConfidenceBand } from "./confidence";
import { visibleTags } from "./creation";
import { resolveMemoryContext, type ContextRef } from "./context-color";
import type { LifecycleStatus, MemorySourceKind, MemoryType } from "./enums";
import { memoryProvenance } from "./memory";
import { searchObjects } from "./search";

/**
 * The Memory Storage view-model, derived entirely from the shared object graph — the same
 * "one data model, many lenses" pattern as `map-model.ts`/`collection.ts`. Storage (list/grid),
 * Search and the Memory Graph all read the same `MemoryRow`s; nothing here is a second store.
 */

export interface MemoryRow {
  id: string;
  title: string;
  memoryType: MemoryType;
  detail: string;
  sourceKind: MemorySourceKind;
  confidence: number | null;
  confidenceBand: ConfidenceBand;
  status: LifecycleStatus;
  pinned: boolean;
  /** Free-text tags (the pre-existing `objects.tags` surface), reserved tags stripped. */
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** The project/sub-project this memory's colour is inherited from, or null if unset. */
  primary: ContextRef | null;
  /** Other project/sub-project contexts this memory is also `about`. */
  secondary: ContextRef[];
  /** The primary context's colour (a design-token key), or null — never stored on the memory. */
  color: string | null;
  /** What this memory was extracted from, if anything. */
  derivedFrom: ChipRef[];
  /** The source material backing the statement. */
  supportedBy: ChipRef[];
  /** Every `about` target, including non-project ones (e.g. a property, a decision). */
  about: ChipRef[];
  /** Distinct related objects across about/derived_from/supported_by/references, either way. */
  relationshipCount: number;
}

const str = (d: Record<string, unknown> | undefined, k: string): string => {
  const v = d?.[k];
  return typeof v === "string" ? v : "";
};
const bool = (d: Record<string, unknown> | undefined, k: string): boolean => d?.[k] === true;

/** Builds one row per live memory object. Order is unspecified; sort with `sortMemoryRows`. */
export function buildMemoryRows(
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): MemoryRow[] {
  const rows: MemoryRow[] = [];
  for (const n of nodes) {
    if (n.type !== "memory") continue;
    const ctx = resolveMemoryContext(n.id, nodes, edges);
    const prov = memoryProvenance(n.id, nodes, edges);
    const related = new Set<string>();
    for (const c of [
      ...(prov?.about ?? []),
      ...(prov?.derivedFrom ?? []),
      ...(prov?.supportedBy ?? []),
    ])
      related.add(c.id);
    for (const e of edges) {
      if (e.kind !== "references") continue;
      if (e.from === n.id) related.add(e.to);
      else if (e.to === n.id) related.add(e.from);
    }
    rows.push({
      id: n.id,
      title: n.title,
      memoryType: (n.details?.memoryType as MemoryType | undefined) ?? "fact",
      detail: str(n.details, "detail"),
      sourceKind: prov?.sourceKind ?? "user",
      confidence: n.confidence,
      confidenceBand: confidenceBand(n.confidence),
      status: n.status,
      pinned: bool(n.details, "pinned"),
      tags: visibleTags(n.tags),
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      primary: ctx.primary,
      secondary: ctx.secondary,
      color: ctx.color,
      derivedFrom: prov?.derivedFrom ?? [],
      supportedBy: prov?.supportedBy ?? [],
      about: prov?.about ?? [],
      relationshipCount: related.size,
    });
  }
  return rows;
}

// ── Filtering ────────────────────────────────────────────────────────────────────────────────

export interface MemoryFilters {
  query: string;
  /** A project/sub-project id, `"all"`, or `"none"` for memories with no primary context. */
  projectId: string | "all" | "none";
  memoryType: MemoryType | "all";
  confidenceBand: ConfidenceBand | "all";
  /** `"all"` includes archived (dropped); `"active"` is every non-dropped status. */
  status: LifecycleStatus | "all" | "active";
}

export const DEFAULT_MEMORY_FILTERS: MemoryFilters = {
  query: "",
  projectId: "all",
  memoryType: "all",
  confidenceBand: "all",
  status: "active",
};

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A memory's primary and secondary contexts together — "which project(s) is this about". */
const contextIds = (row: MemoryRow): string[] =>
  [row.primary, ...row.secondary].flatMap((c) => (c ? [c.id] : []));

export function filterMemoryRows(rows: readonly MemoryRow[], filters: MemoryFilters): MemoryRow[] {
  const q = fold(filters.query.trim());
  return rows.filter((r) => {
    if (filters.projectId === "none" && contextIds(r).length > 0) return false;
    if (
      filters.projectId !== "all" &&
      filters.projectId !== "none" &&
      !contextIds(r).includes(filters.projectId)
    )
      return false;
    if (filters.memoryType !== "all" && r.memoryType !== filters.memoryType) return false;
    if (filters.confidenceBand !== "all" && r.confidenceBand !== filters.confidenceBand)
      return false;
    if (filters.status === "active" && r.status === "dropped") return false;
    else if (filters.status !== "all" && filters.status !== "active" && r.status !== filters.status)
      return false;
    if (q === "") return true;
    return (
      fold(r.title).includes(q) ||
      fold(r.detail).includes(q) ||
      r.tags.some((t) => fold(t).includes(q)) ||
      (r.primary ? fold(r.primary.title).includes(q) : false)
    );
  });
}

// ── Sorting ──────────────────────────────────────────────────────────────────────────────────

export type MemorySort = "updated" | "created" | "alphabetical" | "confidence" | "relevance";

/**
 * `"relevance"` needs the full node list to rank by (title/tag/detail match strength, the same
 * scoring the command palette uses) — with no query, it behaves like `"updated"`.
 */
export function sortMemoryRows(
  rows: readonly MemoryRow[],
  sort: MemorySort,
  opts: { query?: string; nodes?: readonly ApiObject[] } = {},
): MemoryRow[] {
  const query = opts.query?.trim() ?? "";
  if (sort === "relevance" && query !== "" && opts.nodes) {
    const scoreById = new Map(searchObjects(opts.nodes, query).map((h) => [h.node.id, h.score]));
    return [...rows].sort(
      (a, b) =>
        (scoreById.get(b.id) ?? 0) - (scoreById.get(a.id) ?? 0) || a.title.localeCompare(b.title),
    );
  }
  const byUpdated = (a: MemoryRow, b: MemoryRow) => b.updatedAt.localeCompare(a.updatedAt);
  switch (sort) {
    case "created":
      return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "alphabetical":
      return [...rows].sort((a, b) => a.title.localeCompare(b.title));
    case "confidence":
      return [...rows].sort(
        (a, b) => (b.confidence ?? -1) - (a.confidence ?? -1) || a.title.localeCompare(b.title),
      );
    case "updated":
    case "relevance":
    default:
      return [...rows].sort(byUpdated);
  }
}

// ── Grouping ─────────────────────────────────────────────────────────────────────────────────

export interface MemoryGroup {
  contextId: string | null;
  title: string;
  color: string | null;
  rows: MemoryRow[];
}

/** Groups by primary context, alphabetically; ungrouped memories form one trailing group. */
export function groupMemoryRowsByContext(rows: readonly MemoryRow[]): MemoryGroup[] {
  const byId = new Map<string, MemoryGroup>();
  const none: MemoryGroup = { contextId: null, title: "", color: null, rows: [] };
  for (const r of rows) {
    if (!r.primary) {
      none.rows.push(r);
      continue;
    }
    const g = byId.get(r.primary.id) ?? {
      contextId: r.primary.id,
      title: r.primary.title,
      color: r.color,
      rows: [],
    };
    g.rows.push(r);
    byId.set(r.primary.id, g);
  }
  const groups = [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
  return none.rows.length > 0 ? [...groups, none] : groups;
}

// ── Memory Graph subset ──────────────────────────────────────────────────────────────────────

const MEMORY_EDGE_KINDS = new Set(["about", "supported_by", "derived_from", "references"]);

/**
 * A bounded subgraph for the Memory Graph lens: every memory, plus everything reachable from a
 * memory within `depth` hops along memory-relevant edges (about/supported_by/derived_from and
 * references, since a memory can reference another memory). Not a second graph engine — the same
 * `GraphCanvas` renders this, just given a smaller node/edge set (brief §12, ADR 0002 §8).
 */
export function memoryGraphSubset(
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
  opts: { depth?: number } = {},
): { nodes: ApiObject[]; edges: ApiEdge[] } {
  const depth = opts.depth ?? 1;
  const relevant = edges.filter((e) => MEMORY_EDGE_KINDS.has(e.kind));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const keep = new Set<string>(nodes.filter((n) => n.type === "memory").map((n) => n.id));

  let frontier = new Set(keep);
  for (let d = 0; d < depth && frontier.size > 0; d++) {
    const next = new Set<string>();
    for (const e of relevant) {
      const reachable = frontier.has(e.from) ? e.to : frontier.has(e.to) ? e.from : null;
      if (reachable && !keep.has(reachable)) next.add(reachable);
    }
    for (const id of next) keep.add(id);
    frontier = next;
  }

  const keptNodes = [...keep].flatMap((id) => {
    const n = byId.get(id);
    return n ? [n] : [];
  });
  const keptEdges = relevant.filter((e) => keep.has(e.from) && keep.has(e.to));
  return { nodes: keptNodes, edges: keptEdges };
}
