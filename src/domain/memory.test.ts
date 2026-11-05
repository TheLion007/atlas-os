import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import { memoryProvenance } from "./memory";

const obj = (over: Partial<ApiObject> & Pick<ApiObject, "id" | "type" | "title">): ApiObject => ({
  status: "active",
  tags: [],
  confidence: null,
  color: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const edge = (kind: ApiEdge["kind"], from: string, to: string): ApiEdge => ({
  id: `${from}-${kind}-${to}`,
  kind,
  from,
  to,
  label: null,
  dependencyType: null,
  lagDays: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("memoryProvenance", () => {
  it("returns null for a non-memory or missing id", () => {
    const project = obj({ id: "p1", type: "project", title: "P" });
    expect(memoryProvenance("p1", [project], [])).toBeNull();
    expect(memoryProvenance("nope", [project], [])).toBeNull();
  });

  it("defaults sourceKind to 'user' when the details omit it", () => {
    const mem = obj({ id: "m1", type: "memory", title: "Fact", details: {} });
    expect(memoryProvenance("m1", [mem], [])).toEqual({
      sourceKind: "user",
      derivedFrom: [],
      about: [],
      supportedBy: [],
    });
  });

  it("reads sourceKind straight off the object's own details, never invented", () => {
    const mem = obj({
      id: "m1",
      type: "memory",
      title: "Fact",
      details: { sourceKind: "ai_proposal" },
    });
    expect(memoryProvenance("m1", [mem], [])?.sourceKind).toBe("ai_proposal");
  });

  it("collects about/derivedFrom/supportedBy from the memory's own outgoing edges only", () => {
    const project = obj({ id: "p1", type: "project", title: "Dorsel relocation" });
    const decision = obj({ id: "d1", type: "decision", title: "Mortgage or cash?" });
    const doc = obj({ id: "doc1", type: "document", title: "Listing.pdf" });
    const mem = obj({ id: "m1", type: "memory", title: "Prefer cash", details: {} });
    const edges = [
      edge("about", "m1", "p1"),
      edge("derived_from", "m1", "d1"),
      edge("supported_by", "m1", "doc1"),
      // Not this memory's edge — must not leak in.
      edge("about", "m2-other", "p1"),
    ];
    const p = memoryProvenance("m1", [project, decision, doc, mem], edges);
    expect(p?.about).toEqual([{ id: "p1", type: "project", title: "Dorsel relocation" }]);
    expect(p?.derivedFrom).toEqual([{ id: "d1", type: "decision", title: "Mortgage or cash?" }]);
    expect(p?.supportedBy).toEqual([{ id: "doc1", type: "document", title: "Listing.pdf" }]);
  });

  it("silently drops a reference to an object that no longer exists, never fabricating one", () => {
    const mem = obj({ id: "m1", type: "memory", title: "Fact", details: {} });
    const edges = [edge("derived_from", "m1", "gone")];
    expect(memoryProvenance("m1", [mem], edges)?.derivedFrom).toEqual([]);
  });
});
