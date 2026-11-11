import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OTHER,
  OWNER,
  PG,
  createMigratedDb,
  createObject,
  expectPgError,
  inRollback,
  insertEdge,
} from "./helpers";

let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});

describe("edge type matrix", () => {
  it("accepts legal edges", async () => {
    await inRollback(db, async (tx) => {
      const project = await createObject(tx, { type: "project" });
      const task = await createObject(tx, { type: "task" });
      const loc = await createObject(tx, { type: "location" });
      const est = await createObject(tx, { type: "estimate" });
      const prop = await createObject(tx, { type: "property" });
      await insertEdge(tx, "contains", project, task);
      await insertEdge(tx, "located_at", prop, loc);
      await insertEdge(tx, "estimates", est, prop);
      await insertEdge(tx, "funded_by", prop, est);
    });
  });

  it.each([
    ["contains", "task", "sub_project"],
    ["contains", "project", "estimate"],
    ["depends_on", "note", "task"],
    ["estimates", "task", "property"],
    ["funded_by", "property", "property"],
    ["located_at", "project", "task"],
    ["located_at", "location", "location"],
  ])("rejects %s: %s -> %s", async (kind, from, to) => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: from });
      const b = await createObject(tx, { type: to });
      await expectPgError(insertEdge(tx, kind, a, b), PG.check, /cannot/);
    });
  });

  it("builds a location hierarchy with contains (country -> city -> district)", async () => {
    await inRollback(db, async (tx) => {
      const country = await createObject(tx, { type: "location", title: "Country" });
      const city = await createObject(tx, { type: "location", title: "City" });
      const district = await createObject(tx, { type: "location", title: "District" });
      await insertEdge(tx, "contains", country, city);
      await insertEdge(tx, "contains", city, district);
      await expectPgError(insertEdge(tx, "contains", district, country), PG.check, /cycle/);
    });
  });
});

describe("edge integrity", () => {
  it("rejects a self edge", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "note" });
      await expectPgError(insertEdge(tx, "references", a, a), PG.check);
    });
  });

  it("rejects a duplicate live edge but allows the same pair under another kind", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task" });
      const b = await createObject(tx, { type: "task" });
      await insertEdge(tx, "depends_on", a, b);
      await expectPgError(insertEdge(tx, "depends_on", a, b), PG.unique);
    });
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task" });
      const b = await createObject(tx, { type: "task" });
      await insertEdge(tx, "depends_on", a, b);
      await insertEdge(tx, "references", a, b);
    });
  });

  it("frees the slot when an edge is soft-deleted, so it can be re-created", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task" });
      const b = await createObject(tx, { type: "task" });
      const id = await insertEdge(tx, "depends_on", a, b);
      await tx.exec(`update public.edges set deleted_at = now() where id = '${id}'`);
      await insertEdge(tx, "depends_on", a, b);
    });
  });

  it("enforces a single parent for contains", async () => {
    await inRollback(db, async (tx) => {
      const p1 = await createObject(tx, { type: "project" });
      const p2 = await createObject(tx, { type: "project" });
      const t = await createObject(tx, { type: "task" });
      await insertEdge(tx, "contains", p1, t);
      await expectPgError(insertEdge(tx, "contains", p2, t), PG.unique);
    });
  });

  it("allows many predecessors for depends_on (only contains is single-parent)", async () => {
    await inRollback(db, async (tx) => {
      const t = await createObject(tx, { type: "task" });
      const x = await createObject(tx, { type: "task" });
      const y = await createObject(tx, { type: "task" });
      await insertEdge(tx, "depends_on", t, x);
      await insertEdge(tx, "depends_on", t, y);
    });
  });

  it("requires dependency type and lag on depends_on, and forbids them elsewhere", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task" });
      const b = await createObject(tx, { type: "task" });
      await expectPgError(
        tx.exec(
          `insert into public.edges (kind, from_id, to_id, owner_id) values ('depends_on', '${a}', '${b}', '${OWNER}')`,
        ),
        PG.check,
      );
    });
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task" });
      const b = await createObject(tx, { type: "task" });
      await expectPgError(
        tx.exec(
          `insert into public.edges (kind, from_id, to_id, owner_id, lag_days)
           values ('references', '${a}', '${b}', '${OWNER}', 3)`,
        ),
        PG.check,
      );
    });
  });

  it("stores lead (negative lag) on a dependency", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "milestone" });
      const b = await createObject(tx, { type: "milestone" });
      await tx.exec(
        `insert into public.edges (kind, from_id, to_id, owner_id, dependency_type, lag_days)
         values ('depends_on', '${a}', '${b}', '${OWNER}', 'fs', -14)`,
      );
    });
  });

  it("never lets an edge cross owners", async () => {
    await inRollback(db, async (tx) => {
      const mine = await createObject(tx, { type: "task" });
      const theirs = await createObject(tx, { type: "task", owner: OTHER });
      await expectPgError(insertEdge(tx, "references", mine, theirs), PG.check, /cross owners/);
    });
  });

  it("refuses to relate a soft-deleted object", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task" });
      const b = await createObject(tx, { type: "task" });
      await tx.exec(`update public.objects set deleted_at = now() where id = '${b}'`);
      await expectPgError(insertEdge(tx, "depends_on", a, b), PG.check, /deleted/);
    });
  });
});

describe("cycle prevention (contains and depends_on are acyclic)", () => {
  it("rejects a direct depends_on cycle", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task" });
      const b = await createObject(tx, { type: "task" });
      await insertEdge(tx, "depends_on", a, b);
      await expectPgError(insertEdge(tx, "depends_on", b, a), PG.check, /cycle/);
    });
  });

  it("rejects a transitive depends_on cycle", async () => {
    await inRollback(db, async (tx) => {
      const [a, b, c] = [
        await createObject(tx, { type: "milestone" }),
        await createObject(tx, { type: "milestone" }),
        await createObject(tx, { type: "milestone" }),
      ] as [string, string, string];
      await insertEdge(tx, "depends_on", a, b);
      await insertEdge(tx, "depends_on", b, c);
      await expectPgError(insertEdge(tx, "depends_on", c, a), PG.check, /cycle/);
    });
  });

  it("rejects a contains cycle among sub-projects", async () => {
    await inRollback(db, async (tx) => {
      const s1 = await createObject(tx, { type: "sub_project" });
      const s2 = await createObject(tx, { type: "sub_project" });
      const s3 = await createObject(tx, { type: "sub_project" });
      await insertEdge(tx, "contains", s1, s2);
      await insertEdge(tx, "contains", s2, s3);
      await expectPgError(insertEdge(tx, "contains", s3, s1), PG.check, /cycle/);
    });
  });

  it("stops a project being contained by anything (projects are roots)", async () => {
    await inRollback(db, async (tx) => {
      const p = await createObject(tx, { type: "project" });
      const s = await createObject(tx, { type: "sub_project" });
      await expectPgError(insertEdge(tx, "contains", s, p), PG.check, /cannot/);
    });
  });

  it("allows a diamond (two routes to the same node)", async () => {
    await inRollback(db, async (tx) => {
      const [a, b, c, d] = [
        await createObject(tx, { type: "task" }),
        await createObject(tx, { type: "task" }),
        await createObject(tx, { type: "task" }),
        await createObject(tx, { type: "task" }),
      ] as [string, string, string, string];
      await insertEdge(tx, "depends_on", a, b);
      await insertEdge(tx, "depends_on", a, c);
      await insertEdge(tx, "depends_on", b, d);
      await insertEdge(tx, "depends_on", c, d);
    });
  });

  it("allows a references loop (soft links are not acyclic)", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "note" });
      const b = await createObject(tx, { type: "note" });
      await insertEdge(tx, "references", a, b);
      await insertEdge(tx, "references", b, a);
    });
  });

  it("does not let a soft-deleted edge block a later, otherwise-cyclic-looking edge", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task" });
      const b = await createObject(tx, { type: "task" });
      const id = await insertEdge(tx, "depends_on", a, b);
      await tx.exec(`update public.edges set deleted_at = now() where id = '${id}'`);
      await insertEdge(tx, "depends_on", b, a);
    });
  });

  it("re-validates when a soft-deleted edge is restored", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task" });
      const b = await createObject(tx, { type: "task" });
      const id = await insertEdge(tx, "depends_on", a, b);
      await tx.exec(`update public.edges set deleted_at = now() where id = '${id}'`);
      await insertEdge(tx, "depends_on", b, a);
      await expectPgError(
        tx.exec(`update public.edges set deleted_at = null where id = '${id}'`),
        PG.check,
        /cycle/,
      );
    });
  });
});

describe("soft deletion", () => {
  it("soft-deletes an object's live edges with it", async () => {
    await inRollback(db, async (tx) => {
      const p = await createObject(tx, { type: "project" });
      const t = await createObject(tx, { type: "task" });
      const n = await createObject(tx, { type: "note" });
      await insertEdge(tx, "contains", p, t);
      await insertEdge(tx, "references", n, t);
      await tx.exec(`update public.objects set deleted_at = now() where id = '${t}'`);
      const { rows } = await tx.query<{ live: number }>(
        "select count(*)::int as live from public.edges where deleted_at is null",
      );
      expect(rows[0]?.live).toBe(0);
    });
  });

  it("does not resurrect edges when the object is restored", async () => {
    await inRollback(db, async (tx) => {
      const p = await createObject(tx, { type: "project" });
      const t = await createObject(tx, { type: "task" });
      await insertEdge(tx, "contains", p, t);
      await tx.exec(`update public.objects set deleted_at = now() where id = '${t}'`);
      await tx.exec(`update public.objects set deleted_at = null where id = '${t}'`);
      const { rows } = await tx.query<{ live: number }>(
        "select count(*)::int as live from public.edges where deleted_at is null",
      );
      expect(rows[0]?.live).toBe(0);
    });
  });

  it("hard-deleting an object removes its edges", async () => {
    await inRollback(db, async (tx) => {
      const a = await createObject(tx, { type: "task" });
      const b = await createObject(tx, { type: "task" });
      await insertEdge(tx, "depends_on", a, b);
      await tx.exec(`delete from public.objects where id = '${b}'`);
      const { rows } = await tx.query("select 1 from public.edges");
      expect(rows).toHaveLength(0);
    });
  });
});

describe("the worked example: a chain that sets the move date", () => {
  it("can express the blueprint's cause -> effect chain with only the six edge kinds", async () => {
    await inRollback(db, async (tx) => {
      const prop = await createObject(tx, { type: "property", title: "Marina 1BR" });
      const equity = await createObject(tx, { type: "estimate", title: "Equity" });
      const savings = await createObject(tx, { type: "estimate", title: "Savings rate" });
      const income = await createObject(tx, { type: "estimate", title: "Income" });
      const purchase = await createObject(tx, { type: "milestone", title: "Purchase" });
      const relocation = await createObject(tx, { type: "milestone", title: "Relocation" });

      await insertEdge(tx, "funded_by", prop, equity);
      await insertEdge(tx, "depends_on", equity, savings);
      await insertEdge(tx, "depends_on", savings, income);
      await insertEdge(tx, "depends_on", purchase, equity);
      // The blueprint's "influences" is modelled as depends_on: relocation follows purchase.
      await insertEdge(tx, "depends_on", relocation, purchase);

      const { rows } = await tx.query<{ n: number }>(
        "select count(*)::int as n from public.edges where deleted_at is null",
      );
      expect(rows[0]?.n).toBe(5);
    });
  });
});
