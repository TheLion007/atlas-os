import type { ApiEdge, ApiObject } from "./api-types";
import type { ChipRef } from "./command-center";
import {
  CycleError,
  computeBlocked,
  isBlockable,
  computeSchedule,
  riskLevel,
  rollUpProgress,
} from "./engine";
import type { ProgressResult, RiskLevel } from "./engine";

/**
 * The derived facts about one object: the values the blueprint says must be computed, never
 * stored. Shown beside an object's own fields so the two are never confused.
 */
export interface ObjectFacts {
  /** Projects and sub-projects: weighted-effort progress. `null` progress means no data. */
  progress: ProgressResult | null;
  /** Risks: from probability × impact. */
  riskLevel: RiskLevel | null;
  /** Tasks and milestones: the date after dependency propagation. */
  schedule: {
    date: string | null;
    plannedDate: string | null;
    slipDays: number | null;
    drivenBy: ChipRef | null;
  } | null;
  blockedBy: ChipRef[];
  broken: ChipRef[];
}

const num = (d: Record<string, unknown> | undefined, k: string): number | null => {
  const v = d?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const str = (d: Record<string, unknown> | undefined, k: string): string | null => {
  const v = d?.[k];
  return typeof v === "string" && v !== "" ? v : null;
};
const ref = (n: ApiObject): ChipRef => ({ id: n.id, type: n.type, title: n.title });

export function deriveFacts(
  id: string,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): ObjectFacts | null {
  const node = nodes.find((n) => n.id === id);
  if (!node) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const empty: ObjectFacts = {
    progress: null,
    riskLevel: null,
    schedule: null,
    blockedBy: [],
    broken: [],
  };

  const facts = { ...empty };

  if (node.type === "project" || node.type === "sub_project") {
    facts.progress =
      rollUpProgress(
        nodes.map((n) => ({
          id: n.id,
          type: n.type,
          status: n.status,
          effort: num(n.details, "effort"),
        })),
        edges,
      ).get(id) ?? null;
  }

  if (node.type === "risk") {
    const p = num(node.details, "probability");
    const i = num(node.details, "impact");
    if (p !== null && i !== null) facts.riskLevel = riskLevel(p, i);
  }

  if (node.type === "task" || node.type === "milestone") {
    const scheduleNodes = nodes
      .filter((n) => n.type === "milestone" || n.type === "task")
      .map((n) => ({
        id: n.id,
        date: n.type === "milestone" ? str(n.details, "date") : str(n.details, "due"),
        baselineDate: n.type === "milestone" ? str(n.details, "baselineDate") : null,
      }));
    let s;
    try {
      s = computeSchedule(scheduleNodes, edges).get(id);
    } catch (e) {
      if (!(e instanceof CycleError)) throw e;
    }
    if (s) {
      const driver = s.drivenBy ? byId.get(s.drivenBy) : undefined;
      facts.schedule = {
        date: s.scheduledDate,
        plannedDate: s.plannedDate,
        slipDays: s.slipDays,
        drivenBy: driver ? ref(driver) : null,
      };
    }
  }

  const blocked = computeBlocked(
    nodes.filter((n) => isBlockable(n.type)).map((n) => ({ id: n.id, status: n.status })),
    edges,
  ).get(id);
  if (blocked) {
    const named = (ids: string[]) =>
      ids.flatMap((x) => {
        const n = byId.get(x);
        return n ? [ref(n)] : [];
      });
    facts.blockedBy = named(blocked.blockedBy);
    facts.broken = named(blocked.broken);
  }
  return facts;
}
