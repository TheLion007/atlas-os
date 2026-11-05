import type {
  ActivityEntry,
  ApiEdge,
  ApiObject,
  AppSettings,
  ProgressEntry,
} from "@/domain/api-types";
import { EXAMPLE_TAG } from "@/domain/creation";
import { createEdgeSchema, createObjectSchema } from "@/domain/schemas";
import { seedId, type Seed } from "./seed-types";
import type { SeedProgress } from "./neutral-fr";

/** The illustrative seed as the API would return it: validated, with ids and timestamps. */
export interface FixtureData {
  today: string;
  nodes: ApiObject[];
  edges: ApiEdge[];
  activity: ActivityEntry[];
  /** The work journal: tasks finished, notes written, files added. */
  progress: ProgressEntry[];
  settings: AppSettings;
  /** Files the development file store starts with (the bytes behind seeded documents). */
  files?: { path: string; mime: string; text: string }[];
}

const DAY_MS = 86_400_000;

/**
 * Turns the seed into API-shaped data. Every object goes through the same Zod schema the API
 * uses, so the fixtures cannot drift from the real contract; a failure here is a bug in the seed.
 */
export function buildFixtureData(seed: Seed & { progress?: SeedProgress[] }): FixtureData {
  const now = new Date(`${seed.today}T09:00:00Z`).getTime();
  const type = new Map<string, ApiObject["type"]>();

  const nodes: ApiObject[] = seed.objects.map((o, i) => {
    const parsed = createObjectSchema.parse(o.input);
    type.set(o.key, parsed.type);
    // Older objects were created earlier; spread creation over the past two months.
    const created = new Date(now - (60 - Math.min(59, i)) * DAY_MS).toISOString();
    return {
      id: seedId(o.key),
      type: parsed.type,
      title: parsed.title,
      status: parsed.status,
      // Marked as example data, so it is never mistaken for (or mixed up with) the user's own.
      tags: [...parsed.tags, EXAMPLE_TAG],
      confidence: parsed.confidence,
      color: parsed.color,
      createdAt: created,
      updatedAt: created,
      details: parsed.details as Record<string, unknown>,
    };
  });

  const edges: ApiEdge[] = seed.edges.map((e, i) => {
    const parsed = createEdgeSchema.parse({
      kind: e.kind,
      from: seedId(e.from),
      to: seedId(e.to),
      label: e.label ?? null,
      dependencyType: e.dependencyType ?? null,
      lagDays: e.lagDays ?? null,
    });
    return {
      id: seedId(`edge:${i}:${e.kind}:${e.from}:${e.to}`),
      kind: parsed.kind,
      from: parsed.from,
      to: parsed.to,
      label: parsed.label,
      dependencyType: parsed.dependencyType,
      lagDays: parsed.lagDays,
      createdAt: new Date(now - 30 * DAY_MS).toISOString(),
    };
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const activity: ActivityEntry[] = seed.activity.map((a, i) => {
    const id = seedId(a.key);
    const node = byId.get(id);
    return {
      id: 1000 - i,
      action: a.action,
      at: new Date(now - a.hoursAgo * 3_600_000).toISOString(),
      objectId: id,
      edgeId: null,
      object: node ? { type: node.type, title: node.title } : null,
      diff: a.diff ?? {},
    };
  });

  const progress: ProgressEntry[] = (seed.progress ?? []).map((p, i) => {
    const at = new Date(now - p.daysAgo * DAY_MS - ((i * 7919) % 36_000) * 1000);
    return {
      id: 5000 - i,
      at: at.toISOString(),
      day: at.toISOString().slice(0, 10),
      projectId: seedId(p.project),
      objectId: p.key ? seedId(p.key) : null,
      kind: p.kind,
    };
  });

  const files = seed.files ?? [];
  return { today: seed.today, nodes, edges, activity, progress, settings: seed.settings, files };
}

/** A workspace with nothing in it: what a new user starts from. */
export function emptyFixtureData(seed: Seed): FixtureData {
  return {
    today: seed.today,
    nodes: [],
    edges: [],
    activity: [],
    progress: [],
    settings: { ...seed.settings, baseCurrency: null, fxRates: [] },
  };
}
