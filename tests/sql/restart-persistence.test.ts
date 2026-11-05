import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyMigration,
  asUser,
  createObject,
  migrationFiles,
  OTHER,
  OWNER,
  PRELUDE,
  type Queryable,
} from "./helpers";

/**
 * The critical persistence test the accounts audit called for: a private Memory must survive a
 * full restart, not just the life of one connection or one browser session — that gap (data only
 * ever living in an in-memory fixture source, never written to Postgres) was the actual cause of
 * "my data disappeared". The rest of `tests/sql`/`tests/api` reuse one PGlite instance for their
 * whole file, which never exercises a real restart; this test closes the database entirely and
 * opens a brand new instance against the same on-disk files, exactly like `next dev`/PowerShell
 * stopping and starting again.
 */
describe("restart persistence (end-to-end, disk-backed)", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "atlas-persistence-"));
  afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

  it("keeps a private Memory across a full database restart, still scoped to its owner", async () => {
    // Boot #1: fresh on-disk database, every migration applied, one private Memory written as
    // its owner would write it (inside a transaction, as the `authenticated` role — the same
    // path `asOwner()` puts every real request through).
    let db = new PGlite(dataDir, { extensions: { pg_trgm } });
    await db.exec(PRELUDE);
    for (const file of migrationFiles()) await applyMigration(db, file);

    const id = await db.transaction(async (tx) => {
      const q = tx as unknown as Queryable;
      await asUser(q, OWNER);
      return createObject(q, { type: "memory", title: "PRIVATE PERSISTENCE TEST", owner: OWNER });
    });

    // Not just a local variable: it is really in the persistent store before we go any further.
    const before = await db.query<{ title: string }>(
      "select title from public.objects where id = $1",
      [id],
    );
    expect(before.rows[0]?.title).toBe("PRIVATE PERSISTENCE TEST");

    // Restart: close this connection completely and open a new one against the same on-disk
    // files. No migrations are re-run and nothing is carried over in process memory — if the
    // Memory is still there, it was genuinely durable, not just alive in this test's heap.
    await db.close();
    db = new PGlite(dataDir, { extensions: { pg_trgm } });

    const after = await db.transaction(async (tx) => {
      const q = tx as unknown as Queryable;
      await asUser(q, OWNER);
      const r = await q.query<{ title: string; deleted_at: string | null }>(
        "select title, deleted_at from public.objects where id = $1",
        [id],
      );
      return r.rows[0];
    });
    expect(after?.title).toBe("PRIVATE PERSISTENCE TEST");
    expect(after?.deleted_at).toBeNull();

    // And still owner-scoped after the restart: a different account sees nothing at all.
    const seenByOther = await db.transaction(async (tx) => {
      const q = tx as unknown as Queryable;
      await asUser(q, OTHER);
      const r = await q.query<{ n: number }>(
        "select count(*)::int as n from public.objects where id = $1",
        [id],
      );
      return r.rows[0]?.n;
    });
    expect(seenByOther).toBe(0);

    await db.close();
  }, 60_000);
});
