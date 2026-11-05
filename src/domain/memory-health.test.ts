import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import { analyzeMemoryHealth } from "./memory-health";
import { buildMemoryRows } from "./memory-model";

const TODAY = "2026-09-23";

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

const flagsOf = (kind: string, flags: ReturnType<typeof analyzeMemoryHealth>) =>
  flags.find((f) => f.kind === kind)?.memoryIds ?? [];

describe("analyzeMemoryHealth", () => {
  it("flags near-identical titles of the same type as duplicates", () => {
    const a = obj({
      id: "a",
      type: "memory",
      title: "Prefer cash purchase",
      details: { memoryType: "preference" },
    });
    const b = obj({
      id: "b",
      type: "memory",
      title: "Prefer Cash Purchase!",
      details: { memoryType: "preference" },
    });
    const c = obj({
      id: "c",
      type: "memory",
      title: "Prefer cash purchase",
      details: { memoryType: "goal" },
    });
    const rows = buildMemoryRows([a, b, c], []);
    const dup = flagsOf("duplicate", analyzeMemoryHealth(rows, TODAY));
    expect(dup.sort()).toEqual(["a", "b"]); // c differs by type, not a duplicate
  });

  it("flags low and unset confidence", () => {
    const low = obj({ id: "a", type: "memory", title: "A", confidence: 10 });
    const unset = obj({ id: "b", type: "memory", title: "B", confidence: null });
    const high = obj({ id: "c", type: "memory", title: "C", confidence: 90 });
    const rows = buildMemoryRows([low, unset, high], []);
    expect(flagsOf("low_confidence", analyzeMemoryHealth(rows, TODAY)).sort()).toEqual(["a", "b"]);
  });

  it("flags memories not updated in a long time as stale", () => {
    const old = obj({ id: "a", type: "memory", title: "A", updatedAt: "2025-01-01T00:00:00.000Z" });
    const fresh = obj({
      id: "b",
      type: "memory",
      title: "B",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });
    const rows = buildMemoryRows([old, fresh], []);
    expect(flagsOf("stale", analyzeMemoryHealth(rows, TODAY))).toEqual(["a"]);
  });

  it("flags a memory with zero relationships as orphaned", () => {
    const project = obj({ id: "p1", type: "project", title: "P" });
    const linked = obj({ id: "a", type: "memory", title: "Linked" });
    const alone = obj({ id: "b", type: "memory", title: "Alone" });
    const rows = buildMemoryRows([project, linked, alone], [edge("about", "a", "p1")]);
    expect(flagsOf("orphaned", analyzeMemoryHealth(rows, TODAY))).toEqual(["b"]);
  });

  it("never flags 'unused': no consumer writes last_accessed_at yet, so it would be noise", () => {
    const a = obj({ id: "a", type: "memory", title: "A" });
    const kinds = analyzeMemoryHealth(buildMemoryRows([a], []), TODAY).map((f) => f.kind);
    expect(kinds).not.toContain("unused");
  });

  it("excludes archived (dropped) memories from every flag", () => {
    const a = obj({ id: "a", type: "memory", title: "Same", status: "dropped", confidence: 5 });
    const b = obj({ id: "b", type: "memory", title: "Same", confidence: 5 });
    const rows = buildMemoryRows([a, b], []);
    const flags = analyzeMemoryHealth(rows, TODAY);
    expect(flagsOf("duplicate", flags)).toEqual([]); // "a" is archived, so no live duplicate pair
    expect(flagsOf("low_confidence", flags)).toEqual(["b"]);
  });

  it("flags a possible contradiction only for same project, same type, shared tag — never resolving it", () => {
    const project = obj({ id: "p1", type: "project", title: "Dorsel relocation" });
    const a = obj({
      id: "a",
      type: "memory",
      title: "Move in 2029",
      tags: ["timeline"],
      details: { memoryType: "goal" },
    });
    const b = obj({
      id: "b",
      type: "memory",
      title: "Move in 2030",
      tags: ["timeline"],
      details: { memoryType: "goal" },
    });
    const edges = [edge("about", "a", "p1"), edge("about", "b", "p1")];
    const rows = buildMemoryRows([project, a, b], edges);
    const flag = analyzeMemoryHealth(rows, TODAY).find((f) => f.kind === "possible_contradiction");
    expect(flag?.memoryIds.sort()).toEqual(["a", "b"]);
  });

  it("does not flag a contradiction across different projects or different types", () => {
    const p1 = obj({ id: "p1", type: "project", title: "Dorsel" });
    const p2 = obj({ id: "p2", type: "project", title: "Borland" });
    const a = obj({
      id: "a",
      type: "memory",
      title: "X",
      tags: ["t"],
      details: { memoryType: "goal" },
    });
    const b = obj({
      id: "b",
      type: "memory",
      title: "Y",
      tags: ["t"],
      details: { memoryType: "goal" },
    });
    const c = obj({
      id: "c",
      type: "memory",
      title: "Z",
      tags: ["t"],
      details: { memoryType: "fact" },
    });
    const edges = [edge("about", "a", "p1"), edge("about", "b", "p2"), edge("about", "c", "p1")];
    const rows = buildMemoryRows([p1, p2, a, b, c], edges);
    const flag = analyzeMemoryHealth(rows, TODAY).find((f) => f.kind === "possible_contradiction");
    expect(flag).toBeUndefined();
  });
});
