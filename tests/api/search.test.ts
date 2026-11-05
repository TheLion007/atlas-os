import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as objectTags from "@/app/api/objects/[id]/tags/route";
import * as objects from "@/app/api/objects/route";
import * as search from "@/app/api/search/route";
import * as tags from "@/app/api/tags/route";
import { createApiHarness, call, type ApiHarness } from "../support/pglite-db";

/** Unified, server-side search across every type, including Memory (ADR 0002 §6). */

let h: ApiHarness;
beforeAll(async () => {
  h = await createApiHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

const create = (user: string, body: Record<string, unknown>) =>
  call(objects.POST, "POST", "/api/objects", { user, body: { details: {}, ...body } });
const find = (user: string, q: string) =>
  call(search.GET, "GET", `/api/search?q=${encodeURIComponent(q)}`, { user });
const createTag = (user: string, name: string) =>
  call(tags.POST, "POST", "/api/tags", { user, body: { name } });
const attach = (user: string, objectId: string, tagId: string) =>
  call(objectTags.POST, "POST", `/api/objects/${objectId}/tags`, {
    user,
    id: objectId,
    body: { tagId },
  });

describe("GET /api/search", () => {
  it("finds a memory by its statement text", async () => {
    const user = h.newUser();
    await create(user, { type: "memory", title: "Purchase property before relocation" });
    const res = await find(user, "purchase property");
    expect(res.status).toBe(200);
    expect(
      res.body.results.some((r: any) => r.title === "Purchase property before relocation"),
    ).toBe(true);
  });

  it("preserves each result's type, status and colour — no re-fetch needed", async () => {
    const user = h.newUser();
    await create(user, { type: "project", title: "Taxe 2024 project", color: "purple" });
    const res = await find(user, "Taxe 2024");
    const hit = res.body.results.find((r: any) => r.title === "Taxe 2024 project");
    expect(hit).toMatchObject({ type: "project", status: "active", color: "purple" });
  });

  it("finds across multiple types for the same query, each keeping its own identity", async () => {
    const user = h.newUser();
    await create(user, { type: "memory", title: "Fiscalite 2024 note" });
    await create(user, {
      type: "document",
      title: "Fiscalite_2024.pdf",
      details: { mime: "application/pdf" },
    });
    const res = await find(user, "Fiscalite 2024");
    const types = new Set(res.body.results.map((r: any) => r.type));
    expect(types.has("memory")).toBe(true);
    expect(types.has("document")).toBe(true);
  });

  it("filters by an exact #tag", async () => {
    const user = h.newUser();
    const match = await create(user, { type: "memory", title: "Tagged memory" });
    const other = await create(user, { type: "memory", title: "Untagged memory" });
    const tag = await createTag(user, "Dorsel");
    await attach(user, match.body.id, tag.body.id);
    void other;
    const res = await find(user, "#Dorsel");
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].id).toBe(match.body.id);
  });

  it("never returns another owner's objects", async () => {
    const alice = h.newUser();
    const bob = h.newUser();
    await create(alice, { type: "memory", title: "Alice's secret plan" });
    const res = await find(bob, "Alice's secret plan");
    expect(res.body.results).toEqual([]);
  });

  it("returns nothing for an empty query, without querying the database for garbage", async () => {
    const user = h.newUser();
    const res = await find(user, "");
    expect(res.body.results).toEqual([]);
  });

  it("requires authentication", async () => {
    const res = await call(search.GET, "GET", "/api/search?q=x");
    expect(res.status).toBe(401);
  });
});
