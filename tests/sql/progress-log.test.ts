import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OTHER,
  OWNER,
  asUser,
  createMigratedDb,
  createObject,
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

type Tx = Parameters<typeof asUser>[0];

interface Row {
  kind: string;
  project_id: string | null;
  object_id: string | null;
  day: string;
}

const journal = async (tx: Tx): Promise<Row[]> => {
  const { rows } = await tx.query<Row>(
    `select kind, project_id, object_id, day::text as day from public.progress_log order by id`,
  );
  return rows;
};

describe("the progress journal", () => {
  it("records a finished task against its project, once, when it becomes done", async () => {
    await inRollback(db, async (tx) => {
      const project = await createObject(tx, { type: "project" });
      const sub = await createObject(tx, { type: "sub_project" });
      const task = await createObject(tx, { type: "task", status: "active" });
      await insertEdge(tx, "contains", project, sub);
      await insertEdge(tx, "contains", sub, task);
      expect(await journal(tx)).toEqual([]);

      await tx.exec(`update public.objects set status = 'done' where id = '${task}'`);
      // Touching it again without changing the status is not new progress.
      await tx.exec(`update public.objects set title = 'renamed' where id = '${task}'`);

      const rows = await journal(tx);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "task_done", project_id: project, object_id: task });
    });
  });

  it("records a note and a file, and fills in their project once they are attached", async () => {
    await inRollback(db, async (tx) => {
      const project = await createObject(tx, { type: "project" });
      const note = await createObject(tx, { type: "note" });
      const doc = await createObject(tx, { type: "document" });
      expect((await journal(tx)).map((r) => [r.kind, r.project_id])).toEqual([
        ["note_created", null],
        ["file_added", null],
      ]);

      await insertEdge(tx, "references", note, project);
      await insertEdge(tx, "references", project, doc);
      expect((await journal(tx)).map((r) => [r.kind, r.project_id])).toEqual([
        ["note_created", project],
        ["file_added", project],
      ]);
      expect((await journal(tx))[0]?.object_id).toBe(note);
    });
  });

  it("is readable only by its owner", async () => {
    await inRollback(db, async (tx) => {
      await createObject(tx, { type: "note", owner: OTHER });
      await createObject(tx, { type: "note" });
      await asUser(tx, OWNER);
      expect(await journal(tx)).toHaveLength(1);
      await asUser(tx, OTHER);
      expect(await journal(tx)).toHaveLength(1);
    });
  });

  it("cannot be written by the user", async () => {
    await inRollback(db, async (tx) => {
      await asUser(tx, OWNER);
      await expect(
        tx.exec(
          `insert into public.progress_log (kind, owner_id) values ('task_done', '${OWNER}')`,
        ),
      ).rejects.toThrow();
    });
  });
});
