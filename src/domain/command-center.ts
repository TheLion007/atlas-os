import type { ApiEdge, ApiObject, FxRate } from "./api-types";
import { addDays, diffDays } from "./dates";
import {
  CURRENCY_UNITS,
  type EstimateUnit,
  type LifecycleStatus,
  type ObjectType,
  type ScenarioVariant,
} from "./enums";
import {
  CycleError,
  computeBlocked,
  isBlockable,
  computeSchedule,
  riskLevel,
  rollUpProgress,
} from "./engine";
import type { RiskLevel } from "./engine";
import { sumInBase } from "./money";

/**
 * The Command Center's view-model: everything the overview answers, derived from the shared
 * dataset by the same pure engine every other lens uses. Nothing here is stored. It answers the
 * blueprint's five questions: where am I, what is moving, what is blocked, what is next, and
 * what does this cost me.
 */

export interface CommandCenterInput {
  /** The calendar date "today" (injected: the domain never reads the clock). */
  today: string;
  scenario: ScenarioVariant;
  baseCurrency: string | null;
  fxRates: readonly FxRate[];
  nodes: readonly ApiObject[];
  edges: readonly ApiEdge[];
}

export interface ChipRef {
  id: string;
  type: ObjectType;
  title: string;
}

export interface DatedItem extends ChipRef {
  status: LifecycleStatus;
  /** Date after dependency propagation. */
  date: string | null;
  plannedDate: string | null;
  slipDays: number | null;
  drivenBy: ChipRef | null;
  overdue: boolean;
  daysFromToday: number | null;
  /** Derived: waits on an unfinished predecessor. */
  blocked: boolean;
}

export interface CapitalSummary {
  /** `false` until the owner has chosen a base currency: there is no default. */
  hasBaseCurrency: boolean;
  baseCurrency: string | null;
  actual: number | null;
  target: number | null;
  /** actual ÷ target, or null when either is missing. */
  ratio: number | null;
  /** Estimates left out because no FX rate connects them to the base currency. */
  unconverted: { id: string; title: string; amount: number; currency: string }[];
}

export interface ProjectSummary extends ChipRef {
  progress: number | null;
  doneEffort: number;
  totalEffort: number;
  targetDate: string | null;
  priority: number | null;
  blocked: boolean;
  /** The plan this project belongs to, if any (`contains`, plan → project). */
  plan: ChipRef | null;
  /** Live sub-projects nested inside this project, recursively (a sub-project may itself
   *  contain sub-projects). Never includes tasks/milestones/etc. */
  subProjects: ProjectSummary[];
}

/** A programme grouping several standalone projects (`contains`, plan → project). */
export interface PlanSummary extends ChipRef {
  projects: ProjectSummary[];
}

export interface BlockedSummary extends ChipRef {
  blockedBy: ChipRef[];
  broken: ChipRef[];
}

export interface RiskSummary extends ChipRef {
  probability: number;
  impact: number;
  level: RiskLevel;
}

export interface DecisionSummary extends ChipRef {
  deadline: string | null;
  overdue: boolean;
  daysLeft: number | null;
}

export interface CommandCenterModel {
  isEmpty: boolean;
  /** Ids are catalogue keys (`cc.check.<id>`): the words are the interface's to translate. */
  checklist: { id: ChecklistId; done: boolean }[];
  capital: CapitalSummary;
  focus: DatedItem[];
  next90: DatedItem[];
  projects: ProjectSummary[];
  /** Projects grouped by the plan they belong to; a project also stays in `projects` unfiltered. */
  plans: PlanSummary[];
  blocked: BlockedSummary[];
  risks: RiskSummary[];
  decisions: DecisionSummary[];
}

export type ChecklistId = "currency" | "project" | "place" | "milestone" | "estimate";

export const FOCUS_COUNT = 3;
export const HORIZON_DAYS = 90;

const LIVE: readonly LifecycleStatus[] = ["draft", "active"];
const isLive = (s: LifecycleStatus): boolean => LIVE.includes(s);

const str = (d: Record<string, unknown> | undefined, key: string): string | null => {
  const v = d?.[key];
  return typeof v === "string" && v !== "" ? v : null;
};
const num = (d: Record<string, unknown> | undefined, key: string): number | null => {
  const v = d?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const ref = (n: ApiObject): ChipRef => ({ id: n.id, type: n.type, title: n.title });

/** An estimate applies to the active scenario unless it belongs to a different one. */
export function estimateApplies(
  estimate: ApiObject,
  active: ScenarioVariant,
  variantByScenarioId: ReadonlyMap<string, ScenarioVariant>,
): boolean {
  const scenarioId = str(estimate.details, "scenarioId");
  if (scenarioId === null) return true;
  return variantByScenarioId.get(scenarioId) === active;
}

function summariseCapital(input: CommandCenterInput, byVariant: Map<string, ScenarioVariant>) {
  const hasBase = input.baseCurrency !== null;
  const empty: CapitalSummary = {
    hasBaseCurrency: hasBase,
    baseCurrency: input.baseCurrency,
    actual: null,
    target: null,
    ratio: null,
    unconverted: [],
  };
  if (!hasBase) return empty;

  const capital = input.nodes.filter(
    (n) =>
      n.type === "estimate" &&
      n.status !== "dropped" &&
      n.status !== "draft" &&
      str(n.details, "category") === "capital" &&
      CURRENCY_UNITS.includes(str(n.details, "unit") as EstimateUnit) &&
      estimateApplies(n, input.scenario, byVariant),
  );

  const collect = (kind: string) => {
    const items = capital
      .filter((n) => str(n.details, "dataKind") === kind)
      .map((n) => ({
        id: n.id,
        label: n.title,
        amount: num(n.details, "amount") ?? 0,
        currency: str(n.details, "currency") ?? input.baseCurrency ?? "",
      }));
    const sum = sumInBase(items, input.baseCurrency as string, input.fxRates);
    return { present: items.length > 0, total: sum.total, unconverted: sum.unconverted, items };
  };

  const actual = collect("actual");
  const target = collect("target");
  const unconverted = [...actual.unconverted, ...target.unconverted].map((u) => {
    const source = capital.find((n) => n.title === u.label);
    return { id: source?.id ?? u.label, title: u.label, amount: u.amount, currency: u.currency };
  });
  const a = actual.present ? actual.total : null;
  const t = target.present ? target.total : null;
  return {
    ...empty,
    actual: a,
    target: t,
    ratio: a !== null && t !== null && t > 0 ? a / t : null,
    unconverted,
  };
}

export function buildCommandCenter(input: CommandCenterInput): CommandCenterModel {
  const { nodes, edges, today } = input;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const title = (id: string): ChipRef | null => {
    const n = byId.get(id);
    return n ? ref(n) : null;
  };

  const variantById = new Map<string, ScenarioVariant>();
  for (const n of nodes)
    if (n.type === "scenario") {
      const v = str(n.details, "variant");
      if (v) variantById.set(n.id, v as ScenarioVariant);
    }

  // ── Derived values, all from the shared engine ────────────────────────────────────────────
  const progress = rollUpProgress(
    nodes.map((n) => ({
      id: n.id,
      type: n.type,
      status: n.status,
      effort: num(n.details, "effort"),
    })),
    edges,
  );
  const blockedMap = computeBlocked(
    nodes.filter((n) => isBlockable(n.type)).map((n) => ({ id: n.id, status: n.status })),
    edges,
  );

  const scheduleNodes = nodes
    .filter((n) => n.type === "milestone" || n.type === "task")
    .map((n) => ({
      id: n.id,
      date: n.type === "milestone" ? str(n.details, "date") : str(n.details, "due"),
      baselineDate: n.type === "milestone" ? str(n.details, "baselineDate") : null,
    }));
  let schedule: ReturnType<typeof computeSchedule>;
  try {
    schedule = computeSchedule(scheduleNodes, edges);
  } catch (e) {
    if (!(e instanceof CycleError)) throw e;
    schedule = computeSchedule(scheduleNodes, []); // a cycle cannot exist in stored data; degrade safely
  }

  const dated = (n: ApiObject): DatedItem => {
    const s = schedule.get(n.id);
    const date = s?.scheduledDate ?? null;
    return {
      ...ref(n),
      status: n.status,
      date,
      plannedDate: s?.plannedDate ?? null,
      slipDays: s?.slipDays ?? null,
      drivenBy: s?.drivenBy ? title(s.drivenBy) : null,
      overdue: date !== null && isLive(n.status) && date < today,
      daysFromToday: date !== null ? diffDays(today, date) : null,
      blocked: blockedMap.has(n.id),
    };
  };

  // ── Where am I: capital ───────────────────────────────────────────────────────────────────
  const capital = summariseCapital(input, variantById);

  // ── What is next: focus and the next 90 days ──────────────────────────────────────────────
  const actionable = nodes
    .filter((n) => (n.type === "task" || n.type === "milestone") && isLive(n.status))
    .map(dated);
  const byDate = (a: DatedItem, b: DatedItem) =>
    a.date === null && b.date === null
      ? a.title.localeCompare(b.title)
      : a.date === null
        ? 1
        : b.date === null
          ? -1
          : a.date < b.date
            ? -1
            : a.date > b.date
              ? 1
              : a.title.localeCompare(b.title);

  const focus = actionable
    .filter((i) => !blockedMap.has(i.id))
    .sort(byDate)
    .slice(0, FOCUS_COUNT);
  const horizon = addDays(today, HORIZON_DAYS);
  const next90 = actionable
    .filter((i) => i.date !== null && i.date >= today && i.date <= horizon)
    .sort(byDate);

  // ── What is moving: projects, plans and sub-projects ──────────────────────────────────────
  const containsChildren = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind !== "contains") continue;
    const list = containsChildren.get(e.from);
    if (list) list.push(e.to);
    else containsChildren.set(e.from, [e.to]);
  }
  const planOf = new Map<string, ApiObject>();
  for (const e of edges) {
    if (e.kind !== "contains") continue;
    const from = byId.get(e.from);
    if (from?.type === "plan") planOf.set(e.to, from);
  }
  const byPriorityThenTitle = (a: ProjectSummary, b: ProjectSummary) =>
    (a.priority ?? 9) - (b.priority ?? 9) || a.title.localeCompare(b.title);

  const summariseProject = (n: ApiObject): ProjectSummary => {
    const p = progress.get(n.id);
    const subProjects = (containsChildren.get(n.id) ?? [])
      .map((id) => byId.get(id))
      .filter(
        (c): c is ApiObject => c !== undefined && c.type === "sub_project" && isLive(c.status),
      )
      .map(summariseProject)
      .sort(byPriorityThenTitle);
    return {
      ...ref(n),
      progress: p?.progress ?? null,
      doneEffort: p?.doneEffort ?? 0,
      totalEffort: p?.totalEffort ?? 0,
      targetDate: str(n.details, "targetDate"),
      priority: num(n.details, "priority"),
      blocked: blockedMap.has(n.id),
      plan:
        n.type === "project"
          ? planOf.has(n.id)
            ? ref(planOf.get(n.id) as ApiObject)
            : null
          : null,
      subProjects,
    };
  };

  const projects: ProjectSummary[] = nodes
    .filter((n) => n.type === "project" && isLive(n.status))
    .map(summariseProject)
    .sort(byPriorityThenTitle);

  const plans: PlanSummary[] = nodes
    .filter((n) => n.type === "plan" && isLive(n.status))
    .map((n) => ({
      ...ref(n),
      projects: projects.filter((p) => p.plan?.id === n.id),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));

  // ── What is blocked ───────────────────────────────────────────────────────────────────────
  const blocked: BlockedSummary[] = [...blockedMap.entries()]
    .map(([id, info]) => {
      const n = byId.get(id);
      if (!n) return null;
      return {
        ...ref(n),
        blockedBy: info.blockedBy.map(title).filter((x): x is ChipRef => x !== null),
        broken: info.broken.map(title).filter((x): x is ChipRef => x !== null),
      };
    })
    .filter((x): x is BlockedSummary => x !== null)
    .sort((a, b) => a.title.localeCompare(b.title));

  // ── Risks and decisions ───────────────────────────────────────────────────────────────────
  const risks: RiskSummary[] = nodes
    .filter((n) => n.type === "risk" && isLive(n.status))
    .flatMap((n) => {
      const probability = num(n.details, "probability");
      const impact = num(n.details, "impact");
      if (probability === null || impact === null) return [];
      return [{ ...ref(n), probability, impact, level: riskLevel(probability, impact) }];
    })
    .sort(
      (a, b) =>
        b.probability * b.impact - a.probability * a.impact || a.title.localeCompare(b.title),
    );

  const decisions: DecisionSummary[] = nodes
    .filter((n) => n.type === "decision" && isLive(n.status))
    .map((n) => {
      const deadline = str(n.details, "deadline");
      return {
        ...ref(n),
        deadline,
        overdue: deadline !== null && deadline < today,
        daysLeft: deadline !== null ? diffDays(today, deadline) : null,
      };
    })
    .sort((a, b) =>
      a.deadline === null && b.deadline === null
        ? a.title.localeCompare(b.title)
        : a.deadline === null
          ? 1
          : b.deadline === null
            ? -1
            : a.deadline.localeCompare(b.deadline),
    );

  // ── Empty-state checklist: done-ness is derived from the data ────────────────────────────
  const has = (type: ObjectType) => nodes.some((n) => n.type === type);
  const checklist = [
    { id: "currency", done: input.baseCurrency !== null },
    { id: "project", done: has("project") },
    { id: "place", done: edges.some((e) => e.kind === "located_at") },
    {
      id: "milestone",
      done: nodes.some((n) => n.type === "milestone" && str(n.details, "date") !== null),
    },
    { id: "estimate", done: has("estimate") },
  ] satisfies { id: ChecklistId; done: boolean }[];

  return {
    isEmpty: nodes.length === 0,
    checklist,
    capital,
    focus,
    next90,
    projects,
    plans,
    blocked,
    risks,
    decisions,
  };
}
