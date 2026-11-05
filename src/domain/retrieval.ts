import type { ApiEdge, ApiObject } from "./api-types";
import type { ChipRef } from "./command-center";
import { confidenceBand } from "./confidence";
import type { ObjectType } from "./enums";
import { searchObjects } from "./search";

/**
 * The retrieval foundation for the future AI assistant (ADR 0002 §7, brief §18–§20). Pure and
 * deterministic — no network call, no LLM, no embeddings — so it is exercised the same way as
 * every other engine module: unit tests over plain data, no server required.
 *
 * Priority is structure first, semantics last (brief §19): explicit context, then relationships
 * the user actually created, then tags the user actually typed, then recency and confidence, and
 * only then — not implemented here, see `SEMANTIC_WEIGHT` — similarity. This is the one and only
 * path the future assistant may read Memory through; it never queries the database directly
 * (ADR 0002, principle 8).
 */

export interface RetrievalBudget {
  /** Hard cap on how many objects are handed to the caller. */
  maxItems: number;
  /** Hard cap on estimated size, so a caller building an LLM prompt has a real ceiling. */
  maxTokens: number;
  /** How many edge hops from the focus object still count as a "direct relationship". */
  maxRelationDepth: number;
}

/** Conservative, configurable, and deliberately not tied to any one model's tokenizer. */
export const DEFAULT_RETRIEVAL_BUDGET: RetrievalBudget = {
  maxItems: 12,
  maxTokens: 2_000,
  maxRelationDepth: 2,
};

export interface RetrievalContext {
  /** The object currently in focus (peeked/open), if any — the strongest signal there is. */
  focusObjectId?: string | null;
  /** Free text, matched the same way the command palette matches it (title/tags/detail text). */
  query?: string;
}

export type RetrievalReason =
  | "focus"
  | "direct-relation"
  | "project-relation"
  | "location-relation"
  | "shared-tag"
  | "type-match"
  | "text-match"
  | "recency"
  | "confidence";

export interface RetrievedItem {
  object: ChipRef;
  score: number;
  reasons: readonly RetrievalReason[];
}

export interface RetrievalResult {
  citations: ChipRef[];
  items: readonly RetrievedItem[];
  /** True if the budget cut off items that would otherwise have qualified. */
  truncated: boolean;
}

/** A cheap, model-agnostic size estimate: ~4 characters per token, the same rule of thumb used
 * for chat-sized English text everywhere a real tokenizer would be overkill. */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

const WEIGHT = {
  directRelation: 50,
  projectRelation: 20,
  locationRelation: 15,
  sharedTag: 8,
  typeMatch: 8,
  textMatch: 30,
  recencyMax: 5,
  confidenceMax: 5,
};
/** Not implemented: no embeddings dependency exists (ADR 0002 §7, §9). Exported and always zero,
 * so the tier is visible in the scoring model rather than silently absent — enabling it later is
 * additive, not a rewrite. */
export const SEMANTIC_WEIGHT = 0;

const ref = (n: ApiObject): ChipRef => ({ id: n.id, type: n.type, title: n.title });

const str = (d: Record<string, unknown> | undefined, k: string): string | null => {
  const v = d?.[k];
  return typeof v === "string" && v !== "" ? v : null;
};

/** BFS over live edges from `start`, returning each reachable object's shortest hop count. */
function hopsFrom(start: string, edges: readonly ApiEdge[], maxDepth: number): Map<string, number> {
  const depth = new Map<string, number>([[start, 0]]);
  let frontier = [start];
  for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const e of edges) {
      const from = frontier.includes(e.from) ? e.to : frontier.includes(e.to) ? e.from : null;
      if (from === null || depth.has(from)) continue;
      depth.set(from, d);
      next.push(from);
    }
    frontier = next;
  }
  depth.delete(start);
  return depth;
}

/** The nearest containing project/sub-project of an object, walking `contains` upward. */
function projectOf(id: string, edges: readonly ApiEdge[], byId: ReadonlyMap<string, ApiObject>) {
  const seen = new Set<string>();
  let cur: string | undefined = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const node = byId.get(cur);
    if (node && (node.type === "project" || node.type === "sub_project")) return node.id;
    const parentEdge = edges.find((e) => e.kind === "contains" && e.to === cur);
    cur = parentEdge?.from;
  }
  return null;
}

/** The place an object is located at, if any (`located_at`, one hop — matches the domain's own
 * definition of "location relationship" elsewhere, e.g. map-model.ts's nearestPlace). */
function placeOf(id: string, edges: readonly ApiEdge[]): string | null {
  return edges.find((e) => e.kind === "located_at" && e.from === id)?.to ?? null;
}

/**
 * Builds a budgeted, ranked, cited context for a query — the shape the future assistant (and
 * nothing else) is meant to read Memory and the rest of Atlas through. Structure first: an
 * object the user explicitly linked, tagged, or grouped with the focus always outranks one that
 * merely shares words with the query.
 */
export function buildContext(
  ctx: RetrievalContext,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
  budget: RetrievalBudget = DEFAULT_RETRIEVAL_BUDGET,
): RetrievalResult {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const focus = ctx.focusObjectId ? byId.get(ctx.focusObjectId) : null;

  const scores = new Map<string, { score: number; reasons: Set<RetrievalReason> }>();
  const bump = (id: string, amount: number, reason: RetrievalReason) => {
    if (id === focus?.id || amount <= 0) return;
    const cur = scores.get(id) ?? { score: 0, reasons: new Set<RetrievalReason>() };
    cur.score += amount;
    cur.reasons.add(reason);
    scores.set(id, cur);
  };

  // 1. Explicit user context is the focus itself — always the first citation, never re-scored
  //    against its own relationships.

  // 2. Direct object relationship.
  if (focus) {
    for (const [id, depth] of hopsFrom(focus.id, edges, budget.maxRelationDepth)) {
      bump(id, WEIGHT.directRelation / depth, "direct-relation");
    }
  }

  // 3. Project relationship.
  if (focus) {
    const focusProject = projectOf(focus.id, edges, byId);
    if (focusProject) {
      for (const n of nodes) {
        if (n.id === focusProject || projectOf(n.id, edges, byId) === focusProject) {
          bump(n.id, WEIGHT.projectRelation, "project-relation");
        }
      }
    }
  }

  // 4. Location relationship.
  if (focus) {
    const focusPlace = placeOf(focus.id, edges);
    if (focusPlace) {
      for (const n of nodes)
        if (placeOf(n.id, edges) === focusPlace)
          bump(n.id, WEIGHT.locationRelation, "location-relation");
    }
  }

  // 5. User tags.
  if (focus && focus.tags.length > 0) {
    const focusTags = new Set(focus.tags);
    for (const n of nodes) {
      const shared = n.tags.filter((t) => focusTags.has(t)).length;
      if (shared > 0) bump(n.id, WEIGHT.sharedTag * shared, "shared-tag");
    }
  }

  // 6. Object type (the query names a type, e.g. "memories", "projects").
  const query = ctx.query?.trim() ?? "";
  if (query !== "") {
    const named = matchedType(query);
    if (named)
      for (const n of nodes) if (n.type === named) bump(n.id, WEIGHT.typeMatch, "type-match");

    // Text relevance — the same ranking the command palette already uses, folded in as one more
    // tier rather than a separate search step (brief §9's "one entry point").
    for (const hit of searchObjects(nodes, query, { limit: 50 })) {
      bump(hit.node.id, (WEIGHT.textMatch * hit.score) / 100, "text-match");
    }
  }

  // 7 & 8. Recency and confidence — tie-breakers, not primary signals, so they are scaled small
  // and only ever nudge an already-relevant item, never manufacture relevance on their own.
  const updatedTimes = nodes.map((n) => Date.parse(n.updatedAt)).filter(Number.isFinite);
  const newest = updatedTimes.length > 0 ? Math.max(...updatedTimes) : 0;
  const oldest = updatedTimes.length > 0 ? Math.min(...updatedTimes) : 0;
  const span = Math.max(1, newest - oldest);
  for (const [id] of scores) {
    const n = byId.get(id);
    if (!n) continue;
    const recency = (Date.parse(n.updatedAt) - oldest) / span;
    bump(id, recency * WEIGHT.recencyMax, "recency");
    if (n.confidence !== null && confidenceBand(n.confidence) === "high") {
      bump(id, WEIGHT.confidenceMax, "confidence");
    }
  }

  const ranked = [...scores.entries()]
    .map(([id, v]) => ({ object: byId.get(id) as ApiObject, score: v.score, reasons: v.reasons }))
    .filter((r) => r.object !== undefined)
    .sort((a, b) => b.score - a.score || a.object.title.localeCompare(b.object.title));

  const items: RetrievedItem[] = focus
    ? [{ object: ref(focus), score: Infinity, reasons: ["focus"] }]
    : [];
  let tokens = focus ? estimateTokens(focus.title) : 0;
  let truncated = false;

  for (const r of ranked) {
    if (items.length >= budget.maxItems) {
      truncated = true;
      break;
    }
    const cost = estimateTokens(`${r.object.title} ${str(r.object.details, "detail") ?? ""}`);
    if (tokens + cost > budget.maxTokens) {
      truncated = true;
      break;
    }
    tokens += cost;
    items.push({ object: ref(r.object), score: r.score, reasons: [...r.reasons] });
  }

  return { citations: items.map((i) => i.object), items, truncated };
}

const TYPE_WORDS: Partial<Record<ObjectType, readonly string[]>> = {
  memory: ["memory", "memories"],
  project: ["project", "projects"],
  task: ["task", "tasks"],
  decision: ["decision", "decisions"],
  risk: ["risk", "risks"],
  note: ["note", "notes"],
  document: ["document", "documents"],
  location: ["location", "locations"],
  person: ["person", "people"],
  event: ["event", "events"],
};

function matchedType(query: string): ObjectType | null {
  const q = query.toLowerCase();
  for (const [type, words] of Object.entries(TYPE_WORDS)) {
    if (words?.some((w) => q.includes(w))) return type as ObjectType;
  }
  return null;
}
