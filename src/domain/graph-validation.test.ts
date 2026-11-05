import { describe, expect, it } from "vitest";
import { isEdgeAllowed } from "./edge-rules";
import { OBJECT_TYPES } from "./enums";
import { canReach, validateNewEdge, type EdgeRef } from "./graph-validation";

const e = (kind: EdgeRef["kind"], from: string, to: string): EdgeRef => ({ kind, from, to });

describe("isEdgeAllowed", () => {
  it.each([
    ["contains", "project", "task", true],
    ["contains", "sub_project", "sub_project", true],
    ["contains", "location", "location", true],
    ["contains", "task", "task", false],
    ["contains", "project", "estimate", false],
    ["contains", "location", "task", false],
    ["depends_on", "milestone", "task", true],
    ["depends_on", "estimate", "estimate", true],
    ["depends_on", "note", "task", false],
    ["estimates", "estimate", "property", true],
    ["estimates", "task", "property", false],
    ["funded_by", "property", "estimate", true],
    ["funded_by", "property", "property", false],
    ["located_at", "property", "location", true],
    ["located_at", "project", "location", true],
    ["located_at", "location", "location", false],
    ["located_at", "project", "task", false],
    ["references", "note", "project", true],
    ["references", "person", "task", true],
  ] as const)("%s: %s -> %s is %s", (kind, from, to, allowed) => {
    expect(isEdgeAllowed(kind, from, to)).toBe(allowed);
  });

  it("lets every object type reference every other (soft link)", () => {
    for (const a of OBJECT_TYPES)
      for (const b of OBJECT_TYPES) expect(isEdgeAllowed("references", a, b)).toBe(true);
  });
});

describe("canReach", () => {
  const edges = [e("depends_on", "a", "b"), e("depends_on", "b", "c"), e("contains", "c", "a")];

  it("follows only edges of the requested kind", () => {
    expect(canReach(edges, "depends_on", "a", "c")).toBe(true);
    expect(canReach(edges, "depends_on", "c", "a")).toBe(false);
  });

  it("terminates on cyclic input", () => {
    const cyclic = [e("depends_on", "x", "y"), e("depends_on", "y", "x")];
    expect(canReach(cyclic, "depends_on", "x", "zzz")).toBe(false);
  });
});

describe("validateNewEdge", () => {
  const cand = (
    kind: EdgeRef["kind"],
    from: string,
    to: string,
    fromType: "task" | "project" | "milestone" = "task",
    toType: "task" | "project" | "milestone" = "task",
  ) => ({ kind, from, to, fromType, toType });

  it("accepts a legal edge", () => {
    expect(validateNewEdge(cand("contains", "p", "t", "project", "task"), [])).toEqual([]);
  });

  it("rejects self edges", () => {
    expect(validateNewEdge(cand("references", "a", "a"), []).map((v) => v.code)).toEqual([
      "self_edge",
    ]);
  });

  it("rejects illegal type pairs", () => {
    const codes = validateNewEdge(cand("contains", "t1", "t2"), []).map((v) => v.code);
    expect(codes).toContain("type_not_allowed");
  });

  it("rejects duplicates", () => {
    const codes = validateNewEdge(cand("depends_on", "a", "b"), [e("depends_on", "a", "b")]).map(
      (v) => v.code,
    );
    expect(codes).toContain("duplicate");
  });

  it("allows the same pair under a different kind", () => {
    const codes = validateNewEdge(cand("references", "a", "b"), [e("depends_on", "a", "b")]);
    expect(codes).toEqual([]);
  });

  it("enforces a single parent for contains", () => {
    const codes = validateNewEdge(cand("contains", "p2", "t", "project", "task"), [
      e("contains", "p1", "t"),
    ]).map((v) => v.code);
    expect(codes).toContain("multiple_parents");
  });

  it("does not limit parents for other kinds", () => {
    expect(validateNewEdge(cand("depends_on", "x", "t"), [e("depends_on", "y", "t")])).toEqual([]);
  });

  it("detects a direct depends_on cycle", () => {
    const codes = validateNewEdge(cand("depends_on", "b", "a"), [e("depends_on", "a", "b")]).map(
      (v) => v.code,
    );
    expect(codes).toContain("cycle");
  });

  it("detects a transitive depends_on cycle", () => {
    const existing = [e("depends_on", "a", "b"), e("depends_on", "b", "c")];
    const codes = validateNewEdge(cand("depends_on", "c", "a"), existing).map((v) => v.code);
    expect(codes).toContain("cycle");
  });

  it("detects a contains cycle", () => {
    const codes = validateNewEdge(cand("contains", "b", "a", "project", "project"), [
      e("contains", "a", "b"),
    ]).map((v) => v.code);
    expect(codes).toContain("cycle");
  });

  it("allows a diamond (two paths, no cycle)", () => {
    const existing = [
      e("depends_on", "a", "b"),
      e("depends_on", "a", "c"),
      e("depends_on", "b", "d"),
    ];
    expect(validateNewEdge(cand("depends_on", "c", "d"), existing)).toEqual([]);
  });

  it("does not treat references as acyclic", () => {
    expect(validateNewEdge(cand("references", "b", "a"), [e("references", "a", "b")])).toEqual([]);
  });
});
