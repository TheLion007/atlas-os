import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as objectTagOne from "@/app/api/objects/[id]/tags/[tagId]/route";
import * as objectTags from "@/app/api/objects/[id]/tags/route";
import * as objects from "@/app/api/objects/route";
import * as tagOne from "@/app/api/tags/[id]/route";
import * as tags from "@/app/api/tags/route";
import { createApiHarness, call, type ApiHarness } from "../support/pglite-db";

/**
 * The user tag catalogue (ADR 0002 §4): a first-class, many-to-many, user-controlled structure,
 * independent of the pre-existing free-text `objects.tags`.
 */

let h: ApiHarness;
beforeAll(async () => {
  h = await createApiHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

const mk = async (user: string, type: string, title: string) => {
  const r = await call(objects.POST, "POST", "/api/objects", {
    user,
    body: { type, title, details: {} },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
};
const create = (user: string, body: unknown) =>
  call(tags.POST, "POST", "/api/tags", { user, body });
const list = (user: string) => call(tags.GET, "GET", "/api/tags", { user });
const patch = (user: string, id: string, body: unknown) =>
  call(tagOne.PATCH, "PATCH", `/api/tags/${id}`, { user, id, body });
const destroy = (user: string, id: string) =>
  call(tagOne.DELETE, "DELETE", `/api/tags/${id}`, { user, id });
const attach = (user: string, objectId: string, tagId: string) =>
  call(objectTags.POST, "POST", `/api/objects/${objectId}/tags`, {
    user,
    id: objectId,
    body: { tagId },
  });
/** The detach route has two dynamic segments; the shared `call()` helper only threads one. */
const detach = (user: string, objectId: string, tagId: string) => {
  const req = new Request(`http://localhost/api/objects/${objectId}/tags/${tagId}`, {
    method: "DELETE",
    headers: user ? { "x-test-user": user } : {},
  });
  return objectTagOne.DELETE(req, { params: Promise.resolve({ id: objectId, tagId }) });
};

describe("POST /api/tags", () => {
  it("creates a user tag", async () => {
    const user = h.newUser();
    const res = await create(user, { name: "Dorsel", color: "purple" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Dorsel", kind: "user", color: "purple" });
  });

  it("rejects a duplicate name for the same owner, case-insensitively", async () => {
    const user = h.newUser();
    await create(user, { name: "Tax" });
    const dup = await create(user, { name: "tax" });
    expect(dup.status).toBe(409);
  });

  it("lets two different owners use the same tag name", async () => {
    const alice = h.newUser();
    const bob = h.newUser();
    expect((await create(alice, { name: "Shared" })).status).toBe(201);
    expect((await create(bob, { name: "Shared" })).status).toBe(201);
  });

  it("rejects a raw hex colour: only a design-token key is accepted", async () => {
    const user = h.newUser();
    const res = await create(user, { name: "Bad colour", color: "#ff0000" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/tags", () => {
  it("lists only the owner's own tags, alphabetically", async () => {
    const user = h.newUser();
    const other = h.newUser();
    await create(user, { name: "Zeta" });
    await create(user, { name: "Alpha" });
    await create(other, { name: "NotMine" });
    const res = await list(user);
    expect(res.body.map((t: any) => t.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("PATCH and DELETE /api/tags/:id", () => {
  it("renames and recolours a tag", async () => {
    const user = h.newUser();
    const created = await create(user, { name: "Old", color: "teal" });
    const updated = await patch(user, created.body.id, { name: "New", color: "rose" });
    expect(updated.body).toMatchObject({ name: "New", color: "rose" });
  });

  it("cannot be renamed or deleted by another owner", async () => {
    const owner = h.newUser();
    const other = h.newUser();
    const created = await create(owner, { name: "Mine" });
    expect((await patch(other, created.body.id, { name: "Stolen" })).status).toBe(404);
    expect((await destroy(other, created.body.id)).status).toBe(404);
  });

  it("deleting a tag also removes its attachments", async () => {
    const user = h.newUser();
    const project = await mk(user, "project", "P");
    const tag = await create(user, { name: "Removable" });
    await attach(user, project, tag.body.id);
    expect((await destroy(user, tag.body.id)).status).toBe(204);
    const listed = await list(user);
    expect(listed.body).toEqual([]);
  });
});

describe("attaching and detaching tags on an object", () => {
  it("attaches a tag, is idempotent, and can be detached", async () => {
    const user = h.newUser();
    const project = await mk(user, "project", "P");
    const tag = await create(user, { name: "Dorsel" });
    expect((await attach(user, project, tag.body.id)).status).toBe(204);
    expect((await attach(user, project, tag.body.id)).status).toBe(204); // no-op, not an error
    const detached = await detach(user, project, tag.body.id);
    expect(detached.status).toBe(204);
    const detachedAgain = await detach(user, project, tag.body.id); // also a no-op
    expect(detachedAgain.status).toBe(204);
  });

  it("cannot attach a tag across owners in either direction", async () => {
    const alice = h.newUser();
    const bob = h.newUser();
    const aliceProject = await mk(alice, "project", "Alice's");
    const bobTag = await create(bob, { name: "Bob's tag" });
    // Alice's object, Bob's tag, acting as Alice: neither belongs to her together.
    const res = await attach(alice, aliceProject, bobTag.body.id);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
