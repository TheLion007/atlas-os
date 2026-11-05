import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./pglite";

const globals = globalThis as unknown as { __atlasPglite?: Promise<{ close(): Promise<void> }> };
const dirs: string[] = [];

afterEach(async () => {
  const open = globals.__atlasPglite;
  globals.__atlasPglite = undefined;
  if (open) await (await open).close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.ATLAS_MIGRATIONS_DIR;
});

describe("the local database on a new PC", () => {
  it("builds its whole schema the first time the data folder is opened", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-db-"));
    dirs.push(dir);
    const db = createPgliteDb(join(dir, "atlas-pgdata"));
    const tables = await db.query<{ n: string }>(
      "select count(*)::text as n from information_schema.tables where table_schema = 'public' and table_name in ('objects','edges','activity_log','progress_log','document_files')",
    );
    expect(tables[0]?.n).toBe("5");
    // The relation rules are part of the schema: without them nothing could be linked.
    const rules = await db.query<{ n: string }>(
      "select count(*)::text as n from public.edge_rules",
    );
    expect(Number(rules[0]?.n)).toBeGreaterThan(0);
  }, 60_000);

  it("keeps what is already there when it is opened again", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-db-"));
    dirs.push(dir);
    const data = join(dir, "atlas-pgdata");
    const first = createPgliteDb(data);
    await first.query("create table public.probe (n int)");
    await first.query("insert into public.probe values (7)");
    await (await globals.__atlasPglite!).close();
    globals.__atlasPglite = undefined;
    const second = createPgliteDb(data);
    expect((await second.query<{ n: number }>("select n from public.probe"))[0]?.n).toBe(7);
  }, 60_000);

  it("says plainly when the migrations cannot be found", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-db-"));
    dirs.push(dir);
    process.env.ATLAS_MIGRATIONS_DIR = join(dir, "nowhere");
    const db = createPgliteDb(join(dir, "atlas-pgdata"));
    await expect(db.query("select 1")).rejects.toThrow(/migrations were not found/);
    globals.__atlasPglite = undefined;
  }, 60_000);
});
