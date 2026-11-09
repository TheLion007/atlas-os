import type { PGlite } from "@electric-sql/pglite";
import type { ProgressFn } from "./export";

/**
 * Merging a backup into the open database: what is missing is added; when the same item (same id)
 * exists on both sides, the more recently changed one wins. Nothing present is deleted, and the
 * whole merge is one transaction: if anything fails, nothing at all has changed.
 */

export interface MergeSummary {
  /** Items (any kind) added, and replaced by a newer version from the backup. */
  itemsAdded: number;
  itemsUpdated: number;
  /** Items already there and at least as recent: left as they are. */
  itemsKept: number;
  linksAdded: number;
  linksSkipped: number;
  historyAdded: number;
  filesAdded: number;
  /** Rows that could not be merged (for example a link to something that is not there). */
  skipped: number;
}

interface TableInfo {
  name: string;
  columns: string[]; // writable columns
  pk: string[];
  updatedAt: boolean;
}

const SKIP = new Set(["activity_log", "applied_migrations", "edge_rules", "progress_log"]);
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function describeTables(pg: Pick<PGlite, "query">): Promise<TableInfo[]> {
  const cols = await pg.query<{
    table_name: string;
    column_name: string;
    is_generated: string;
    is_identity: string;
  }>(
    `select c.table_name, c.column_name, c.is_generated, c.is_identity
       from information_schema.columns c
       join information_schema.tables t
         on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      order by c.table_name, c.ordinal_position`,
  );
  const pks = await pg.query<{ table_name: string; column_name: string }>(
    `select cl.relname as table_name, a.attname as column_name
       from pg_index i
       join pg_class cl on cl.oid = i.indrelid
       join pg_namespace n on n.oid = cl.relnamespace
       join pg_attribute a on a.attrelid = cl.oid and a.attnum = any (i.indkey)
      where i.indisprimary and n.nspname = 'public'
      order by cl.relname, array_position(i.indkey::int2[], a.attnum)`,
  );
  const byTable = new Map<string, TableInfo>();
  for (const c of cols.rows) {
    if (SKIP.has(c.table_name)) continue;
    const t = byTable.get(c.table_name) ?? {
      name: c.table_name,
      columns: [],
      pk: [],
      updatedAt: false,
    };
    if (c.is_generated === "ALWAYS" || c.is_identity === "YES") continue;
    t.columns.push(c.column_name);
    if (c.column_name === "updated_at") t.updatedAt = true;
    byTable.set(c.table_name, t);
  }
  for (const p of pks.rows) byTable.get(p.table_name)?.pk.push(p.column_name);
  return [...byTable.values()].filter((t) => t.pk.length > 0);
}

/** Tables in an order where what a table points at comes first (foreign keys). */
async function inDependencyOrder(
  pg: Pick<PGlite, "query">,
  tables: TableInfo[],
): Promise<TableInfo[]> {
  const fks = await pg.query<{ child: string; parent: string }>(
    `select c.relname as child, p.relname as parent
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_class p on p.oid = k.confrelid
       join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'f' and n.nspname = 'public' and c.oid <> p.oid`,
  );
  const names = new Set(tables.map((t) => t.name));
  const deps = new Map<string, Set<string>>();
  for (const t of tables) deps.set(t.name, new Set());
  for (const f of fks.rows)
    if (names.has(f.child) && names.has(f.parent)) deps.get(f.child)!.add(f.parent);
  const out: TableInfo[] = [];
  const done = new Set<string>();
  const visit = (n: string, stack: Set<string>) => {
    if (done.has(n) || stack.has(n)) return;
    stack.add(n);
    for (const d of deps.get(n) ?? []) visit(d, stack);
    stack.delete(n);
    done.add(n);
    out.push(tables.find((t) => t.name === n)!);
  };
  for (const t of tables) visit(t.name, new Set());
  return out;
}

export async function mergeBackup(
  live: PGlite,
  backup: PGlite,
  progress: ProgressFn = () => undefined,
): Promise<MergeSummary> {
  const sum: MergeSummary = {
    itemsAdded: 0,
    itemsUpdated: 0,
    itemsKept: 0,
    linksAdded: 0,
    linksSkipped: 0,
    historyAdded: 0,
    filesAdded: 0,
    skipped: 0,
  };
  const tables = await inDependencyOrder(backup, await describeTables(backup));
  // only columns both sides have (a backup of an older version may lack some)
  const liveCols = await describeTables(live);
  const liveByName = new Map(liveCols.map((t) => [t.name, t]));

  await live.transaction(async (tx) => {
    // the app's own triggers (activity log, work journal, updated_at stamps, cascades) would
    // rewrite what is being merged: they are paused for the merge, never the checks of the model
    const triggers = await tx.query<{ rel: string; tg: string }>(
      `select c.relname as rel, t.tgname as tg
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_proc p on p.oid = t.tgfoid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal
          and p.proname in ('log_activity', 'log_progress', 'set_updated_at', 'cascade_object_soft_delete')`,
    );
    for (const t of triggers.rows)
      await tx.exec(`alter table public.${q(t.rel)} disable trigger ${q(t.tg)}`);

    const attempt = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      await tx.exec("savepoint merge_row");
      try {
        const r = await fn();
        await tx.exec("release savepoint merge_row");
        return r;
      } catch {
        await tx.exec("rollback to savepoint merge_row");
        await tx.exec("release savepoint merge_row");
        sum.skipped += 1;
        return undefined;
      }
    };

    const takenObjects = new Set<string>();
    let step = 0;
    for (const t of tables) {
      progress("merge", 20 + Math.round((step++ / Math.max(1, tables.length)) * 70));
      const l = liveByName.get(t.name);
      if (!l) continue;
      const cols = t.columns.filter((c) => l.columns.includes(c));
      const keys = await backup.query<Record<string, unknown>>(
        `select ${t.pk.map((c) => `${q(c)}::text as ${q(c)}`).join(", ")}${t.updatedAt ? ", updated_at::text as updated_at" : ""}
           from public.${q(t.name)} order by ${t.pk.map(q).join(", ")}`,
      );
      const isDetails = t.name.endsWith("_details") && t.pk.length === 1 && t.pk[0] === "id";
      type Todo = { action: "insert" | "update"; pkVals: string[]; row: string };
      const todo: Todo[] = [];
      for (const k of keys.rows) {
        const pkVals = t.pk.map((c) => k[c] as string);
        const mine = await tx.query<{ updated: string | null }>(
          `select ${l.updatedAt ? "updated_at::text" : "null"} as updated
             from public.${q(t.name)} x where ${t.pk.map((c, i) => `x.${q(c)}::text = $${i + 1}`).join(" and ")}`,
          pkVals,
        );
        const exists = mine.rows.length > 0;
        let action: "insert" | "update" | "keep";
        if (!exists) action = "insert";
        else if (isDetails) action = takenObjects.has(pkVals[0]!) ? "update" : "keep";
        else if (t.updatedAt && l.updatedAt && k.updated_at && mine.rows[0]!.updated)
          action =
            new Date(k.updated_at as string) > new Date(mine.rows[0]!.updated) ? "update" : "keep";
        else action = "keep";
        if (action === "keep") {
          if (t.name === "objects") sum.itemsKept += 1;
          continue;
        }
        const row = (
          await backup.query<{ j: string }>(
            `select to_json(x)::text as j from public.${q(t.name)} x where ${t.pk.map((c, i) => `x.${q(c)}::text = $${i + 1}`).join(" and ")}`,
            pkVals,
          )
        ).rows[0]!.j;
        todo.push({ action, pkVals, row });
      }
      const colList = cols.map(q).join(", ");
      // changes first, then additions: a link that moved to a new parent frees the old parent's
      // slot before the new link needs it
      for (const w of [
        ...todo.filter((x) => x.action === "update"),
        ...todo.filter((x) => x.action === "insert"),
      ]) {
        const { pkVals, row } = w;
        if (w.action === "insert") {
          const r = await attempt(async () =>
            tx.query(
              `insert into public.${q(t.name)} (${colList})
               select ${cols.map((c) => `r.${q(c)}`).join(", ")}
                 from json_populate_record(null::public.${q(t.name)}, $1::json) r
               on conflict do nothing returning 1`,
              [row],
            ),
          );
          const added = (r as { rows: unknown[] } | undefined)?.rows.length ?? 0;
          if (added === 0) continue;
          if (t.name === "objects") {
            sum.itemsAdded += 1;
            takenObjects.add(pkVals[0]!);
          } else if (t.name === "edges") sum.linksAdded += 1;
          else if (t.name === "document_files") sum.filesAdded += 1;
        } else {
          const sets = cols.filter((c) => !t.pk.includes(c)).map((c) => `${q(c)} = r.${q(c)}`);
          if (sets.length === 0) continue;
          const r = await attempt(async () =>
            tx.query(
              `update public.${q(t.name)} x set ${sets.join(", ")}
                 from json_populate_record(null::public.${q(t.name)}, $1::json) r
                where ${t.pk.map((c) => `x.${q(c)} = r.${q(c)}`).join(" and ")} returning 1`,
              [row],
            ),
          );
          if ((r as { rows: unknown[] } | undefined)?.rows.length && t.name === "objects") {
            sum.itemsUpdated += 1;
            takenObjects.add(pkVals[0]!);
          }
        }
      }
    }
    sum.linksSkipped = sum.skipped;

    // the work history (the squares): add the entries that are not there yet
    progress("merge", 92);
    const hist = await backup.query<{ j: string }>(
      "select to_json(p)::text as j from public.progress_log p",
    );
    for (const h of hist.rows) {
      const r = await attempt(async () =>
        tx.query(
          `insert into public.progress_log (at, day, project_id, object_id, kind, owner_id)
           select r.at, r.day, r.project_id, r.object_id, r.kind, r.owner_id
             from json_populate_record(null::public.progress_log, $1::json) r
            where (r.object_id is null or exists (
                    select 1 from public.objects o where o.id = r.object_id and o.deleted_at is null))
              and not exists (
                    select 1 from public.progress_log p
                     where p.at = r.at and p.kind = r.kind and p.object_id is not distinct from r.object_id)
            returning 1`,
          [h.j],
        ),
      );
      if ((r as { rows: unknown[] } | undefined)?.rows.length) sum.historyAdded += 1;
    }

    for (const t of triggers.rows)
      await tx.exec(`alter table public.${q(t.rel)} enable trigger ${q(t.tg)}`);
  });
  progress("merge", 100);
  return sum;
}
