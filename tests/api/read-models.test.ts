import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as activity from "@/app/api/activity/route";
import * as edges from "@/app/api/edges/route";
import * as graph from "@/app/api/graph/route";
import * as objectOne from "@/app/api/objects/[id]/route";
import * as objects from "@/app/api/objects/route";
import * as settings from "@/app/api/settings/route";
import { asOwner } from "@/server/db/types";
import { createApiHarness, call, type ApiHarness } from "../support/pglite-db";

let h: ApiHarness;
beforeAll(async () => {
  h = await createApiHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

const mk = async (user: string, type: string, title: string, details: unknown = {}) => {
  const r = await call(objects.POST, "POST", "/api/objects", {
    user,
    body: { type, title, details },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
};
const relate = (user: string, body: unknown) =>
  call(edges.POST, "POST", "/api/edges", { user, body });

describe("GET /api/graph", () => {
  it("returns every live object and relation, without details unless asked", async () => {
    const user = h.newUser();
    const project = await mk(user, "project", "P");
    const task = await mk(user, "task", "T", { effort: 3 });
    await relate(user, { kind: "contains", from: project, to: task });

    const plain = await call(graph.GET, "GET", "/api/graph", { user });
    expect(plain.status).toBe(200);
    expect(plain.body.nodes.map((n: any) => n.title).sort()).toEqual(["P", "T"]);
    expect(plain.body.nodes[0]).not.toHaveProperty("details");
    expect(plain.body.edges).toHaveLength(1);
    expect(plain.body.edges[0]).toMatchObject({ kind: "contains", from: project, to: task });
  });

  it("includes each object's details with ?details=true, across every detail table", async () => {
    const user = h.newUser();
    await mk(user, "project", "P", { priority: 1 });
    await mk(user, "sub_project", "S");
    await mk(user, "task", "T", { effort: 3, due: "2027-01-01" });
    await mk(user, "estimate", "E", { amount: 100, currency: "EUR" });
    await mk(user, "risk", "R", { probability: 2, impact: 3 });

    const res = await call(graph.GET, "GET", "/api/graph?details=true", { user });
    const byTitle = Object.fromEntries(res.body.nodes.map((n: any) => [n.title, n]));
    expect(byTitle.P.details.priority).toBe(1);
    expect(byTitle.S.details).toBeTypeOf("object");
    expect(byTitle.T.details).toMatchObject({ effort: 3, due: "2027-01-01" });
    expect(byTitle.E.details).toMatchObject({ amount: 100, currency: "EUR" });
    expect(byTitle.R.details).toMatchObject({ probability: 2, impact: 3 });
    for (const n of res.body.nodes) expect(n.details, n.title).toBeDefined();
  });

  it("leaves out deleted objects and the relations that touched them", async () => {
    const user = h.newUser();
    const a = await mk(user, "task", "A");
    const b = await mk(user, "task", "B");
    await relate(user, { kind: "depends_on", from: a, to: b });
    await call(objectOne.DELETE, "DELETE", `/api/objects/${b}`, { user, id: b });

    const res = await call(graph.GET, "GET", "/api/graph", { user });
    expect(res.body.nodes.map((n: any) => n.title)).toEqual(["A"]);
    expect(res.body.edges).toEqual([]);
  });

  it("never includes another owner's data", async () => {
    const alice = h.newUser();
    const bob = h.newUser();
    await mk(alice, "project", "Alice's");
    const res = await call(graph.GET, "GET", "/api/graph?details=true", { user: bob });
    expect(res.body).toEqual({ nodes: [], edges: [] });
  });

  it("is empty for a new owner", async () => {
    const res = await call(graph.GET, "GET", "/api/graph", { user: h.newUser() });
    expect(res.body).toEqual({ nodes: [], edges: [] });
  });
});

describe("GET /api/activity", () => {
  it("lists changes newest first with the object's type and title", async () => {
    const user = h.newUser();
    const id = await mk(user, "task", "Original");
    await call(objectOne.PATCH, "PATCH", `/api/objects/${id}`, {
      user,
      id,
      body: { title: "Renamed" },
    });

    const res = await call(activity.GET, "GET", "/api/activity", { user });
    expect(res.status).toBe(200);
    expect(res.body.map((a: any) => a.action)).toEqual(["updated", "created"]);
    expect(res.body[0]).toMatchObject({ objectId: id, object: { type: "task", title: "Renamed" } });
    expect(res.body[0].diff.title).toEqual({ from: "Original", to: "Renamed" });
    expect(typeof res.body[0].id).toBe("number");
    expect(new Date(res.body[0].at).toISOString()).toBe(res.body[0].at);
  });

  it("respects the limit and clamps silly values", async () => {
    const user = h.newUser();
    for (let i = 0; i < 5; i++) await mk(user, "note", `n${i}`);
    expect((await call(activity.GET, "GET", "/api/activity?limit=2", { user })).body).toHaveLength(
      2,
    );
    expect((await call(activity.GET, "GET", "/api/activity?limit=0", { user })).body).toHaveLength(
      1,
    );
    expect(
      (await call(activity.GET, "GET", "/api/activity?limit=nope", { user })).body,
    ).toHaveLength(5);
  });

  it("keeps history after an object is purged, without a title", async () => {
    const user = h.newUser();
    const id = await mk(user, "note", "Doomed");
    await asOwner(h.db, user, (tx) => tx.query("delete from public.objects where id = $1", [id]));
    const res = await call(activity.GET, "GET", "/api/activity", { user });
    expect(res.body.map((a: any) => a.action)).toContain("purged");
    expect(res.body.find((a: any) => a.action === "purged").object).toBeNull();
  });

  it("only shows the owner's own activity", async () => {
    const alice = h.newUser();
    await mk(alice, "note", "private");
    expect((await call(activity.GET, "GET", "/api/activity", { user: h.newUser() })).body).toEqual(
      [],
    );
  });
});

describe("GET /api/settings", () => {
  it("assumes nothing for a new owner: no base currency", async () => {
    const res = await call(settings.GET, "GET", "/api/settings", { user: h.newUser() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      baseCurrency: null,
      activeScenario: "base",
      timelineStart: null,
      timelineEnd: null,
      fxRates: [],
    });
  });

  it("returns the chosen base currency and manual FX rates with their sources", async () => {
    const user = h.newUser();
    await asOwner(h.db, user, async (tx) => {
      await tx.query(
        "insert into public.app_settings (base_currency, active_scenario) values ('EUR', 'conservative')",
      );
      await tx.query(
        `insert into public.fx_rates (from_ccy, to_ccy, rate, as_of, source) values
         ('AED', 'EUR', 0.25, '2026-09-01', 'manual entry'),
         ('AED', 'EUR', 0.24, '2026-01-01', 'older manual entry')`,
      );
    });
    const res = await call(settings.GET, "GET", "/api/settings", { user });
    expect(res.body.baseCurrency).toBe("EUR");
    expect(res.body.activeScenario).toBe("conservative");
    expect(res.body.fxRates).toEqual([
      { from: "AED", to: "EUR", rate: 0.25, asOf: "2026-09-01", source: "manual entry" },
      { from: "AED", to: "EUR", rate: 0.24, asOf: "2026-01-01", source: "older manual entry" },
    ]);
  });

  it("does not leak another owner's settings", async () => {
    const alice = h.newUser();
    await asOwner(h.db, alice, (tx) =>
      tx.query("insert into public.app_settings (base_currency) values ('AED')"),
    );
    const res = await call(settings.GET, "GET", "/api/settings", { user: h.newUser() });
    expect(res.body.baseCurrency).toBeNull();
  });
});

describe("read routes are deny-by-default", () => {
  it.each([
    ["graph", graph.GET, "/api/graph"],
    ["activity", activity.GET, "/api/activity"],
    ["settings", settings.GET, "/api/settings"],
  ] as const)("%s answers 401 without a user", async (_n, handler, path) => {
    const res = await call(handler, "GET", path);
    expect(res.status).toBe(401);
  });
});
