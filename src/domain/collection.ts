import type { ApiEdge, ApiObject } from "./api-types";
import { isExample } from "./creation";
import { computeBlocked, isBlockable, riskLevel, rollUpProgress } from "./engine";
import type { RiskLevel } from "./engine";
import type { LifecycleStatus, ObjectType } from "./enums";

/**
 * The rows of a collection page (all projects, all tasks, ...), derived from the shared graph.
 * Derived values (progress, blocked, risk level) come from the pure engine and are never stored;
 * a collection is only a projection, not a second data model.
 */
export interface CollectionRow {
  id: string;
  type: ObjectType;
  title: string;
  status: LifecycleStatus;
  example: boolean;
  blocked: boolean;
  updatedAt: string;
  /** Projects: derived progress (`null` = no data, never 0). */
  progress: number | null;
  /** The date that matters for the type: target, due or decide-by. */
  date: string | null;
  /** What it belongs to: a task's project, a note's subject. */
  parent: { id: string; type: ObjectType; title: string } | null;
  /** Risks. */
  risk: { probability: number; impact: number; level: RiskLevel } | null;
}

const str = (d: Record<string, unknown> | undefined, k: string): string | null => {
  const v = d?.[k];
  return typeof v === "string" && v !== "" ? v : null;
};
const num = (d: Record<string, unknown> | undefined, k: string): number | null => {
  const v = d?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const DATE_KEY: Partial<Record<ObjectType, string>> = {
  project: "targetDate",
  sub_project: "targetDate",
  task: "due",
  milestone: "date",
  decision: "deadline",
};

export function buildCollection(
  type: ObjectType,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): CollectionRow[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const projectish = type === "project" || type === "sub_project";
  const progress = projectish
    ? rollUpProgress(
        nodes.map((n) => ({
          id: n.id,
          type: n.type,
          status: n.status,
          effort: num(n.details, "effort"),
        })),
        edges,
      )
    : null;
  const blocked = computeBlocked(
    nodes.filter((n) => isBlockable(n.type)).map((n) => ({ id: n.id, status: n.status })),
    edges,
  );

  // What each object belongs to: its container, or the object a note/person references.
  const parentOf = (id: string): CollectionRow["parent"] => {
    for (const e of edges) {
      const isContainer = e.kind === "contains" && e.to === id;
      const isSubject = e.kind === "references" && e.from === id;
      if (!isContainer && !isSubject) continue;
      const other = byId.get(isContainer ? e.from : e.to);
      if (other) return { id: other.id, type: other.type, title: other.title };
    }
    return null;
  };

  return nodes
    .filter((n) => n.type === type)
    .map((n): CollectionRow => {
      const p = num(n.details, "probability");
      const i = num(n.details, "impact");
      const dateKey = DATE_KEY[type];
      return {
        id: n.id,
        type: n.type,
        title: n.title,
        status: n.status,
        example: isExample(n),
        blocked: (blocked.get(n.id)?.blockedBy.length ?? 0) > 0,
        updatedAt: n.updatedAt,
        progress: progress ? (progress.get(n.id)?.progress ?? null) : null,
        date: dateKey ? str(n.details, dateKey) : null,
        parent: parentOf(n.id),
        risk:
          p !== null && i !== null ? { probability: p, impact: i, level: riskLevel(p, i) } : null,
      };
    });
}

const STATUS_ORDER: Record<LifecycleStatus, number> = { active: 0, draft: 1, done: 2, dropped: 3 };

/** Sensible default order: open work first; dated things by date; risks by severity. */
export function sortCollection(rows: readonly CollectionRow[]): CollectionRow[] {
  return [...rows].sort((a, b) => {
    if (
      a.risk &&
      b.risk &&
      a.risk.probability * a.risk.impact !== b.risk.probability * b.risk.impact
    )
      return b.risk.probability * b.risk.impact - a.risk.probability * a.risk.impact;
    return (
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      // Dated items soonest first; undated last.
      Number(a.date === null) - Number(b.date === null) ||
      (a.date ?? "").localeCompare(b.date ?? "") ||
      a.title.localeCompare(b.title)
    );
  });
}

export function filterCollection(
  rows: readonly CollectionRow[],
  opts: { query?: string; status?: LifecycleStatus | "all" },
): CollectionRow[] {
  const q = (opts.query ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  return rows.filter(
    (r) =>
      (opts.status === undefined || opts.status === "all" || r.status === opts.status) &&
      (q === "" || r.title.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().includes(q)),
  );
}
