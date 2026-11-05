// Compares the local PGlite database with backup/ : schema objects, row counts, row contents.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { acquireDbLock } from "./db-lock.mjs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const DATA_DIR = process.env.ATLAS_DB_DIR || "data/atlas-pgdata";
acquireDbLock(resolve(DATA_DIR));
const db = new PGlite(DATA_DIR, { extensions: { pg_trgm } });
await db.exec("set timezone to 'UTC'");
const bk = JSON.parse(readFileSync("backup/schema.json", "utf8"));
const q = async (s) => (await db.query(s)).rows;
const norm = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/\bextensions\./g, "")
    .replace(/\bpublic\./g, "")
    .trim();

const loc = {
  tables: await q(
    `select c.relname as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1`,
  ),
  columns: await q(
    `select table_name, column_name, udt_name, is_nullable, column_default, is_generated from information_schema.columns where table_schema='public' order by table_name, ordinal_position`,
  ),
  constraints: await q(
    `select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def from pg_constraint where connamespace='public'::regnamespace order by 1,2`,
  ),
  indexes: await q(
    `select tablename, indexname, indexdef from pg_indexes where schemaname='public' order by 1,2`,
  ),
  policies: await q(
    `select tablename, policyname, cmd from pg_policies where schemaname='public' order by 1,2`,
  ),
  triggers: await q(
    `select tgrelid::regclass::text as tbl, tgname from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='public'::regnamespace) order by 1,2`,
  ),
  functions: await q(
    `select p.proname as name from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' order by 1`,
  ),
  enums: await q(
    `select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by 1 order by 1`,
  ),
};
const diff = (label, a, b) => {
  const A = new Set(a),
    B = new Set(b);
  const onlyBk = [...A].filter((x) => !B.has(x)),
    onlyLoc = [...B].filter((x) => !A.has(x));
  console.log(
    `${onlyBk.length + onlyLoc.length === 0 ? "OK " : "DIFF"} ${label}: sauvegarde ${A.size}, local ${B.size}`,
  );
  onlyBk.slice(0, 5).forEach((x) => console.log("   seulement sauvegarde:", x.slice(0, 200)));
  onlyLoc.slice(0, 5).forEach((x) => console.log("   seulement local     :", x.slice(0, 200)));
};
diff(
  "tables(+rls)",
  bk.tables.map((t) => `${t.name}:${t.rls}`),
  loc.tables.map((t) => `${t.name}:${t.rls}`),
);
diff(
  "colonnes",
  bk.columns.map((c) =>
    [c.table_name, c.column_name, c.udt_name, c.is_nullable, c.is_generated].join("|"),
  ),
  loc.columns.map((c) =>
    [c.table_name, c.column_name, c.udt_name, c.is_nullable, c.is_generated].join("|"),
  ),
);
diff(
  "contraintes",
  bk.constraints
    .filter((c) => !/^NOT NULL/.test(c.def))
    .map((c) => `${c.tbl}|${c.conname}|${norm(c.def)}`),
  loc.constraints
    .filter((c) => !/^NOT NULL/.test(c.def))
    .map((c) => `${c.tbl}|${c.conname}|${norm(c.def)}`),
);
diff(
  "index",
  bk.indexes.map((c) => `${c.tablename}|${c.indexname}|${norm(c.indexdef)}`),
  loc.indexes.map((c) => `${c.tablename}|${c.indexname}|${norm(c.indexdef)}`),
);
diff(
  "politiques RLS",
  bk.policies.map((p) => `${p.tablename}|${p.policyname}|${p.cmd}`),
  loc.policies.map((p) => `${p.tablename}|${p.policyname}|${p.cmd}`),
);
diff(
  "triggers",
  bk.triggers.map((t) => `${t.tbl}|${t.tgname}`),
  loc.triggers.map((t) => `${t.tbl}|${t.tgname}`),
);
diff(
  "fonctions",
  bk.functions.map((f) => f.name),
  loc.functions.map((f) => f.name),
);
diff(
  "enums",
  bk.enums.map((e) => `${e.name}:${e.labels.join(",")}`),
  loc.enums.map((e) => `${e.name}:${e.labels.join(",")}`),
);

console.log("\nTable                  sauvegarde  local   contenu");
const stable = (v) =>
  v && typeof v === "object"
    ? Array.isArray(v)
      ? v.map(stable)
      : Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
    : v;
let tb = 0,
  tl = 0,
  allOk = true;
for (const { name } of bk.tables) {
  const gen = new Set(
    bk.columns
      .filter((c) => c.table_name === name && c.is_generated === "ALWAYS")
      .map((c) => c.column_name),
  );
  const rows = readFileSync(`backup/data/${name}.ndjson`, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const n = Number((await q(`select count(*) n from public."${name}"`))[0].n);
  const localRows = (await q(`select to_jsonb(t) j from public."${name}" t`)).map((r) => r.j);
  const strip = (r, isBk) => {
    const o = { ...r };
    for (const g of gen) delete o[g];
    for (const k of ["owner_id", "actor"])
      if (isBk && o[k] != null) o[k] = "OWNER";
      else if (!isBk && o[k] != null) o[k] = "OWNER";
    return JSON.stringify(stable(o));
  };
  const a = rows.map((r) => strip(r, true)).sort(),
    b = localRows.map((r) => strip(r, false)).sort();
  const same = a.length === b.length && a.every((x, i) => x === b[i]);
  tb += rows.length;
  tl += n;
  allOk &&= same && rows.length === n;
  console.log(
    `${name.padEnd(22)} ${String(rows.length).padStart(9)} ${String(n).padStart(6)}   ${same ? "identique" : "DIFFERENT"}`,
  );
}
console.log(
  `${"TOTAL".padEnd(22)} ${String(tb).padStart(9)} ${String(tl).padStart(6)}   ${allOk ? "tout identique" : "ECARTS"}`,
);
const tabs = (
  await q(
    `select table_name from information_schema.columns where table_schema='public' and column_name='owner_id'`,
  )
).map((r) => r.table_name);
let distinct = new Set();
for (const t of tabs)
  for (const r of await q(`select distinct owner_id from public."${t}"`)) distinct.add(r.owner_id);
console.log(`\nPropriétaires distincts dans toutes les tables: ${distinct.size}`);
await db.close();
