import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { expect } from "vitest";
import { PRELUDE } from "@/server/db/prelude";

/**
 * SQL test harness. Migrations are applied to an in-process Postgres (PGlite) so schema
 * correctness is tested without Docker. The prelude below only recreates what Supabase itself
 * provides (roles, `auth.uid()`, default grants); migrations stay pure Supabase-style SQL.
 */

export { PRELUDE } from "@/server/db/prelude";

export const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** A database with every migration applied — or only those sorting before `before`. */
export async function createMigratedDb(opts: { before?: string } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(PRELUDE);
  for (const file of migrationFiles()) {
    if (opts.before && file >= opts.before) break;
    await applyMigration(db, file);
  }
  return db;
}

/** Applies one migration file (again, if need be — for idempotency tests). */
export async function applyMigration(db: PGlite, file: string): Promise<void> {
  try {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  } catch (e) {
    throw new Error(`Migration ${file} failed: ${(e as Error).message}`, { cause: e });
  }
}

export const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

class Rollback extends Error {}

/** Runs `fn` inside a transaction that is always rolled back, so tests never see each other. */
export async function inRollback(db: PGlite, fn: (tx: Queryable) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Queryable);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

/** Acts as an authenticated user (RLS applies) for the rest of the transaction. */
export async function asUser(tx: Queryable, userId: string): Promise<void> {
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await tx.exec("set local role authenticated");
}

export async function asAnon(tx: Queryable): Promise<void> {
  await tx.exec("set local role anon");
}

/** Back to the connection's owner role (bypasses RLS) for assertions. */
export async function asAdmin(tx: Queryable): Promise<void> {
  await tx.exec("reset role");
}

export interface NewObject {
  type: string;
  title?: string;
  status?: string;
  owner?: string;
}

export async function insertObject(tx: Queryable, o: NewObject): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `insert into public.objects (type, title, status, owner_id)
     values ($1::public.object_type, $2, $3::public.lifecycle_status, $4) returning id`,
    [o.type, o.title ?? `${o.type} title`, o.status ?? "active", o.owner ?? OWNER],
  );
  return (r.rows[0] as { id: string }).id;
}

/** Inserts an object and its (minimal, valid) details row. */
const MINIMAL_DETAILS: Record<string, { table: string; cols: string; vals: string }> = {
  plan: { table: "plan_details", cols: "", vals: "" },
  project: { table: "project_details", cols: "type", vals: "'project'" },
  sub_project: { table: "project_details", cols: "type", vals: "'sub_project'" },
  task: { table: "task_details", cols: "", vals: "" },
  milestone: { table: "milestone_details", cols: "", vals: "" },
  scenario: { table: "scenario_details", cols: "variant", vals: "'base'" },
  estimate: { table: "estimate_details", cols: "amount, currency", vals: "1, 'EUR'" },
  location: { table: "location_details", cols: "", vals: "" },
  property: { table: "property_details", cols: "", vals: "" },
  decision: { table: "decision_details", cols: "", vals: "" },
  risk: { table: "risk_details", cols: "probability, impact", vals: "3, 3" },
  note: { table: "note_details", cols: "", vals: "" },
  document: { table: "document_details", cols: "mime", vals: "'application/pdf'" },
  person: { table: "person_details", cols: "", vals: "" },
  event: { table: "event_details", cols: "starts_at", vals: "now()" },
  memory: { table: "memory_details", cols: "", vals: "" },
  transaction: {
    table: "transaction_details",
    cols: "date, amount, currency",
    vals: "'2026-09-01', 42.5, 'EUR'",
  },
};

export async function createObject(tx: Queryable, o: NewObject): Promise<string> {
  const id = await insertObject(tx, o);
  const d = MINIMAL_DETAILS[o.type] as { table: string; cols: string; vals: string };
  const cols = ["id", "owner_id", ...(d.cols ? [d.cols] : [])].join(", ");
  const vals = [`'${id}'`, `'${o.owner ?? OWNER}'`, ...(d.vals ? [d.vals] : [])].join(", ");
  await tx.exec(`insert into public.${d.table} (${cols}) values (${vals})`);
  return id;
}

export async function insertEdge(
  tx: Queryable,
  kind: string,
  from: string,
  to: string,
  extra: { owner?: string } = {},
): Promise<string> {
  const depends = kind === "depends_on";
  const r = await tx.query<{ id: string }>(
    `insert into public.edges (kind, from_id, to_id, owner_id, dependency_type, lag_days)
     values ($1::public.edge_kind, $2, $3, $4,
             ${depends ? "'fs'::public.dependency_type" : "null"}, ${depends ? "0" : "null"})
     returning id`,
    [kind, from, to, extra.owner ?? OWNER],
  );
  return (r.rows[0] as { id: string }).id;
}

/** Asserts a statement fails with a specific Postgres error code (and optional message). */
export async function expectPgError(
  promise: Promise<unknown>,
  code: string,
  message?: RegExp,
): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e as { code?: string; message?: string },
  );
  expect(err, "expected the statement to fail").not.toBeNull();
  expect(err?.code).toBe(code);
  if (message) expect(err?.message).toMatch(message);
}

/**
 * Runs a statement that is expected to fail, inside a savepoint so the surrounding transaction
 * survives (Postgres aborts a transaction on error). Returns the error, or null if it succeeded.
 */
export async function attempt(
  tx: Queryable,
  sql: string,
  params?: unknown[],
): Promise<{ code?: string; message?: string } | null> {
  await tx.exec("savepoint attempt");
  try {
    await tx.query(sql, params);
    await tx.exec("release savepoint attempt");
    return null;
  } catch (e) {
    await tx.exec("rollback to savepoint attempt");
    return e as { code?: string; message?: string };
  }
}

export async function expectDenied(
  tx: Queryable,
  sql: string,
  code: string,
  params?: unknown[],
): Promise<void> {
  const err = await attempt(tx, sql, params);
  expect(err, `expected to fail: ${sql}`).not.toBeNull();
  expect(err?.code, `${sql} -> ${err?.message}`).toBe(code);
}

export const PG = {
  check: "23514",
  unique: "23505",
  foreignKey: "23503",
  restrict: "23001",
  notNull: "23502",
  permission: "42501",
  rls: "42501",
  invalidText: "22P02",
} as const;
