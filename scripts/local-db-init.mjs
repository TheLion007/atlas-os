// Builds the local PGlite database (./data/atlas-pgdata) from the repo migrations, adds the two
// tables that only existed in Supabase (projects, memories) from backup/schema.json, then imports
// backup/data/*.ndjson with every owner_id/actor merged under one local owner.
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { acquireDbLock } from "./db-lock.mjs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const DATA_DIR = process.env.ATLAS_DB_DIR || "data/atlas-pgdata";
const OWNER_EMAIL = process.argv[2];
if (!OWNER_EMAIL) throw new Error("usage: node scripts/local-db-init.mjs <owner-email>");
if (existsSync(DATA_DIR))
  throw new Error(`${DATA_DIR} existe déjà — supprimez-le pour repartir de zéro.`);

const schema = JSON.parse(readFileSync("backup/schema.json", "utf8"));
const users = JSON.parse(readFileSync("backup/auth_users_minimal.json", "utf8"));
const owner = users.find((u) => u.email?.toLowerCase() === OWNER_EMAIL.toLowerCase());
if (!owner) throw new Error("Compte propriétaire introuvable dans la sauvegarde.");
const OWNER_ID = owner.id;

mkdirSync(dirname(resolve(DATA_DIR)), { recursive: true });
acquireDbLock(resolve(DATA_DIR));
const db = new PGlite(DATA_DIR, { extensions: { pg_trgm } });

// What Supabase itself provided: auth.uid(), roles, default grants (same prelude as tests/sql).
await db.exec(`
  create schema if not exists extensions;
  create schema if not exists auth;
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, extensions, auth to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`);

for (const f of readdirSync("db/migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await db.exec(readFileSync(join("db/migrations", f), "utf8"));
}

// projects / memories: not in the migrations, rebuilt from the catalog export.
const EXTRA = ["projects", "memories"];
const qual = (c) =>
  c.udt_name.startsWith("_")
    ? `${c.udt_name.slice(1)}[]`
    : c.data_type === "timestamp without time zone"
      ? "timestamp"
      : c.udt_name;
for (const t of EXTRA) {
  const cols = schema.columns
    .filter((c) => c.table_name === t)
    .map(
      (c) =>
        `"${c.column_name}" ${qual(c)}${c.is_nullable === "NO" ? " not null" : ""}${c.column_default ? ` default ${c.column_default}` : ""}`,
    );
  await db.exec(`create table public."${t}" (${cols.join(", ")})`);
}
for (const t of EXTRA) {
  // Primary/unique first, foreign keys after both tables exist.
  for (const c of schema.constraints.filter((c) => c.tbl === t && !c.def.startsWith("FOREIGN")))
    await db.exec(`alter table public."${t}" add constraint "${c.conname}" ${c.def}`);
}
for (const t of EXTRA) {
  for (const c of schema.constraints.filter((c) => c.tbl === t && c.def.startsWith("FOREIGN")))
    await db.exec(`alter table public."${t}" add constraint "${c.conname}" ${c.def}`);
  for (const i of schema.indexes.filter(
    (i) => i.tablename === t && !/_pkey|_key/.test(i.indexname),
  ))
    await db.exec(i.indexdef);
}

// Import. Triggers and FK checks are off so rows land exactly as exported (activity_log included).
await db.exec("set session_replication_role = replica");
// edge_rules is seeded by the migrations; replace it with the exported copy (compared later).
await db.exec("truncate public.edge_rules");
const ownerCols = new Set(["owner_id", "actor"]);
for (const { name } of schema.tables) {
  const file = `backup/data/${name}.ndjson`;
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const cols = schema.columns
    .filter((c) => c.table_name === name && c.is_generated !== "ALWAYS")
    .map((c) => c.column_name);
  if (rows.length) {
    for (const r of rows) for (const k of ownerCols) if (r[k] != null) r[k] = OWNER_ID;
    const list = cols.map((c) => `"${c}"`).join(", ");
    for (let i = 0; i < rows.length; i += 200) {
      await db.query(
        `insert into public."${name}" (${list}) overriding system value
         select ${list} from jsonb_populate_recordset(null::public."${name}", $1::jsonb)`,
        [JSON.stringify(rows.slice(i, i + 200))],
      );
    }
  }
}
await db.exec("set session_replication_role = default");
// Keep the identity sequence ahead of the imported activity_log ids.
await db.exec(
  `select setval(pg_get_serial_sequence('public.activity_log','id'), coalesce((select max(id) from public.activity_log), 0) + 1, false)`,
);
await db.close();
console.log(`Base locale créée dans ${DATA_DIR} (propriétaire unique fixé).`);
