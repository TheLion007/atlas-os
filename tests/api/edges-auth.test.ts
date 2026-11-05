import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as edgeOne from "@/app/api/edges/[id]/route";
import * as edges from "@/app/api/edges/route";
import * as objectOne from "@/app/api/objects/[id]/route";
import * as objects from "@/app/api/objects/route";
import { GET as health } from "@/app/api/health/route";
import { denyAll, devBypass } from "@/server/auth";
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
const unrelate = (user: string, id: string) =>
  call(edgeOne.DELETE, "DELETE", `/api/edges/${id}`, { user, id });

describe("authentication is deny-by-default", () => {
  const cases: [string, () => Promise<{ status: number; body: any }>][] = [
    ["GET /api/objects", () => call(objects.GET, "GET", "/api/objects")],
    [
      "POST /api/objects",
      () =>
        call(objects.POST, "POST", "/api/objects", {
          body: { type: "task", title: "x", details: {} },
        }),
    ],
    [
      "GET /api/objects/:id",
      () =>
        call(objectOne.GET, "GET", "/api/objects/x", {
          id: "11111111-1111-4111-8111-111111111111",
        }),
    ],
    [
      "PATCH /api/objects/:id",
      () =>
        call(objectOne.PATCH, "PATCH", "/api/objects/x", {
          id: "11111111-1111-4111-8111-111111111111",
          body: {},
        }),
    ],
    [
      "DELETE /api/objects/:id",
      () =>
        call(objectOne.DELETE, "DELETE", "/api/objects/x", {
          id: "11111111-1111-4111-8111-111111111111",
        }),
    ],
    ["POST /api/edges", () => call(edges.POST, "POST", "/api/edges", { body: {} })],
    [
      "DELETE /api/edges/:id",
      () =>
        call(edgeOne.DELETE, "DELETE", "/api/edges/x", {
          id: "11111111-1111-4111-8111-111111111111",
        }),
    ],
  ];

  it.each(cases)("%s answers 401 without touching the database", async (_name, run) => {
    const res = await run();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: "unauthorized", message: "Authentication required." },
    });
  });

  it("denyAll never authenticates anyone", async () => {
    expect(await denyAll(new Request("http://localhost/"))).toBeNull();
  });

  describe("development bypass", () => {
    const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    afterEach(() => vi.unstubAllEnvs());

    it("returns nothing unless explicitly configured", async () => {
      vi.stubEnv("ATLAS_DEV_OWNER_ID", "");
      expect(await devBypass(new Request("http://localhost/"))).toBeNull();
    });

    it("acts as the configured owner outside production", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ATLAS_DEV_OWNER_ID", OWNER);
      expect(await devBypass(new Request("http://localhost/"))).toBe(OWNER);
    });

    it("is ignored in production even when configured", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("ATLAS_DEV_OWNER_ID", OWNER);
      expect(await devBypass(new Request("http://localhost/"))).toBeNull();
    });

    it("rejects a value that is not a UUID", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("ATLAS_DEV_OWNER_ID", "admin");
      expect(await devBypass(new Request("http://localhost/"))).toBeNull();
    });
  });

  it("keeps the liveness probe open (it reveals nothing and touches no data)", () => {
    expect(health().status).toBe(200);
  });
});

describe("POST /api/edges", () => {
  it("relates two objects and returns the edge", async () => {
    const user = h.newUser();
    const project = await mk(user, "project", "P");
    const task = await mk(user, "task", "T");
    const res = await relate(user, { kind: "contains", from: project, to: task });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      kind: "contains",
      from: project,
      to: task,
      dependencyType: null,
      lagDays: null,
    });
  });

  it("defaults depends_on to finish-to-start with no lag, and accepts a lead", async () => {
    const user = h.newUser();
    const a = await mk(user, "milestone", "A");
    const b = await mk(user, "milestone", "B");
    const c = await mk(user, "milestone", "C");
    const r1 = await relate(user, { kind: "depends_on", from: b, to: a });
    expect(r1.body).toMatchObject({ dependencyType: "fs", lagDays: 0 });
    const r2 = await relate(user, { kind: "depends_on", from: c, to: a, lagDays: -14 });
    expect(r2.body.lagDays).toBe(-14);
  });

  it("answers 409 for a duplicate and for a second parent", async () => {
    const user = h.newUser();
    const p1 = await mk(user, "project", "P1");
    const p2 = await mk(user, "project", "P2");
    const t = await mk(user, "task", "T");
    await relate(user, { kind: "contains", from: p1, to: t });
    const dup = await relate(user, { kind: "contains", from: p1, to: t });
    expect(dup.status).toBe(409);
    const second = await relate(user, { kind: "contains", from: p2, to: t });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/only one parent/);
  });

  it("answers 422 for cycles and illegal type pairs, with a readable message", async () => {
    const user = h.newUser();
    const a = await mk(user, "task", "A");
    const b = await mk(user, "task", "B");
    const c = await mk(user, "task", "C");
    await relate(user, { kind: "depends_on", from: a, to: b });
    await relate(user, { kind: "depends_on", from: b, to: c });
    const cycle = await relate(user, { kind: "depends_on", from: c, to: a });
    expect(cycle.status).toBe(422);
    expect(cycle.body.error.message).toMatch(/cycle/);

    const bad = await relate(user, { kind: "contains", from: a, to: b });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toMatch(/a task cannot contains a task/);
  });

  it("answers 400 for malformed input and 422 for missing endpoints", async () => {
    const user = h.newUser();
    const a = await mk(user, "task", "A");
    expect((await relate(user, { kind: "references", from: a, to: a })).status).toBe(400);
    expect((await relate(user, { kind: "related_to", from: a, to: a })).status).toBe(400);
    expect((await relate(user, { kind: "contains", from: a, to: a, lagDays: 3 })).status).toBe(400);
    const ghost = await relate(user, {
      kind: "references",
      from: a,
      to: "11111111-1111-4111-8111-111111111111",
    });
    expect(ghost.status).toBe(422);
  });

  it("cannot reach another owner's object", async () => {
    const alice = h.newUser();
    const bob = h.newUser();
    const mine = await mk(bob, "task", "mine");
    const theirs = await mk(alice, "task", "theirs");
    const res = await relate(bob, { kind: "references", from: mine, to: theirs });
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/edges/:id", () => {
  it("removes a relation, frees the slot, and cannot be repeated", async () => {
    const user = h.newUser();
    const a = await mk(user, "task", "A");
    const b = await mk(user, "task", "B");
    const edge = await relate(user, { kind: "depends_on", from: a, to: b });

    expect((await unrelate(user, edge.body.id)).status).toBe(204);
    const gone = await call(objectOne.GET, "GET", `/api/objects/${a}?expand=relations`, {
      user,
      id: a,
    });
    expect(gone.body.relations.depends_on.outgoing).toEqual([]);

    expect((await unrelate(user, edge.body.id)).status).toBe(404);
    expect((await relate(user, { kind: "depends_on", from: a, to: b })).status).toBe(201);
  });

  it("lets a dependency direction be reversed after removing it (no false cycle)", async () => {
    const user = h.newUser();
    const a = await mk(user, "task", "A");
    const b = await mk(user, "task", "B");
    const e = await relate(user, { kind: "depends_on", from: a, to: b });
    expect((await relate(user, { kind: "depends_on", from: b, to: a })).status).toBe(422);
    await unrelate(user, e.body.id);
    expect((await relate(user, { kind: "depends_on", from: b, to: a })).status).toBe(201);
  });

  it("cannot remove another owner's relation", async () => {
    const alice = h.newUser();
    const bob = h.newUser();
    const a = await mk(alice, "task", "A");
    const b = await mk(alice, "task", "B");
    const edge = await relate(alice, { kind: "depends_on", from: a, to: b });
    expect((await unrelate(bob, edge.body.id)).status).toBe(404);
    const still = await call(objectOne.GET, "GET", `/api/objects/${a}?expand=relations`, {
      user: alice,
      id: a,
    });
    expect(still.body.relations.depends_on.outgoing).toHaveLength(1);
  });
});
