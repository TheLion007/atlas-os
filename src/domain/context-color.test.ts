import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import { PRIMARY_CONTEXT_LABEL, resolveMemoryContext } from "./context-color";

const obj = (over: Partial<ApiObject> & Pick<ApiObject, "id" | "type" | "title">): ApiObject => ({
  status: "active",
  tags: [],
  confidence: null,
  color: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const edge = (over: Partial<ApiEdge> & Pick<ApiEdge, "kind" | "from" | "to">): ApiEdge => ({
  id: `${over.from}-${over.kind}-${over.to}`,
  label: null,
  dependencyType: null,
  lagDays: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("resolveMemoryContext", () => {
  it("returns an empty context when the memory has no about edges", () => {
    const mem = obj({ id: "m1", type: "memory", title: "A fact" });
    expect(resolveMemoryContext("m1", [mem], [])).toEqual({
      color: null,
      primary: null,
      secondary: [],
    });
  });

  it("inherits its single project's colour", () => {
    const project = obj({
      id: "p1",
      type: "project",
      title: "Dorsel relocation",
      color: "purple",
    });
    const mem = obj({ id: "m1", type: "memory", title: "Purchase before relocation" });
    const edges = [edge({ kind: "about", from: "m1", to: "p1" })];
    const r = resolveMemoryContext("m1", [project, mem], edges);
    expect(r.color).toBe("purple");
    expect(r.primary).toEqual({
      id: "p1",
      type: "project",
      title: "Dorsel relocation",
      color: "purple",
    });
    expect(r.secondary).toEqual([]);
  });

  it("inherits its plan's colour, just like a project", () => {
    const plan = obj({
      id: "pl1",
      type: "plan",
      title: "Dorsel relocation programme",
      color: "sand",
    });
    const mem = obj({ id: "m1", type: "memory", title: "Budget note" });
    const edges = [edge({ kind: "about", from: "m1", to: "pl1" })];
    const r = resolveMemoryContext("m1", [plan, mem], edges);
    expect(r.color).toBe("sand");
    expect(r.primary).toEqual({
      id: "pl1",
      type: "plan",
      title: "Dorsel relocation programme",
      color: "sand",
    });
  });

  it("inherits null when the project has no colour set", () => {
    const project = obj({ id: "p1", type: "project", title: "Uncoloured" });
    const mem = obj({ id: "m1", type: "memory", title: "Fact" });
    const edges = [edge({ kind: "about", from: "m1", to: "p1" })];
    expect(resolveMemoryContext("m1", [project, mem], edges).color).toBeNull();
  });

  it("a labelled primary context wins regardless of edge age", () => {
    const older = obj({ id: "p1", type: "project", title: "Older", color: "teal" });
    const newer = obj({ id: "p2", type: "project", title: "Newer", color: "purple" });
    const mem = obj({ id: "m1", type: "memory", title: "Multi-context" });
    const edges = [
      edge({ kind: "about", from: "m1", to: "p1", createdAt: "2026-01-01T00:00:00.000Z" }),
      edge({
        kind: "about",
        from: "m1",
        to: "p2",
        createdAt: "2026-02-01T00:00:00.000Z",
        label: PRIMARY_CONTEXT_LABEL,
      }),
    ];
    const r = resolveMemoryContext("m1", [older, newer, mem], edges);
    expect(r.color).toBe("purple");
    expect(r.primary?.id).toBe("p2");
    expect(r.secondary.map((s) => s.id)).toEqual(["p1"]);
  });

  it("falls back to the oldest about edge when nothing is labelled primary", () => {
    const older = obj({ id: "p1", type: "project", title: "Older", color: "teal" });
    const newer = obj({ id: "p2", type: "project", title: "Newer", color: "purple" });
    const mem = obj({ id: "m1", type: "memory", title: "Multi-context" });
    const edges = [
      edge({ kind: "about", from: "m1", to: "p2", createdAt: "2026-02-01T00:00:00.000Z" }),
      edge({ kind: "about", from: "m1", to: "p1", createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const r = resolveMemoryContext("m1", [older, newer, mem], edges);
    expect(r.color).toBe("teal");
    expect(r.primary?.id).toBe("p1");
    expect(r.secondary.map((s) => s.id)).toEqual(["p2"]);
  });

  it("never lets a Location act as a colour authority, even if about-linked", () => {
    const location = obj({ id: "l1", type: "location", title: "Borland", color: null });
    const mem = obj({ id: "m1", type: "memory", title: "Fact about Borland" });
    const edges = [edge({ kind: "about", from: "m1", to: "l1" })];
    expect(resolveMemoryContext("m1", [location, mem], edges)).toEqual({
      color: null,
      primary: null,
      secondary: [],
    });
  });

  it("ignores a soft-deleted (absent) about target", () => {
    const mem = obj({ id: "m1", type: "memory", title: "Fact" });
    const edges = [edge({ kind: "about", from: "m1", to: "does-not-exist" })];
    expect(resolveMemoryContext("m1", [mem], edges).primary).toBeNull();
  });

  it("ignores about edges belonging to a different memory", () => {
    const project = obj({ id: "p1", type: "project", title: "P", color: "purple" });
    const mem = obj({ id: "m1", type: "memory", title: "M1" });
    const other = obj({ id: "m2", type: "memory", title: "M2" });
    const edges = [edge({ kind: "about", from: "m2", to: "p1" })];
    expect(resolveMemoryContext("m1", [project, mem, other], edges).primary).toBeNull();
  });
});
