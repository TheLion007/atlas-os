import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as convertRoute from "@/app/api/objects/[id]/convert/route";
import * as one from "@/app/api/objects/[id]/route";
import * as collection from "@/app/api/objects/route";
import * as edges from "@/app/api/edges/route";
import { EDGE_KINDS, OBJECT_TYPES } from "@/domain/enums";
import { asOwner } from "@/server/db/types";
import { createApiHarness, call, type ApiHarness } from "../support/pglite-db";

let h: ApiHarness;
beforeAll(async () => {
  h = await createApiHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

const create = (user: string, body: unknown) =>
  call(collection.POST, "POST", "/api/objects", { user, body });
const read = (user: string, id: string, query = "") =>
  call(one.GET, "GET", `/api/objects/${id}${query}`, { user, id });
const list = (user: string, query = "") =>
  call(collection.GET, "GET", `/api/objects${query}`, { user });

/** Minimal valid body for each object type. */
const MINIMAL: Record<string, unknown> = {
  plan: {},
  project: {},
  sub_project: {},
  task: {},
  milestone: {},
  scenario: { variant: "base" },
  estimate: { amount: 100, currency: "EUR" },
  location: {},
  property: {},
  decision: {},
  risk: { probability: 3, impact: 4 },
  note: {},
  document: { mime: "application/pdf" },
  person: {},
  event: { startsAt: "2027-03-01T10:00:00Z" },
  memory: {},
  transaction: { date: "2026-09-01", amount: 42.5, currency: "EUR" },
};

describe("creating and reading every object type", () => {
  it("covers all 17 types", () => {
    expect(Object.keys(MINIMAL).sort()).toEqual([...OBJECT_TYPES].sort());
  });

  it.each(OBJECT_TYPES)("creates and reads back a %s", async (type) => {
    const user = h.newUser();
    const res = await create(user, { type, title: `A ${type}`, details: MINIMAL[type] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers.get("location")).toBe(`/api/objects/${res.body.id}`);

    const got = await read(user, res.body.id);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ id: res.body.id, type, title: `A ${type}`, status: "active" });
    expect(typeof got.body.createdAt).toBe("string");
    expect(got.body.details).toBeTypeOf("object");
    expect(got.body.details).not.toHaveProperty("ownerId");
    expect(got.body.details).not.toHaveProperty("type");
  });

  it("round-trips typed values (numbers stay numbers, dates stay dates, jsonb stays structured)", async () => {
    const user = h.newUser();
    const est = await create(user, {
      type: "estimate",
      title: "Equity",
      confidence: 40,
      tags: ["capital", "dorsel"],
      details: {
        amount: 109400.5,
        currency: "EUR",
        category: "capital",
        dataKind: "target",
        source: "illustrative",
        asOf: "2026-09-21",
      },
    });
    expect(est.body.confidence).toBe(40);
    expect(est.body.tags).toEqual(["capital", "dorsel"]);
    expect(est.body.details).toMatchObject({
      amount: 109400.5,
      currency: "EUR",
      dataKind: "target",
      asOf: "2026-09-21",
      scenarioId: null,
    });

    const ms = await create(user, {
      type: "milestone",
      title: "Purchase",
      details: { date: "2031-06-30", gateCriteria: [{ text: "Financing approved", met: false }] },
    });
    expect(ms.body.details.date).toBe("2031-06-30");
    expect(ms.body.details.gateCriteria).toEqual([{ text: "Financing approved", met: false }]);

    const evt = await create(user, {
      type: "event",
      title: "Viewing trip",
      details: { startsAt: "2027-03-01T10:00:00Z", kind: "trip" },
    });
    expect(new Date(evt.body.details.startsAt).toISOString()).toBe("2027-03-01T10:00:00.000Z");
  });

  it("stores tags containing quotes, commas and backslashes intact", async () => {
    const user = h.newUser();
    const tags = ['say "hi"', "a,b", "back\\slash", "{braces}"];
    const res = await create(user, { type: "note", title: "tricky", tags, details: {} });
    expect(res.body.tags).toEqual(tags);
  });
});

describe("project creation with a location (blueprint flow, any country)", () => {
  it("creates a project in Dorsel and one in Borland with identical machinery", async () => {
    const user = h.newUser();
    const places = [
      { title: "Dorsel Marina", countryCode: "AE", city: "Dorsel", lat: 25.0805, lng: 55.1403 },
      { title: "Ironfield", countryCode: "BE", city: "Bremont", lat: 50.8333, lng: 4.3667 },
    ];
    for (const p of places) {
      const loc = await create(user, {
        type: "location",
        title: p.title,
        details: {
          level: "district",
          countryCode: p.countryCode,
          city: p.city,
          district: p.title,
          lat: p.lat,
          lng: p.lng,
          coordinatesSource: "manual",
        },
      });
      expect(loc.status).toBe(201);

      const proj = await create(user, {
        type: "project",
        title: `Apartment in ${p.title}`,
        details: {
          description: "Illustrative",
          priority: 1,
          startDate: "2026-10-01",
          targetDate: "2031-06-30",
          budgetAmount: 420000,
          budgetCurrency: "EUR",
        },
        tags: ["property"],
        relations: [{ kind: "located_at", other: loc.body.id }],
      });
      expect(proj.status, JSON.stringify(proj.body)).toBe(201);

      // It is immediately available: in Projects, with its place (Map) and edges (Graph).
      const projects = await list(user, "?type=project");
      expect(projects.body.items.map((i: { id: string }) => i.id)).toContain(proj.body.id);
      const located = proj.body.relations.located_at.outgoing;
      expect(located).toHaveLength(1);
      expect(located[0].object).toMatchObject({
        id: loc.body.id,
        type: "location",
        title: p.title,
      });

      const back = await read(user, loc.body.id, "?expand=relations");
      expect(back.body.relations.located_at.incoming[0].object.id).toBe(proj.body.id);
      expect(back.body.details).toMatchObject({
        countryCode: p.countryCode,
        lat: p.lat,
        lng: p.lng,
      });
    }
  });

  it("builds a project → task hierarchy with contains, in one call", async () => {
    const user = h.newUser();
    const project = await create(user, { type: "project", title: "P", details: {} });
    const task = await create(user, {
      type: "task",
      title: "Book viewing",
      details: { due: "2026-11-01", effort: 2 },
      relations: [{ kind: "contains", direction: "in", other: project.body.id }],
    });
    expect(task.status).toBe(201);
    expect(task.body.relations.contains.incoming[0].object.id).toBe(project.body.id);
    const parent = await read(user, project.body.id, "?expand=relations");
    expect(parent.body.relations.contains.outgoing.map((r: any) => r.object.id)).toEqual([
      task.body.id,
    ]);
  });
});

describe("validation", () => {
  it.each([
    ["a missing title", { type: "task", details: {} }],
    ["an unknown type", { type: "widget", title: "x", details: {} }],
    [
      "a sub-project budget",
      { type: "sub_project", title: "s", details: { budgetAmount: 1, budgetCurrency: "EUR" } },
    ],
    [
      "a monetary estimate without currency",
      { type: "estimate", title: "e", details: { amount: 5 } },
    ],
    ["a half-specified coordinate", { type: "location", title: "l", details: { lat: 12 } }],
    [
      "a closed decision without a rationale",
      { type: "decision", title: "d", status: "done", details: {} },
    ],
    ["an out-of-range risk", { type: "risk", title: "r", details: { probability: 9, impact: 1 } }],
  ])("rejects %s with 400 and issues", async (_name, body) => {
    const res = await create(h.newUser(), body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation");
    expect(Array.isArray(res.body.error.issues)).toBe(true);
  });

  it("rejects malformed JSON and non-object bodies", async () => {
    const user = h.newUser();
    const bad = await call(collection.POST, "POST", "/api/objects", { user, rawBody: "{nope" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_json");
    const arr = await create(user, [1, 2]);
    expect(arr.status).toBe(400);
  });

  it("does not persist derived values even if the client sends them", async () => {
    const user = h.newUser();
    const res = await create(user, {
      type: "project",
      title: "P",
      details: { progress: 0.9, riskLevel: "high" },
    });
    expect(res.status).toBe(201);
    expect(res.body.details).not.toHaveProperty("progress");
    expect(res.body.details).not.toHaveProperty("riskLevel");
  });

  it("refuses a relation the type rules forbid and creates nothing (atomic)", async () => {
    const user = h.newUser();
    const t1 = await create(user, { type: "task", title: "t1", details: {} });
    const before = (await list(user)).body.total;
    const res = await create(user, {
      type: "task",
      title: "t2",
      details: {},
      relations: [{ kind: "contains", direction: "in", other: t1.body.id }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/cannot/);
    expect((await list(user)).body.total).toBe(before);
  });

  it("refuses a relation to something that does not exist, atomically", async () => {
    const user = h.newUser();
    const res = await create(user, {
      type: "task",
      title: "orphan",
      details: {},
      relations: [{ kind: "references", other: "11111111-1111-4111-8111-111111111111" }],
    });
    expect(res.status).toBe(422);
    expect((await list(user)).body.total).toBe(0);
  });
});

describe("isolation between owners", () => {
  it("never reveals another owner's objects (404, list, relations)", async () => {
    const alice = h.newUser();
    const bob = h.newUser();
    const secret = await create(alice, { type: "project", title: "Alice's plan", details: {} });

    expect((await read(bob, secret.body.id)).status).toBe(404);
    expect((await list(bob)).body.items).toEqual([]);
    expect(
      (
        await call(one.PATCH, "PATCH", `/api/objects/${secret.body.id}`, {
          user: bob,
          id: secret.body.id,
          body: { title: "x" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(one.DELETE, "DELETE", `/api/objects/${secret.body.id}`, {
          user: bob,
          id: secret.body.id,
        })
      ).status,
    ).toBe(404);
    expect((await read(alice, secret.body.id)).body.title).toBe("Alice's plan");
  });

  it("will not let one owner attach to another owner's object", async () => {
    const alice = h.newUser();
    const bob = h.newUser();
    const theirs = await create(alice, { type: "project", title: "theirs", details: {} });
    const res = await create(bob, {
      type: "task",
      title: "sneaky",
      details: {},
      relations: [{ kind: "references", other: theirs.body.id }],
    });
    expect(res.status).toBe(422);
  });

  it("runs every request as the authenticated role with the owner's id (RLS is live)", async () => {
    const user = h.newUser();
    const seen = await asOwner(h.db, user, async (tx) => {
      const rows = await tx.query<{ role: string; uid: string }>(
        "select current_user as role, auth.uid()::text as uid",
      );
      return rows[0];
    });
    expect(seen).toEqual({ role: "authenticated", uid: user });
  });
});

describe("listing", () => {
  it("filters by type and status, paginates, and reports the total", async () => {
    const user = h.newUser();
    for (let i = 0; i < 5; i++)
      await create(user, { type: "task", title: `task ${i}`, details: {} });
    await create(user, { type: "task", title: "done one", status: "done", details: {} });
    await create(user, { type: "note", title: "a note", details: {} });

    const all = await list(user);
    expect(all.body.total).toBe(7);
    expect(all.body.items[0]).not.toHaveProperty("details");

    const tasks = await list(user, "?type=task");
    expect(tasks.body.total).toBe(6);
    expect(tasks.body.items[0]).toHaveProperty("details");

    const doneTasks = await list(user, "?type=task&status=done");
    expect(doneTasks.body.items.map((i: any) => i.title)).toEqual(["done one"]);

    const page1 = await list(user, "?type=task&limit=4&offset=0");
    const page2 = await list(user, "?type=task&limit=4&offset=4");
    expect(page1.body.items).toHaveLength(4);
    expect(page2.body.items).toHaveLength(2);
    expect(page1.body.total).toBe(6);
    const ids = [...page1.body.items, ...page2.body.items].map((i: any) => i.id);
    expect(new Set(ids).size).toBe(6);
  });

  it("rejects bad query parameters", async () => {
    const user = h.newUser();
    expect((await list(user, "?type=widget")).status).toBe(400);
    expect((await list(user, "?limit=0")).status).toBe(400);
    expect((await list(user, "?limit=9999")).status).toBe(400);
  });
});

describe("relations expand, grouped by verb", () => {
  it("returns every verb with outgoing and incoming, including backlinks", async () => {
    const user = h.newUser();
    const project = await create(user, { type: "project", title: "P", details: {} });
    const note = await create(user, {
      type: "note",
      title: "Research",
      details: {},
      relations: [{ kind: "references", other: project.body.id, label: "background" }],
    });
    const res = await read(user, project.body.id, "?expand=relations");
    expect(Object.keys(res.body.relations).sort()).toEqual([...EDGE_KINDS].sort());
    const backlink = res.body.relations.references.incoming[0];
    expect(backlink.object.id).toBe(note.body.id);
    expect(backlink.label).toBe("background");
    expect(res.body.relations.contains.outgoing).toEqual([]);

    const plain = await read(user, project.body.id);
    expect(plain.body).not.toHaveProperty("relations");
  });

  it("carries dependency type and lag on depends_on", async () => {
    const user = h.newUser();
    const a = await create(user, { type: "milestone", title: "Purchase", details: {} });
    const b = await create(user, {
      type: "milestone",
      title: "Relocation",
      details: {},
      relations: [{ kind: "depends_on", other: a.body.id, lagDays: 30 }],
    });
    const dep = b.body.relations.depends_on.outgoing[0];
    expect(dep).toMatchObject({ dependencyType: "fs", lagDays: 30 });
    expect(dep.object.id).toBe(a.body.id);
  });
});

describe("updating", () => {
  it("merges a partial patch and keeps everything else", async () => {
    const user = h.newUser();
    const created = await create(user, {
      type: "project",
      title: "Old",
      tags: ["a"],
      details: { description: "keep me", priority: 3, budgetAmount: 10, budgetCurrency: "EUR" },
    });
    const res = await call(one.PATCH, "PATCH", `/api/objects/${created.body.id}`, {
      user,
      id: created.body.id,
      body: { title: "New", details: { priority: 1 } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ title: "New", tags: ["a"], status: "active" });
    expect(res.body.details).toMatchObject({
      description: "keep me",
      priority: 1,
      budgetAmount: 10,
    });
    expect(res.body.updatedAt >= created.body.updatedAt).toBe(true);
  });

  it("re-validates the merged whole, so cross-field rules still hold", async () => {
    const user = h.newUser();
    const sub = await create(user, { type: "sub_project", title: "S", details: {} });
    const res = await call(one.PATCH, "PATCH", `/api/objects/${sub.body.id}`, {
      user,
      id: sub.body.id,
      body: { details: { budgetAmount: 5, budgetCurrency: "EUR" } },
    });
    expect(res.status).toBe(400);
    const after = await read(user, sub.body.id);
    expect(after.body.details.budgetAmount).toBeNull();
  });

  it("refuses to change the type and rejects unknown fields", async () => {
    const user = h.newUser();
    const t = await create(user, { type: "task", title: "t", details: {} });
    const patch = (body: unknown) =>
      call(one.PATCH, "PATCH", `/api/objects/${t.body.id}`, { user, id: t.body.id, body });
    expect((await patch({ type: "project" })).status).toBe(400);
    expect((await patch({ ownerId: "x" })).status).toBe(400);
  });

  it("clears confidence with an explicit null", async () => {
    const user = h.newUser();
    const e = await create(user, {
      type: "estimate",
      title: "e",
      confidence: 60,
      details: { amount: 1, currency: "EUR" },
    });
    const res = await call(one.PATCH, "PATCH", `/api/objects/${e.body.id}`, {
      user,
      id: e.body.id,
      body: { confidence: null },
    });
    expect(res.body.confidence).toBeNull();
  });

  it("keeps the search index in step with edits", async () => {
    const user = h.newUser();
    const p = await create(user, {
      type: "project",
      title: "P",
      details: { description: "alpha" },
    });
    const q = (term: string) =>
      asOwner(h.db, user, (tx) =>
        tx.query("select 1 from public.objects where search @@ to_tsquery('simple', $1)", [term]),
      );
    expect(await q("alpha")).toHaveLength(1);
    await call(one.PATCH, "PATCH", `/api/objects/${p.body.id}`, {
      user,
      id: p.body.id,
      body: { details: { description: "bravo" } },
    });
    expect(await q("alpha")).toHaveLength(0);
    expect(await q("bravo")).toHaveLength(1);
  });

  it("records the change in the activity log with a field diff", async () => {
    const user = h.newUser();
    const t = await create(user, { type: "task", title: "before", details: {} });
    await call(one.PATCH, "PATCH", `/api/objects/${t.body.id}`, {
      user,
      id: t.body.id,
      body: { title: "after" },
    });
    const rows = await asOwner(h.db, user, (tx) =>
      tx.query<{ diff: any }>(
        "select diff from public.activity_log where object_id = $1 and action = 'updated'",
        [t.body.id],
      ),
    );
    expect(rows[0]?.diff.title).toEqual({ from: "before", to: "after" });
  });
});

describe("changing category", () => {
  const convert = (user: string, id: string, type: string) =>
    call(convertRoute.POST, "POST", `/api/objects/${id}/convert`, { user, id, body: { type } });
  const relate = (user: string, body: unknown) =>
    call(edges.POST, "POST", "/api/edges", { user, body });

  it("creates a new object of the target type and archives the original", async () => {
    const user = h.newUser();
    const created = await create(user, {
      type: "project",
      title: "Nirys",
      tags: ["a"],
      color: "purple",
      details: { description: "money stuff", kind: "business", priority: 1 },
    });
    const res = await convert(user, created.body.id, "plan");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.object.id).not.toBe(created.body.id);
    expect(res.body.object).toMatchObject({
      type: "plan",
      title: "Nirys",
      tags: ["a"],
      color: "purple",
      details: { description: "money stuff" },
    });
    // A plan has no room for any project-only field, regardless of whether it was customised.
    expect(res.body.droppedFields.sort()).toEqual([
      "budgetAmount",
      "budgetCurrency",
      "kind",
      "priority",
      "startDate",
      "targetDate",
    ]);
    expect(res.body.droppedRelations).toBe(0);

    // The original is archived: no longer readable.
    expect((await read(user, created.body.id)).status).toBe(404);
  });

  it("keeps everything moving project <-> sub_project, except a sub-project's budget", async () => {
    const user = h.newUser();
    const created = await create(user, {
      type: "project",
      title: "P",
      details: { description: "d", budgetAmount: 100, budgetCurrency: "EUR" },
    });
    const res = await convert(user, created.body.id, "sub_project");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.object.details).toMatchObject({ description: "d", budgetAmount: null });
    expect(res.body.droppedFields).toEqual(["budgetAmount", "budgetCurrency"]);
  });

  it("drops a relation that is no longer legal for the new type", async () => {
    const user = h.newUser();
    const project = await create(user, { type: "project", title: "P", details: {} });
    const task = await create(user, { type: "task", title: "T", details: {} });
    await relate(user, { kind: "contains", from: project.body.id, to: task.body.id });

    const res = await convert(user, project.body.id, "plan");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.droppedRelations).toBe(1);
    const newObj = await read(user, res.body.object.id, "?expand=relations");
    expect(newObj.body.relations.contains.outgoing).toEqual([]);

    // The task itself still exists — only the relation was left on the archived original.
    expect((await read(user, task.body.id)).status).toBe(200);
  });

  it("refuses to convert to the same type, or a type outside the family", async () => {
    const user = h.newUser();
    const project = await create(user, { type: "project", title: "P", details: {} });
    expect((await convert(user, project.body.id, "project")).status).toBe(400);
    const task = await create(user, { type: "task", title: "T", details: {} });
    expect((await convert(user, task.body.id, "project")).status).toBe(400);
  });
});

describe("decisions: no close without a reason", () => {
  const options = [
    { id: "a", label: "Marina 1BR" },
    { id: "b", label: "JLT 1BR" },
  ];
  const patch = (user: string, id: string, body: unknown) =>
    call(one.PATCH, "PATCH", `/api/objects/${id}`, { user, id, body });

  it("refuses to close without an option and a rationale", async () => {
    const user = h.newUser();
    const d = await create(user, { type: "decision", title: "Which?", details: { options } });
    const r1 = await patch(user, d.body.id, { status: "done" });
    expect(r1.status).toBe(400);
    const r2 = await patch(user, d.body.id, { status: "done", details: { resolvedOptionId: "a" } });
    expect(r2.status).toBe(400);
    expect((await read(user, d.body.id)).body.status).toBe("active");
  });

  it("closes in one patch when option and rationale arrive together", async () => {
    const user = h.newUser();
    const d = await create(user, { type: "decision", title: "Which?", details: { options } });
    const res = await patch(user, d.body.id, {
      status: "done",
      details: { resolvedOptionId: "a", rationale: "Best yield at acceptable risk." },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("done");
    expect(res.body.details.resolvedOptionId).toBe("a");
  });

  it("can be reopened, clearing the resolution in the same patch", async () => {
    const user = h.newUser();
    const d = await create(user, {
      type: "decision",
      title: "Which?",
      status: "done",
      details: { options, resolvedOptionId: "b", rationale: "because" },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const res = await patch(user, d.body.id, {
      status: "active",
      details: { resolvedOptionId: null, rationale: "" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("active");
    expect(res.body.details.resolvedOptionId).toBeNull();
  });
});

describe("deleting", () => {
  it("soft-deletes: gone from reads and lists, and its relations disappear from neighbours", async () => {
    const user = h.newUser();
    const project = await create(user, { type: "project", title: "P", details: {} });
    const task = await create(user, {
      type: "task",
      title: "T",
      details: {},
      relations: [{ kind: "contains", direction: "in", other: project.body.id }],
    });

    const del = await call(one.DELETE, "DELETE", `/api/objects/${task.body.id}`, {
      user,
      id: task.body.id,
    });
    expect(del.status).toBe(204);
    expect((await read(user, task.body.id)).status).toBe(404);
    expect((await list(user, "?type=task")).body.items).toEqual([]);
    const parent = await read(user, project.body.id, "?expand=relations");
    expect(parent.body.relations.contains.outgoing).toEqual([]);

    const again = await call(one.DELETE, "DELETE", `/api/objects/${task.body.id}`, {
      user,
      id: task.body.id,
    });
    expect(again.status).toBe(404);
  });

  it("keeps the row for recovery and the audit trail", async () => {
    const user = h.newUser();
    const n = await create(user, { type: "note", title: "N", details: {} });
    await call(one.DELETE, "DELETE", `/api/objects/${n.body.id}`, { user, id: n.body.id });
    const rows = await h.db.query<{ deleted_at: unknown }>(
      "select deleted_at from public.objects where id = $1",
      [n.body.id],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();
    const acts = await h.db.query<{ action: string }>(
      "select action from public.activity_log where object_id = $1 order by id",
      [n.body.id],
    );
    expect(acts.map((a) => a.action)).toEqual(["created", "deleted"]);
  });
});

describe("bad identifiers", () => {
  it("returns 400 for a malformed id and 404 for a well-formed unknown one", async () => {
    const user = h.newUser();
    expect((await read(user, "not-a-uuid")).status).toBe(400);
    expect((await read(user, "11111111-1111-4111-8111-111111111111")).status).toBe(404);
  });
});
