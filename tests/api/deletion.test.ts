import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as deleteRoute from "@/app/api/objects/delete-many/route";
import * as purgeRoute from "@/app/api/objects/purge-many/route";
import * as restoreRoute from "@/app/api/objects/restore-many/route";
import * as one from "@/app/api/objects/[id]/route";
import * as collection from "@/app/api/objects/route";
import * as edgesRoute from "@/app/api/edges/route";
import * as graphRoute from "@/app/api/graph/route";
import * as progressRoute from "@/app/api/progress/route";
import { planDeletion } from "@/domain/deletion";
import { createApiHarness, call, type ApiHarness } from "../support/pglite-db";

/** Throw-away in-memory database only: nothing here touches anyone's data. */
let h: ApiHarness;
beforeAll(async () => {
  h = await createApiHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

const DETAILS: Record<string, unknown> = {
  plan: {},
  project: {},
  sub_project: {},
  task: {},
  milestone: {},
  decision: {},
  risk: { probability: 3, impact: 4 },
  note: {},
  document: { mime: "application/pdf", storagePath: "u/doc.pdf", sizeBytes: 12 },
  estimate: { amount: 100, currency: "EUR" },
};

async function make(user: string, type: string, title = `A ${type}`) {
  const res = await call(collection.POST, "POST", "/api/objects", {
    user,
    body: { type, title, details: DETAILS[type] ?? {} },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}
const link = async (user: string, kind: string, from: string, to: string) => {
  const res = await call(edgesRoute.POST, "POST", "/api/edges", { user, body: { kind, from, to } });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};
const graph = async (user: string) =>
  (await call(graphRoute.GET, "GET", "/api/graph?details=true", { user })).body as {
    nodes: { id: string; type: string; title: string; details?: Record<string, unknown> }[];
    edges: {
      id: string;
      kind: string;
      from: string;
      to: string;
      createdAt: string;
      label: null;
      dependencyType: null;
      lagDays: null;
    }[];
  };
const del = (user: string, body: unknown) =>
  call(deleteRoute.POST, "POST", "/api/objects/delete-many", { user, body });
const restore = (user: string, body: unknown) =>
  call(restoreRoute.POST, "POST", "/api/objects/restore-many", { user, body });
const purge = (user: string, body: unknown) =>
  call(purgeRoute.POST, "POST", "/api/objects/purge-many", { user, body });

/** Raw rows: no live edge may touch a deleted object, and nothing live may be left behind. */
async function orphanEdges(): Promise<number> {
  const rows = await h.pg.query<{ n: number }>(
    `select count(*)::int as n from public.edges e
       left join public.objects f on f.id = e.from_id
       left join public.objects t on t.id = e.to_id
      where e.deleted_at is null
        and (f.id is null or t.id is null or f.deleted_at is not null or t.deleted_at is not null)`,
  );
  return rows.rows[0]!.n;
}

describe("deleting one object of every kind", () => {
  it.each(Object.keys(DETAILS))("deletes a lone %s at once and brings it back", async (type) => {
    const user = h.newUser();
    const id = await make(user, type);
    const other = await make(user, "note", "Linked note");
    await link(user, "references", other, id); // something points at it

    const res = await del(user, { ids: [id] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.objectIds).toEqual([id]);
    expect(res.body.edgeIds).toHaveLength(1);

    const g = await graph(user);
    expect(g.nodes.some((n) => n.id === id)).toBe(false);
    expect(g.edges.some((e) => e.from === id || e.to === id)).toBe(false);
    expect(await orphanEdges()).toBe(0);
    expect((await call(one.GET, "GET", `/api/objects/${id}`, { user, id })).status).toBe(404);

    const back = await restore(user, res.body);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const after = await graph(user);
    expect(after.nodes.some((n) => n.id === id)).toBe(true);
    expect(after.edges.some((e) => e.from === other && e.to === id)).toBe(true);
    expect(await orphanEdges()).toBe(0);
  });
});

describe("a project and everything in it", () => {
  async function build(user: string) {
    const plan = await make(user, "plan");
    const project = await make(user, "project");
    const sub = await make(user, "sub_project");
    const task = await make(user, "task");
    const deep = await make(user, "task", "Deep task");
    const milestone = await make(user, "milestone");
    const note = await make(user, "note", "Only about the project");
    const shared = await make(user, "note", "About two projects");
    const doc = await make(user, "document");
    const budget = await make(user, "estimate");
    const sibling = await make(user, "project", "Another project");
    await link(user, "contains", plan, project);
    await link(user, "contains", project, sub);
    await link(user, "contains", project, task);
    await link(user, "contains", sub, deep);
    await link(user, "contains", project, milestone);
    await link(user, "references", note, project);
    await link(user, "references", shared, project);
    await link(user, "references", shared, sibling);
    await link(user, "references", doc, project);
    await link(user, "estimates", budget, project);
    await link(user, "depends_on", sibling, project).catch(() => undefined);
    return { plan, project, sub, task, deep, milestone, note, shared, doc, budget, sibling };
  }

  it("counts what goes with it, then deletes it all in one step and undoes it exactly", async () => {
    const user = h.newUser();
    const x = await build(user);
    const before = await graph(user);
    const plan = planDeletion(before.nodes as never, before.edges as never, x.project)!;
    expect(plan.counts).toMatchObject({
      subProjects: 1,
      tasks: 2,
      milestones: 1,
      notes: 1,
      documents: 1,
      budgets: 1,
    });
    // the note about two projects stays
    expect(plan.all).not.toContain(x.shared);
    expect(plan.all).not.toContain(x.sibling);
    expect(plan.all).not.toContain(x.plan);

    const res = await del(user, { ids: plan.all });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const g = await graph(user);
    const remaining = g.nodes.map((n) => n.id).sort();
    expect(remaining).toEqual([x.plan, x.shared, x.sibling].sort());
    expect(await orphanEdges()).toBe(0);

    await restore(user, res.body);
    const after = await graph(user);
    expect(after.nodes.map((n) => n.id).sort()).toEqual(before.nodes.map((n) => n.id).sort());
    const key = (e: { kind: string; from: string; to: string }) => `${e.kind}:${e.from}>${e.to}`;
    expect(after.edges.map(key).sort()).toEqual(before.edges.map(key).sort());
    expect(await orphanEdges()).toBe(0);
  });

  it("deletes only the project and keeps its children under the parent that can hold them", async () => {
    const user = h.newUser();
    const parent = await make(user, "project", "Parent");
    const mid = await make(user, "sub_project", "Middle");
    const sub = await make(user, "sub_project", "Sub");
    const task = await make(user, "task");
    const note = await make(user, "note");
    await link(user, "contains", parent, mid);
    await link(user, "contains", mid, sub);
    await link(user, "contains", mid, task);
    await link(user, "references", note, mid);
    const before = await graph(user);
    const plan = planDeletion(before.nodes as never, before.edges as never, mid)!;
    expect(plan.canKeepChildren).toBe(true);

    const res = await del(user, { ids: plan.keep.ids, reattach: plan.keep.reattach });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.addedEdgeIds).toHaveLength(plan.keep.reattach.length);
    const g = await graph(user);
    expect(g.nodes.some((n) => n.id === mid)).toBe(false);
    for (const child of [sub, task])
      expect(
        g.edges.some((e) => e.kind === "contains" && e.from === parent && e.to === child),
      ).toBe(true);
    expect(g.edges.some((e) => e.kind === "references" && e.from === note && e.to === parent)).toBe(
      true,
    );
    expect(await orphanEdges()).toBe(0);

    // undoing puts the old structure back: the middle level again, the re-attached edges gone
    await restore(user, res.body);
    const after = await graph(user);
    const key = (e: { kind: string; from: string; to: string }) => `${e.kind}:${e.from}>${e.to}`;
    expect(after.edges.map(key).sort()).toEqual(before.edges.map(key).sort());
    expect(await orphanEdges()).toBe(0);
  });

  it("deletes a plan and leaves its projects standing on their own", async () => {
    const user = h.newUser();
    const plan = await make(user, "plan");
    const a = await make(user, "project", "A");
    const b = await make(user, "project", "B");
    await link(user, "contains", plan, a);
    await link(user, "contains", plan, b);
    const g0 = await graph(user);
    const p = planDeletion(g0.nodes as never, g0.edges as never, plan)!;
    expect(p.counts.projects).toBe(2);
    expect(p.canKeepChildren).toBe(true);
    const res = await del(user, { ids: p.keep.ids, reattach: p.keep.reattach });
    expect(res.status).toBe(200);
    const g = await graph(user);
    expect(g.nodes.map((n) => n.id).sort()).toEqual([a, b].sort());
    expect(g.edges.filter((e) => e.kind === "contains")).toHaveLength(0);
  });

  it("refuses an object that is not there, and a second deletion", async () => {
    const user = h.newUser();
    const id = await make(user, "task");
    expect((await del(user, { ids: [id] })).status).toBe(200);
    expect((await del(user, { ids: [id] })).status).toBe(404);
    expect((await del(user, { ids: [] })).status).toBe(400);
    // someone else's object is invisible
    const mine = await make(user, "task");
    expect((await del(h.newUser(), { ids: [mine] })).status).toBe(404);
  });
});

describe("making a deletion final", () => {
  it("frees the bytes of a document, its journal entries and its rows, and cannot be undone", async () => {
    const user = h.newUser();
    const owner = user;
    const upload = await h.pg.query(
      `insert into public.document_files (owner_id, storage_path, mime, size_bytes, checksum, bytes)
       values ($1, 'u/final.pdf', 'application/pdf', 3, 'x', $2) returning storage_path`,
      [owner, new Uint8Array([1, 2, 3])],
    );
    expect(upload.rows).toHaveLength(1);
    const doc = await call(collection.POST, "POST", "/api/objects", {
      user,
      body: {
        type: "document",
        title: "Final doc",
        details: { mime: "application/pdf", storagePath: "u/final.pdf", sizeBytes: 3 },
      },
    });
    const id = doc.body.id as string;
    expect(
      (await h.pg.query("select 1 from public.progress_log where object_id = $1", [id])).rows
        .length,
    ).toBeGreaterThan(0);

    const res = await del(user, { ids: [id] });
    expect(res.body.documents).toEqual([{ id, storagePath: "u/final.pdf" }]);
    // still restorable, and its file is still there during the undo delay
    expect(
      (await h.pg.query("select 1 from public.document_files where storage_path = 'u/final.pdf'"))
        .rows,
    ).toHaveLength(1);
    // the journal no longer shows it
    const journal = await call(progressRoute.GET, "GET", "/api/progress?days=30", { user });
    expect(journal.body.some((p: { objectId: string | null }) => p.objectId === id)).toBe(false);

    expect((await purge(user, { ids: [id] })).body).toEqual({ purged: 1 });
    expect(
      (await h.pg.query("select 1 from public.document_files where storage_path = 'u/final.pdf'"))
        .rows,
    ).toHaveLength(0);
    expect(
      (await h.pg.query("select 1 from public.objects where id = $1", [id])).rows,
    ).toHaveLength(0);
    expect(
      (await h.pg.query("select 1 from public.progress_log where object_id = $1", [id])).rows,
    ).toHaveLength(0);
    expect((await restore(user, res.body)).status).toBe(409);
    expect(await orphanEdges()).toBe(0);
  });

  it("never purges a live object, and frees stale deleted documents on request", async () => {
    const user = h.newUser();
    const live = await make(user, "document");
    expect((await purge(user, { ids: [live] })).body).toEqual({ purged: 0 });
    expect((await call(one.GET, "GET", `/api/objects/${live}`, { user, id: live })).status).toBe(
      200,
    );

    const old = await make(user, "document", "Old deleted doc");
    await del(user, { ids: [old] });
    expect((await purge(user, { staleDocuments: true })).body).toEqual({ purged: 0 }); // just now
    await h.pg.query(
      "update public.objects set deleted_at = now() - interval '30 minutes' where id = $1",
      [old],
    );
    expect((await purge(user, { staleDocuments: true })).body).toEqual({ purged: 1 });
  });
});
