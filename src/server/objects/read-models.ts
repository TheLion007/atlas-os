import type {
  ActivityEntry,
  ProgressEntry,
  ApiEdge,
  ApiObject,
  AppSettings,
  FxRate,
  GraphPayload,
} from "@/domain/api-types";
import type { LifecycleStatus, ObjectType, ScenarioVariant } from "@/domain/enums";
import { asOwner, type Db } from "../db/types";
import { mapDbError } from "../errors";
import { DETAIL_TABLE, detailsFromRow, iso } from "./mapping";

/**
 * Read models for the lenses. They return the shared dataset in one piece so the client can run
 * the pure engine over it (progress, blocked, schedule) instead of the server precomputing and
 * storing derived values.
 */

/** A personal dataset is small; this cap exists to fail loudly, not to paginate. */
export const GRAPH_NODE_LIMIT = 5000;

interface NodeRow {
  id: string;
  type: ObjectType;
  title: string;
  status: LifecycleStatus;
  tags: string[];
  confidence: number | null;
  color: string | null;
  created_at: unknown;
  updated_at: unknown;
  [key: string]: unknown;
}

/** Every live object and every live relation. With `details`, each node carries its fields. */
export async function getGraph(
  db: Db,
  owner: string,
  opts: { details?: boolean } = {},
): Promise<GraphPayload> {
  try {
    return await asOwner(db, owner, async (tx) => {
      const rows = await tx.query<NodeRow>(
        `select id, type, title, status, tags, confidence, color, created_at, updated_at
         from public.objects where deleted_at is null
         order by created_at, id limit ${GRAPH_NODE_LIMIT}`,
      );
      const nodes: ApiObject[] = rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        status: r.status,
        tags: r.tags,
        confidence: r.confidence,
        color: r.color,
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
      }));

      if (opts.details) {
        const byId = new Map(nodes.map((n) => [n.id, n]));
        // One query per detail table (project and sub_project share one).
        for (const table of new Set(Object.values(DETAIL_TABLE))) {
          const detail = await tx.query<{ d: Record<string, unknown> }>(
            `select to_jsonb(d) as d from public.${table} d
             join public.objects o on o.id = d.id where o.deleted_at is null`,
          );
          for (const { d } of detail) {
            const node = byId.get(d.id as string);
            if (node) node.details = detailsFromRow(d);
          }
        }
      }

      const edgeRows = await tx.query<{
        id: string;
        kind: ApiEdge["kind"];
        from_id: string;
        to_id: string;
        label: string | null;
        dependency_type: string | null;
        lag_days: number | null;
        created_at: unknown;
      }>(
        `select e.id, e.kind, e.from_id, e.to_id, e.label, e.dependency_type, e.lag_days, e.created_at
         from public.edges e
         join public.objects f on f.id = e.from_id and f.deleted_at is null
         join public.objects t on t.id = e.to_id and t.deleted_at is null
         where e.deleted_at is null order by e.created_at, e.id`,
      );
      const edges: ApiEdge[] = edgeRows.map((e) => ({
        id: e.id,
        kind: e.kind,
        from: e.from_id,
        to: e.to_id,
        label: e.label,
        dependencyType: e.dependency_type,
        lagDays: e.lag_days,
        createdAt: iso(e.created_at),
      }));
      return { nodes, edges };
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

/** What changed recently, newest first. Entries survive the purge of their object. */
export async function getActivity(db: Db, owner: string, limit = 30): Promise<ActivityEntry[]> {
  const capped = Math.min(Math.max(1, Math.trunc(limit)), 200);
  try {
    return await asOwner(db, owner, async (tx) => {
      const rows = await tx.query<{
        id: number | string;
        action: ActivityEntry["action"];
        at: unknown;
        object_id: string | null;
        edge_id: string | null;
        diff: Record<string, unknown>;
        type: ObjectType | null;
        title: string | null;
      }>(
        `select a.id, a.action, a.at, a.object_id, a.edge_id, a.diff, o.type, o.title
         from public.activity_log a
         left join public.objects o on o.id = a.object_id
         order by a.id desc limit $1`,
        [capped],
      );
      return rows.map((r) => ({
        id: Number(r.id),
        action: r.action,
        at: iso(r.at),
        objectId: r.object_id,
        edgeId: r.edge_id,
        object: r.type && r.title ? { type: r.type, title: r.title } : null,
        diff: r.diff,
      }));
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

/** The work journal for the last `days` days, newest first. */
export async function getProgress(db: Db, owner: string, days = 120): Promise<ProgressEntry[]> {
  const capped = Math.min(Math.max(1, Math.trunc(days)), 800);
  try {
    return await asOwner(db, owner, async (tx) => {
      const rows = await tx.query<{
        id: number | string;
        at: unknown;
        day: unknown;
        project_id: string | null;
        object_id: string | null;
        kind: ProgressEntry["kind"];
      }>(
        `select id, at, day::text as day,
                coalesce(project_id, case when object_id is null then null
                  else public.progress_project_for(object_id) end) as project_id,
                object_id, kind
         from public.progress_log
         where day >= (now() at time zone 'utc')::date - $1::int
           -- what was deleted leaves the journal at once (and comes back if it is restored)
           and (object_id is null or exists (
             select 1 from public.objects o
              where o.id = progress_log.object_id and o.deleted_at is null))
         order by id desc`,
        [capped],
      );
      return rows.map((r) => ({
        id: Number(r.id),
        at: iso(r.at),
        day: String(r.day).slice(0, 10),
        projectId: r.project_id,
        objectId: r.object_id,
        kind: r.kind,
      }));
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

/** The owner's settings. With no row yet there is no base currency: nothing is assumed. */
export async function getSettings(db: Db, owner: string): Promise<AppSettings> {
  try {
    return await asOwner(db, owner, async (tx) => {
      const settings = await tx.query<{
        base_currency: string;
        active_scenario: ScenarioVariant;
        timeline_start: string | null;
        timeline_end: string | null;
      }>(
        "select base_currency, active_scenario, timeline_start::text, timeline_end::text from public.app_settings limit 1",
      );
      const fx = await tx.query<{
        from_ccy: string;
        to_ccy: string;
        rate: number | string;
        as_of: string;
        source: string;
      }>(
        "select from_ccy, to_ccy, rate::float8 as rate, as_of::text, source from public.fx_rates order by as_of desc, from_ccy, to_ccy",
      );
      const s = settings[0];
      const fxRates: FxRate[] = fx.map((r) => ({
        from: r.from_ccy,
        to: r.to_ccy,
        rate: Number(r.rate),
        asOf: r.as_of,
        source: r.source,
      }));
      return {
        baseCurrency: s?.base_currency ?? null,
        activeScenario: s?.active_scenario ?? "base",
        timelineStart: s?.timeline_start ?? null,
        timelineEnd: s?.timeline_end ?? null,
        fxRates,
      };
    });
  } catch (e) {
    throw mapDbError(e);
  }
}
