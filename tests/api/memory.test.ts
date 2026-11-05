import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as edges from "@/app/api/edges/route";
import * as one from "@/app/api/objects/[id]/route";
import * as collection from "@/app/api/objects/route";
import { createApiHarness, call, type ApiHarness } from "../support/pglite-db";

/** Memory as an ordinary object type on the existing spine (ADR 0002 §0, §2). */

let h: ApiHarness;
beforeAll(async () => {
  h = await createApiHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

const create = (user: string, body: Record<string, unknown>) =>
  call(collection.POST, "POST", "/api/objects", { user, body: { details: {}, ...body } });
const read = (user: string, id: string, query = "") =>
  call(one.GET, "GET", `/api/objects/${id}${query}`, { user, id });
const patch = (user: string, id: string, body: unknown) =>
  call(one.PATCH, "PATCH", `/api/objects/${id}`, { user, id, body });
const destroy = (user: string, id: string) =>
  call(one.DELETE, "DELETE", `/api/objects/${id}`, { user, id });
const relate = (user: string, body: unknown) =>
  call(edges.POST, "POST", "/api/edges", { user, body });

describe("creating a memory", () => {
  it("defaults to a fact, user-sourced, unpinned, with an empty detail", async () => {
    const user = h.newUser();
    const res = await create(user, { type: "memory", title: "Purchase before relocation" });
    expect(res.status).toBe(201);
    expect(res.body.details).toMatchObject({
      memoryType: "fact",
      sourceKind: "user",
      pinned: false,
      detail: "",
    });
  });

  it("accepts an explicit type, confidence and short elaboration", async () => {
    const user = h.newUser();
    const res = await create(user, {
      type: "memory",
      title: "Prefer cash purchase",
      confidence: 90,
      details: {
        memoryType: "preference",
        sourceKind: "ai_proposal",
        detail: "Avoids a currency-linked liability.",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.confidence).toBe(90);
    expect(res.body.details).toMatchObject({ memoryType: "preference", sourceKind: "ai_proposal" });
  });

  it("keeps the statement atomic: a title over 200 characters is rejected", async () => {
    const user = h.newUser();
    const res = await create(user, { type: "memory", title: "x".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("rejects a colour on a memory: only project/sub_project may carry one", async () => {
    const user = h.newUser();
    const res = await create(user, { type: "memory", title: "Fact", color: "purple" });
    expect(res.status).toBe(400);
  });

  it("accepts a colour on a project", async () => {
    const user = h.newUser();
    const res = await create(user, {
      type: "project",
      title: "Dorsel relocation",
      color: "purple",
    });
    expect(res.status).toBe(201);
    expect(res.body.color).toBe("purple");
  });
});

describe("updating a memory", () => {
  it("edits the statement, detail and type", async () => {
    const user = h.newUser();
    const created = await create(user, { type: "memory", title: "Draft fact" });
    const updated = await patch(user, created.body.id, {
      title: "Confirmed fact",
      details: { memoryType: "insight" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.title).toBe("Confirmed fact");
    expect(updated.body.details.memoryType).toBe("insight");
  });

  it("archives via status=dropped and can be reactivated", async () => {
    const user = h.newUser();
    const created = await create(user, { type: "memory", title: "Old plan" });
    const archived = await patch(user, created.body.id, { status: "dropped" });
    expect(archived.body.status).toBe("dropped");
    const reactivated = await patch(user, created.body.id, { status: "active" });
    expect(reactivated.body.status).toBe("active");
  });
});

describe("deleting a memory", () => {
  it("soft-deletes: it disappears from reads and its edges go with it", async () => {
    const user = h.newUser();
    const project = await create(user, { type: "project", title: "P" });
    const memory = await create(user, {
      type: "memory",
      title: "Fact",
      relations: [{ kind: "about", direction: "out", other: project.body.id }],
    });
    expect((await destroy(user, memory.body.id)).status).toBe(204);
    expect((await read(user, memory.body.id)).status).toBe(404);
    const projectRelations = await read(user, project.body.id, "?expand=relations");
    expect(projectRelations.body.relations.about.incoming).toEqual([]);
  });
});

describe("memory relationships", () => {
  it("creates about/derived_from/supported_by together with the memory", async () => {
    const user = h.newUser();
    const project = await create(user, { type: "project", title: "Dorsel relocation" });
    const decision = await create(user, { type: "decision", title: "Mortgage or cash?" });
    const doc = await create(user, {
      type: "document",
      title: "Listing.pdf",
      details: { mime: "application/pdf" },
    });
    const memory = await create(user, {
      type: "memory",
      title: "Prefer cash purchase",
      relations: [
        { kind: "about", direction: "out", other: project.body.id, label: "primary" },
        { kind: "derived_from", direction: "out", other: decision.body.id },
        { kind: "supported_by", direction: "out", other: doc.body.id },
      ],
    });
    expect(memory.status).toBe(201);
    const withRel = await read(user, memory.body.id, "?expand=relations");
    expect(withRel.body.relations.about.outgoing).toHaveLength(1);
    expect(withRel.body.relations.about.outgoing[0]).toMatchObject({
      label: "primary",
      object: { id: project.body.id },
    });
    expect(withRel.body.relations.derived_from.outgoing[0].object.id).toBe(decision.body.id);
    expect(withRel.body.relations.supported_by.outgoing[0].object.id).toBe(doc.body.id);
  });

  it("rejects supported_by targeting anything but a document", async () => {
    const user = h.newUser();
    const memory = await create(user, { type: "memory", title: "Fact" });
    const task = await create(user, { type: "task", title: "T" });
    const res = await relate(user, {
      kind: "supported_by",
      from: memory.body.id,
      to: task.body.id,
    });
    expect(res.status).toBe(422);
  });

  it("rejects about targeting another memory (use references for that)", async () => {
    const user = h.newUser();
    const a = await create(user, { type: "memory", title: "A" });
    const b = await create(user, { type: "memory", title: "B" });
    const res = await relate(user, { kind: "about", from: a.body.id, to: b.body.id });
    expect(res.status).toBe(422);
  });

  it("allows derived_from targeting another memory (a synthesised insight)", async () => {
    const user = h.newUser();
    const a = await create(user, { type: "memory", title: "A" });
    const b = await create(user, { type: "memory", title: "B" });
    const res = await relate(user, { kind: "derived_from", from: a.body.id, to: b.body.id });
    expect(res.status).toBe(201);
  });

  it("cannot reach another owner's object through a memory relation", async () => {
    const alice = h.newUser();
    const bob = h.newUser();
    const mine = await create(bob, { type: "memory", title: "Mine" });
    const theirs = await create(alice, { type: "project", title: "Theirs" });
    const res = await relate(bob, { kind: "about", from: mine.body.id, to: theirs.body.id });
    expect(res.status).toBe(422);
  });
});
