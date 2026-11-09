import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PRELUDE } from "./prelude";
import type { Db, Row } from "./types";

type Runner = Pick<PGlite, "query">;

function wrap(run: Runner, root: PGlite, inTransaction: boolean): Db {
  return {
    async query<T extends Row = Row>(text: string, params: readonly unknown[] = []) {
      const result = await run.query(text, params as unknown[]);
      return result.rows as unknown as T[];
    },
    async transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R> {
      if (inTransaction) return fn(wrap(run, root, true));
      return root.transaction(async (tx) => fn(wrap(tx, root, true)));
    },
  };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * PGlite is a single-process database: two processes on the same folder can corrupt it. A lock
 * file next to the data folder makes the second one fail loudly instead.
 */
function acquireLock(dataDir: string): void {
  // On a data folder shared between PCs the process id means nothing on another machine, so the
  // desktop app keeps this lock on the device (ATLAS_DB_LOCK); the cross-device lock is separate.
  const lockPath = process.env.ATLAS_DB_LOCK || `${dataDir}.lock`;
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, "utf8").trim());
    if (pid && pid !== process.pid && processAlive(pid)) {
      throw new Error(
        `The local database is already open in another process (pid ${pid}). Stop it first.`,
      );
    }
    unlinkSync(lockPath);
  }
  const fd = openSync(lockPath, "wx");
  writeSync(fd, String(process.pid));
  closeSync(fd);
  const release = () => {
    try {
      if (readFileSync(lockPath, "utf8").trim() === String(process.pid)) unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  };
  process.once("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      release();
      process.exit(0);
    });
  }
}

/** The last migration `scripts/local-db-init.mjs` is known to have applied to every local database. */
const BASELINE = "20260928120400";

/**
 * Migrations newer than the baseline are applied when the database opens, once each, so an
 * existing local database (with the user's own data) gains new tables without being rebuilt.
 * They are written to be idempotent, because a freshly initialised database already has them.
 */
/** Where the migration files are: next to the app, or wherever `ATLAS_MIGRATIONS_DIR` says. */
function migrationsDir(): string {
  return process.env.ATLAS_MIGRATIONS_DIR || resolve(process.cwd(), "db", "migrations");
}

/**
 * A brand-new data folder has no tables at all (a first launch on a new PC): build the whole
 * schema from the migrations, once. A database that already has its tables is left untouched.
 */
async function initFreshDatabase(pg: PGlite): Promise<void> {
  const has = await pg.query("select to_regclass('public.objects') as t");
  if ((has.rows[0] as { t: string | null }).t !== null) return;
  const dir = migrationsDir();
  if (!existsSync(dir))
    throw new Error(`The database migrations were not found (${dir}); cannot create the database.`);
  await pg.exec(PRELUDE);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) await pg.exec(readFileSync(join(dir, file), "utf8"));
  // Everything is applied now: the late-migration check below must not run any of it again.
  await pg.exec(
    "create table if not exists public.applied_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  for (const file of files.filter((f) => f.slice(0, 14) > BASELINE))
    await pg.query(
      "insert into public.applied_migrations (name) values ($1) on conflict do nothing",
      [file],
    );
}

export async function applyLateMigrations(pg: PGlite): Promise<void> {
  const dir = migrationsDir();
  if (!existsSync(dir)) return;
  const pending = readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && f.slice(0, 14) > BASELINE)
    .sort();
  if (pending.length === 0) return;
  await pg.exec(
    "create table if not exists public.applied_migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  for (const file of pending) {
    const done = await pg.query("select 1 from public.applied_migrations where name = $1", [file]);
    if (done.rows.length > 0) continue;
    await pg.exec(readFileSync(join(dir, file), "utf8"));
    await pg.query("insert into public.applied_migrations (name) values ($1)", [file]);
  }
}

/** Brings a database (a fresh one, or one loaded from a backup of any age) up to this version. */
export async function prepareDatabase(pg: PGlite): Promise<void> {
  await pg.waitReady;
  await pg.exec("set timezone to 'UTC'");
  await initFreshDatabase(pg);
  await applyLateMigrations(pg);
}

/** The newest migration this version of the app knows: the "schema level" of a backup. */
export function latestSchemaVersion(): string {
  const dir = migrationsDir();
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : [];
  return files.length ? files[files.length - 1]!.slice(0, 14) : "0";
}

/**
 * Opens a database from the files of a backup (`pgdata.tar.gz`), in memory or in `dir`, and
 * migrates it to this version. Throws when the archive is not a database this engine can read.
 */
export async function openDatabaseFromDump(dump: Blob, dir?: string): Promise<PGlite> {
  const pg = dir
    ? new PGlite(dir, { loadDataDir: dump, extensions: { pg_trgm } })
    : new PGlite({ loadDataDir: dump, extensions: { pg_trgm } });
  try {
    await prepareDatabase(pg);
  } catch (e) {
    await pg.close().catch(() => undefined);
    throw e;
  }
  return pg;
}

/** The open local database, for the backup code (it needs the engine, not only `query`). */
export async function livePglite(): Promise<PGlite> {
  const globals = globalThis as unknown as { __atlasPglite?: Promise<PGlite> };
  if (!globals.__atlasPglite) createPgliteDb();
  return globals.__atlasPglite!;
}

/** Closes the open database cleanly (the desktop shell asks before stopping the server). */
export async function closeLiveDatabase(): Promise<void> {
  const globals = globalThis as unknown as { __atlasPglite?: Promise<PGlite> };
  const open = globals.__atlasPglite;
  if (!open) return;
  const pg = await open;
  await pg.close();
}

/** Where the database lives; `ATLAS_DB_DIR` overrides the default (relative to the project). */
export function localDbDir(): string {
  return resolve(process.cwd(), process.env.ATLAS_DB_DIR || "data/atlas-pgdata");
}

/**
 * The local database: an embedded Postgres (PGlite) stored in one folder, no network involved.
 * Opening is lazy and kept on `globalThis` so Next's module reloads reuse the one connection.
 */
export function createPgliteDb(dir: string = localDbDir()): Db {
  const globals = globalThis as unknown as { __atlasPglite?: Promise<PGlite> };
  globals.__atlasPglite ??= (async () => {
    acquireLock(dir);
    const pg = new PGlite(dir, { extensions: { pg_trgm } });
    await prepareDatabase(pg);
    return pg;
  })();
  const ready = globals.__atlasPglite;
  const lazy = async <R>(fn: (pg: PGlite) => Promise<R>) => fn(await ready);
  return {
    query: (text, params) => lazy((pg) => wrap(pg, pg, false).query(text, params)),
    transaction: (fn) => lazy((pg) => wrap(pg, pg, false).transaction(fn)),
  };
}
