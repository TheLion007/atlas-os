import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OTHER,
  OWNER,
  PG,
  asAdmin,
  asAnon,
  asUser,
  createMigratedDb,
  createObject,
  expectDenied,
  expectPgError,
  inRollback,
  insertEdge,
  insertObject,
} from "./helpers";

let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});

const count = async (
  tx: Parameters<typeof asAdmin>[0],
  table: string,
  where = "true",
): Promise<number> => {
  const { rows } = await tx.query<{ n: number }>(
    `select count(*)::int as n from public.${table} where ${where}`,
  );
  return rows[0]?.n ?? -1;
};

describe("row-level security", () => {
  it("lets an owner read and write only their own objects", async () => {
    await inRollback(db, async (tx) => {
      await createObject(tx, { type: "project", title: "mine" });
      await createObject(tx, { type: "project", title: "theirs", owner: OTHER });

      await asUser(tx, OWNER);
      expect(await count(tx, "objects")).toBe(1);
      expect(await count(tx, "project_details")).toBe(1);

      await asUser(tx, OTHER);
      expect(await count(tx, "objects")).toBe(1);
      const { rows } = await tx.query<{ title: string }>("select title from public.objects");
      expect(rows[0]?.title).toBe("theirs");
    });
  });

  it("stops a user inserting rows for someone else", async () => {
    await inRollback(db, async (tx) => {
      await asUser(tx, OWNER);
      await expectPgError(
        tx.query(`insert into public.objects (type, title, owner_id) values ('task', 'x', $1)`, [
          OTHER,
        ]),
        PG.rls,
        /row-level security/,
      );
    });
  });

  it("fills owner_id from the session, so the client cannot forget it", async () => {
    await inRollback(db, async (tx) => {
      await asUser(tx, OWNER);
      await tx.exec(`insert into public.objects (type, title) values ('task', 'auto-owned')`);
      expect(await count(tx, "objects", `owner_id = '${OWNER}'`)).toBe(1);
    });
  });

  it("hides other users' rows from update and delete (0 rows affected, no error leak)", async () => {
    await inRollback(db, async (tx) => {
      const theirs = await createObject(tx, { type: "task", title: "theirs", owner: OTHER });
      await asUser(tx, OWNER);
      await tx.exec(`update public.objects set title = 'hijacked' where id = '${theirs}'`);
      await tx.exec(`delete from public.objects where id = '${theirs}'`);
      await asAdmin(tx);
      const { rows } = await tx.query<{ title: string }>(
        "select title from public.objects where id = $1",
        [theirs],
      );
      expect(rows[0]?.title).toBe("theirs");
    });
  });

  it("gives anon no access to any table", async () => {
    await inRollback(db, async (tx) => {
      const tables = await tx.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname = 'public'",
      );
      expect(tables.rows.length).toBeGreaterThan(15);
      for (const { tablename } of tables.rows) {
        await asAnon(tx);
        await expectDenied(tx, `select * from public.${tablename} limit 1`, PG.permission);
        await asAdmin(tx);
      }
    });
  });

  it("lets users read the activity log but never write or edit it", async () => {
    await inRollback(db, async (tx) => {
      await createObject(tx, { type: "task" });
      await asUser(tx, OWNER);
      expect(await count(tx, "activity_log")).toBeGreaterThan(0);
      await expectDenied(
        tx,
        `insert into public.activity_log (action, owner_id) values ('created', $1)`,
        PG.permission,
        [OWNER],
      );
      await expectDenied(tx, `update public.activity_log set action = 'purged'`, PG.permission);
      await expectDenied(tx, `delete from public.activity_log`, PG.permission);
    });
  });

  it("only shows a user their own activity", async () => {
    await inRollback(db, async (tx) => {
      await createObject(tx, { type: "task", owner: OWNER });
      await createObject(tx, { type: "task", owner: OTHER });
      await asUser(tx, OTHER);
      expect(await count(tx, "activity_log", `owner_id <> '${OTHER}'`)).toBe(0);
      expect(await count(tx, "activity_log")).toBeGreaterThan(0);
    });
  });

  it("makes edge rules read-only reference data", async () => {
    await inRollback(db, async (tx) => {
      await asUser(tx, OWNER);
      expect(await count(tx, "edge_rules")).toBeGreaterThan(50);
      await expectPgError(
        tx.exec(`insert into public.edge_rules values ('contains', 'task', 'task')`),
        PG.permission,
      );
    });
  });

  it("scopes edges to their owner", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task", owner: OTHER });
      const b = await createObject(tx, { type: "task", owner: OTHER });
      await insertEdge(tx, "depends_on", a, b, { owner: OTHER });
      await asUser(tx, OWNER);
      expect(await count(tx, "edges")).toBe(0);
      await asUser(tx, OTHER);
      expect(await count(tx, "edges")).toBe(1);
    });
  });
});

describe("activity log", () => {
  const actions = async (tx: Parameters<typeof asAdmin>[0]): Promise<string[]> => {
    const { rows } = await tx.query<{ action: string }>(
      "select action from public.activity_log order by id",
    );
    return rows.map((r) => r.action);
  };

  it("records creation, updates, relating, unrelating and deletion", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task", title: "a" });
      const b = await createObject(tx, { type: "task", title: "b" });
      await tx.exec(`update public.objects set title = 'renamed' where id = '${a}'`);
      const e = await insertEdge(tx, "depends_on", a, b);
      await tx.exec(`update public.edges set deleted_at = now() where id = '${e}'`);
      await tx.exec(`update public.objects set deleted_at = now() where id = '${a}'`);
      await tx.exec(`update public.objects set deleted_at = null where id = '${a}'`);
      expect(await actions(tx)).toEqual([
        "created",
        "created",
        "updated",
        "related",
        "unrelated",
        "deleted",
        "restored",
      ]);
    });
  });

  it("captures field-level changes as from/to", async () => {
    await inRollback(db, async (tx) => {
      const id = await createObject(tx, { type: "task", title: "old" });
      await tx.exec(`update public.objects set title = 'new', status = 'done' where id = '${id}'`);
      const { rows } = await tx.query<{ diff: Record<string, { from: unknown; to: unknown }> }>(
        "select diff from public.activity_log where action = 'updated' and object_id = $1",
        [id],
      );
      expect(rows[0]?.diff.title).toEqual({ from: "old", to: "new" });
      expect(rows[0]?.diff.status).toEqual({ from: "active", to: "done" });
      expect(rows[0]?.diff).not.toHaveProperty("updated_at");
      expect(rows[0]?.diff).not.toHaveProperty("search");
    });
  });

  it("logs changes to type-specific details against the object", async () => {
    await inRollback(db, async (tx) => {
      const id = await createObject(tx, { type: "task" });
      await tx.exec(`update public.task_details set due = '2027-05-01' where id = '${id}'`);
      const { rows } = await tx.query<{ diff: Record<string, { from: unknown; to: unknown }> }>(
        "select diff from public.activity_log where action = 'updated' and object_id = $1",
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.diff.due?.from).toBeNull();
    });
  });

  it("does not log an update that changed nothing", async () => {
    await inRollback(db, async (tx) => {
      const id = await createObject(tx, { type: "task", title: "same" });
      const before = (await actions(tx)).length;
      await tx.exec(`update public.objects set title = 'same' where id = '${id}'`);
      expect((await actions(tx)).length).toBe(before);
    });
  });

  it("does not double-log creation when details are inserted", async () => {
    await inRollback(db, async (tx) => {
      await createObject(tx, { type: "risk" });
      expect(await actions(tx)).toEqual(["created"]);
    });
  });

  it("keeps history after an object is purged", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "note" });
      await tx.exec(`delete from public.objects where id = '${id}'`);
      const acts = await actions(tx);
      expect(acts).toContain("created");
      expect(acts).toContain("purged");
    });
  });
});
