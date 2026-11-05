import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import {
  buildMemoryRows,
  DEFAULT_MEMORY_FILTERS,
  filterMemoryRows,
  groupMemoryRowsByContext,
  memoryGraphSubset,
  sortMemoryRows,
  type MemoryFilters,
} from "./memory-model";

const obj = (over: Partial<ApiObject> & Pick<ApiObject, "id" | "type" | "title">): ApiObject => ({
  status: "active",
  tags: [],
  confidence: null,
  color: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const edge = (
  kind: ApiEdge["kind"],
  from: string,
  to: string,
  label: string | null = null,
): ApiEdge => ({
  id: `${from}-${kind}-${to}`,
  kind,
  from,
  to,
  label,
  dependencyType: null,
  lagDays: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("buildMemoryRows", () => {
  it("builds one row per memory, ignoring every other type", () => {
    const project = obj({
      id: "p1",
      type: "project",
      title: "Dorsel relocation",
      color: "purple",
    });
    const mem = obj({
      id: "m1",
      type: "memory",
      title: "Prefer cash purchase",
      confidence: 90,
      details: {
        memoryType: "preference",
        detail: "Avoids a liability.",
        sourceKind: "ai_proposal",
        pinned: true,
      },
      tags: ["dorsel", "atlas:example"],
    });
    const doc = obj({ id: "doc1", type: "document", title: "Listing.pdf" });
    const edges = [edge("about", "m1", "p1", "primary"), edge("supported_by", "m1", "doc1")];
    const rows = buildMemoryRows([project, mem, doc], edges);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      id: "m1",
      title: "Prefer cash purchase",
      memoryType: "preference",
      detail: "Avoids a liability.",
      sourceKind: "ai_proposal",
      confidence: 90,
      confidenceBand: "high",
      pinned: true,
      tags: ["dorsel"], // the reserved example tag is stripped
      color: "purple",
    });
    expect(row.primary?.id).toBe("p1");
    expect(row.supportedBy.map((c) => c.id)).toEqual(["doc1"]);
    expect(row.relationshipCount).toBe(2); // p1 + doc1
  });

  it("defaults memoryType to fact and sourceKind to user when details are minimal", () => {
    const mem = obj({ id: "m1", type: "memory", title: "Bare fact" });
    const rows = buildMemoryRows([mem], []);
    expect(rows[0]).toMatchObject({
      memoryType: "fact",
      sourceKind: "user",
      pinned: false,
      detail: "",
    });
  });

  it("counts a references edge toward relationshipCount without double-counting about targets", () => {
    const project = obj({ id: "p1", type: "project", title: "P" });
    const other = obj({ id: "m2", type: "memory", title: "Other memory" });
    const mem = obj({ id: "m1", type: "memory", title: "M" });
    const edges = [edge("about", "m1", "p1"), edge("references", "m1", "m2")];
    const rows = buildMemoryRows([project, other, mem], edges);
    const row = rows.find((r) => r.id === "m1")!;
    expect(row.relationshipCount).toBe(2);
  });
});

describe("filterMemoryRows", () => {
  const project = obj({ id: "p1", type: "project", title: "Dorsel relocation", color: "purple" });
  const other = obj({ id: "p2", type: "project", title: "Nirys" });
  const memA = obj({
    id: "m1",
    type: "memory",
    title: "Purchase before relocation",
    confidence: 85,
    details: { memoryType: "plan" },
    tags: ["dorsel"],
  });
  const memB = obj({
    id: "m2",
    type: "memory",
    title: "Prefer cash purchase",
    confidence: 20,
    status: "dropped",
    details: { memoryType: "preference" },
  });
  const memNoContext = obj({ id: "m3", type: "memory", title: "Unlinked insight" });
  const nodes = [project, other, memA, memB, memNoContext];
  const edges = [edge("about", "m1", "p1"), edge("about", "m2", "p2")];
  const rows = buildMemoryRows(nodes, edges);

  it("defaults to active only, excluding archived (dropped) memories", () => {
    const visible = filterMemoryRows(rows, DEFAULT_MEMORY_FILTERS);
    expect(visible.map((r) => r.id).sort()).toEqual(["m1", "m3"]);
  });

  it("'all' status includes archived memories", () => {
    const visible = filterMemoryRows(rows, { ...DEFAULT_MEMORY_FILTERS, status: "all" });
    expect(visible.map((r) => r.id).sort()).toEqual(["m1", "m2", "m3"]);
  });

  it("filters by project id", () => {
    const filters: MemoryFilters = { ...DEFAULT_MEMORY_FILTERS, status: "all", projectId: "p1" };
    expect(filterMemoryRows(rows, filters).map((r) => r.id)).toEqual(["m1"]);
  });

  it("'none' isolates memories with no primary context", () => {
    const filters: MemoryFilters = { ...DEFAULT_MEMORY_FILTERS, projectId: "none" };
    expect(filterMemoryRows(rows, filters).map((r) => r.id)).toEqual(["m3"]);
  });

  it("filters by memory type and confidence band together", () => {
    const filters: MemoryFilters = {
      ...DEFAULT_MEMORY_FILTERS,
      status: "all",
      memoryType: "preference",
      confidenceBand: "low",
    };
    expect(filterMemoryRows(rows, filters).map((r) => r.id)).toEqual(["m2"]);
  });

  it("a text query matches title, detail, tags or the primary context's name", () => {
    expect(
      filterMemoryRows(rows, { ...DEFAULT_MEMORY_FILTERS, query: "relocation" }).map((r) => r.id),
    ).toEqual(["m1"]);
    expect(
      filterMemoryRows(rows, { ...DEFAULT_MEMORY_FILTERS, query: "dorsel" }).map((r) => r.id),
    ).toEqual(["m1"]);
  });

  it("composes every filter at once", () => {
    const filters: MemoryFilters = {
      query: "cash",
      projectId: "p2",
      memoryType: "preference",
      confidenceBand: "low",
      status: "all",
    };
    expect(filterMemoryRows(rows, filters).map((r) => r.id)).toEqual(["m2"]);
  });
});

describe("sortMemoryRows", () => {
  const rows = buildMemoryRows(
    [
      obj({
        id: "a",
        type: "memory",
        title: "Bravo",
        confidence: 40,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
      obj({
        id: "b",
        type: "memory",
        title: "Alpha",
        confidence: 90,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ],
    [],
  );

  it("orders by most recently updated first", () => {
    expect(sortMemoryRows(rows, "updated").map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("orders by most recently created first", () => {
    expect(sortMemoryRows(rows, "created").map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("orders alphabetically", () => {
    expect(sortMemoryRows(rows, "alphabetical").map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("orders by confidence, highest first", () => {
    expect(sortMemoryRows(rows, "confidence").map((r) => r.id)).toEqual(["b", "a"]);
  });
  it("relevance falls back to updated when there is no query", () => {
    expect(sortMemoryRows(rows, "relevance").map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("groupMemoryRowsByContext", () => {
  it("groups by primary context, alphabetically, with ungrouped memories last", () => {
    const p1 = obj({ id: "p1", type: "project", title: "Zeta", color: "teal" });
    const p2 = obj({ id: "p2", type: "project", title: "Alpha", color: "purple" });
    const m1 = obj({ id: "m1", type: "memory", title: "M1" });
    const m2 = obj({ id: "m2", type: "memory", title: "M2" });
    const m3 = obj({ id: "m3", type: "memory", title: "M3 unlinked" });
    const edges = [edge("about", "m1", "p1"), edge("about", "m2", "p2")];
    const rows = buildMemoryRows([p1, p2, m1, m2, m3], edges);
    const groups = groupMemoryRowsByContext(rows);
    expect(groups.map((g) => g.title)).toEqual(["Alpha", "Zeta", ""]);
    expect(groups[2]!.contextId).toBeNull();
    expect(groups[2]!.rows.map((r) => r.id)).toEqual(["m3"]);
  });
});

describe("memoryGraphSubset", () => {
  it("keeps every memory plus its one-hop memory-relevant neighbours", () => {
    const project = obj({ id: "p1", type: "project", title: "P" });
    const doc = obj({ id: "d1", type: "document", title: "D" });
    const unrelatedTask = obj({ id: "t1", type: "task", title: "Unrelated" });
    const mem = obj({ id: "m1", type: "memory", title: "M" });
    const edges = [
      edge("about", "m1", "p1"),
      edge("supported_by", "m1", "d1"),
      edge("contains", "p1", "t1"),
    ];
    const { nodes, edges: keptEdges } = memoryGraphSubset(
      [project, doc, unrelatedTask, mem],
      edges,
    );
    const ids = nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["d1", "m1", "p1"]);
    expect(keptEdges).toHaveLength(2); // the `contains` edge is not memory-relevant
  });

  it("expands further with a larger depth", () => {
    const mem = obj({ id: "m1", type: "memory", title: "M" });
    const doc = obj({ id: "d1", type: "document", title: "D" });
    const project = obj({ id: "p1", type: "project", title: "P" });
    // Two hops from the memory: m1 -> d1 (derived_from), then d1 -> p1 (references).
    const edges = [edge("derived_from", "m1", "d1"), edge("references", "d1", "p1")];
    const shallow = memoryGraphSubset([mem, doc, project], edges, { depth: 1 });
    expect(shallow.nodes.map((n) => n.id).sort()).toEqual(["d1", "m1"]);
    const deeper = memoryGraphSubset([mem, doc, project], edges, { depth: 2 });
    expect(deeper.nodes.map((n) => n.id).sort()).toEqual(["d1", "m1", "p1"]);
  });
});
