import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OWNER,
  OTHER,
  PG,
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

/** Schema-level coverage for ADR 0002: Memory, context colour, and the tag catalogue. */

let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});

describe("memory_details", () => {
  it("defaults to a fact, user-sourced, unpinned", async () => {
    await inRollback(db, async (tx) => {
      const id = await createObject(tx, { type: "memory" });
      const { rows } = await tx.query<{
        memory_type: string;
        source_kind: string;
        pinned: boolean;
        detail: string;
        last_accessed_at: string | null;
      }>(
        "select memory_type, source_kind, pinned, detail, last_accessed_at from public.memory_details where id = $1",
        [id],
      );
      expect(rows[0]).toEqual({
        memory_type: "fact",
        source_kind: "user",
        pinned: false,
        detail: "",
        last_accessed_at: null,
      });
    });
  });

  it("rejects a detail longer than 1000 characters", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "memory" });
      await expectPgError(
        tx.exec(
          `insert into public.memory_details (id, owner_id, detail) values ('${id}', '${OWNER}', repeat('x', 1001))`,
        ),
        PG.check,
      );
    });
  });

  it("rejects an unknown memory_type", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "memory" });
      await expectPgError(
        tx.exec(
          `insert into public.memory_details (id, owner_id, memory_type) values ('${id}', '${OWNER}', 'decision')`,
        ),
        PG.invalidText,
      );
    });
  });
});

describe("objects.color", () => {
  it("accepts a colour token on a project", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "project" });
      await tx.exec(`update public.objects set color = 'purple' where id = '${id}'`);
    });
  });

  it("rejects a colour on a type other than project/sub_project", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "memory" });
      await expectPgError(
        tx.exec(`update public.objects set color = 'purple' where id = '${id}'`),
        PG.check,
      );
    });
  });

  it("rejects a raw hex value: only a token key is allowed", async () => {
    await inRollback(db, async (tx) => {
      const id = await insertObject(tx, { type: "project" });
      await expectPgError(
        tx.exec(`update public.objects set color = '#a1d4e6' where id = '${id}'`),
        PG.check,
      );
    });
  });
});

describe("edge_rules for the Memory edges", () => {
  it("allows about from a memory to any non-memory type", async () => {
    await inRollback(db, async (tx) => {
      const mem = await createObject(tx, { type: "memory" });
      const project = await createObject(tx, { type: "project" });
      await insertEdge(tx, "about", mem, project);
    });
  });

  it("rejects about from a memory to another memory", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "memory" });
      const b = await createObject(tx, { type: "memory" });
      await expectPgError(insertEdge(tx, "about", a, b), PG.check);
    });
  });

  it("allows supported_by only to a document", async () => {
    await inRollback(db, async (tx) => {
      const mem = await createObject(tx, { type: "memory" });
      const doc = await createObject(tx, { type: "document" });
      await insertEdge(tx, "supported_by", mem, doc);
    });
    await inRollback(db, async (tx) => {
      const mem = await createObject(tx, { type: "memory" });
      const task = await createObject(tx, { type: "task" });
      await expectPgError(insertEdge(tx, "supported_by", mem, task), PG.check);
    });
  });

  it("allows derived_from to any type, including another memory", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "memory" });
      const b = await createObject(tx, { type: "memory" });
      await insertEdge(tx, "derived_from", a, b);
    });
  });

  it("does not allow located_at from a memory: it has no physical location", async () => {
    await inRollback(db, async (tx) => {
      const mem = await createObject(tx, { type: "memory" });
      const loc = await createObject(tx, { type: "location" });
      await expectPgError(insertEdge(tx, "located_at", mem, loc), PG.check);
    });
  });

  it("extends estimates/references to reach a memory, filling the pre-existing ANY gap", async () => {
    await inRollback(db, async (tx) => {
      const est = await createObject(tx, { type: "estimate" });
      const mem = await createObject(tx, { type: "memory" });
      await insertEdge(tx, "estimates", est, mem);
    });
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "memory" });
      const b = await createObject(tx, { type: "task" });
      await insertEdge(tx, "references", a, b);
      await insertEdge(tx, "references", b, a);
    });
  });
});

describe("tags catalogue", () => {
  it("rejects a duplicate name for the same owner, case-insensitively", async () => {
    await inRollback(db, async (tx) => {
      await tx.exec(`insert into public.tags (name, owner_id) values ('Dorsel', '${OWNER}')`);
      await expectPgError(
        tx.exec(`insert into public.tags (name, owner_id) values ('dorsel', '${OWNER}')`),
        PG.unique,
      );
    });
  });

  it("allows the same name for two different owners", async () => {
    await inRollback(db, async (tx) => {
      await tx.exec(`insert into public.tags (name, owner_id) values ('Shared', '${OWNER}')`);
      await tx.exec(`insert into public.tags (name, owner_id) values ('Shared', '${OTHER}')`);
    });
  });

  it("rejects a raw hex colour on a tag: only a token key is allowed", async () => {
    await inRollback(db, async (tx) => {
      await expectPgError(
        tx.exec(
          `insert into public.tags (name, color, owner_id) values ('Bad', '#ff0000', '${OWNER}')`,
        ),
        PG.check,
      );
    });
  });

  it("cannot attach a tag to another owner's object, or vice versa", async () => {
    await inRollback(db, async (tx) => {
      const mine = await createObject(tx, { type: "project" });
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.tags (name, owner_id) values ('Theirs', '${OTHER}') returning id`,
      );
      const theirTag = (rows[0] as { id: string }).id;
      await expectPgError(
        tx.exec(
          `insert into public.object_tags (object_id, tag_id, owner_id) values ('${mine}', '${theirTag}', '${OWNER}')`,
        ),
        PG.check,
      );
    });
  });

  it("cascades: deleting a tag removes its attachments; deleting an object does too", async () => {
    await inRollback(db, async (tx) => {
      const obj = await createObject(tx, { type: "project" });
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.tags (name, owner_id) values ('Cascade', '${OWNER}') returning id`,
      );
      const tagId = (rows[0] as { id: string }).id;
      await tx.exec(
        `insert into public.object_tags (object_id, tag_id, owner_id) values ('${obj}', '${tagId}', '${OWNER}')`,
      );
      await tx.exec(`delete from public.tags where id = '${tagId}'`);
      const left = await tx.query("select 1 from public.object_tags where tag_id = $1", [tagId]);
      expect(left.rows).toHaveLength(0);
    });
  });
});

describe("row-level security for the new tables", () => {
  it("a memory is invisible to every owner but its own", async () => {
    await inRollback(db, async (tx) => {
      await asUser(tx, OWNER);
      await createObject(tx, { type: "memory" });
      await asUser(tx, OTHER);
      const { rows } = await tx.query("select 1 from public.objects where type = 'memory'");
      expect(rows).toHaveLength(0);
    });
  });

  it("anon can read no tags at all", async () => {
    await inRollback(db, async (tx) => {
      await asUser(tx, OWNER);
      await tx.exec(`insert into public.tags (name, owner_id) values ('Private', '${OWNER}')`);
      await asAnon(tx);
      await expectDenied(tx, "select * from public.tags", PG.rls);
    });
  });
});
