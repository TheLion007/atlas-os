import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import { buildContext, DEFAULT_RETRIEVAL_BUDGET, SEMANTIC_WEIGHT } from "./retrieval";

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

describe("buildContext", () => {
  it("returns nothing for an empty context (no focus, no query)", () => {
    const r = buildContext({}, [obj({ id: "a", type: "project", title: "A" })], []);
    expect(r).toEqual({ citations: [], items: [], truncated: false });
  });

  it("always cites the focus object first, with infinite score", () => {
    const focus = obj({ id: "f", type: "project", title: "Focus" });
    const r = buildContext({ focusObjectId: "f" }, [focus], []);
    expect(r.items[0]).toMatchObject({ object: { id: "f" }, reasons: ["focus"] });
    expect(r.citations[0]?.id).toBe("f");
  });

  it("ranks a directly-related object above an unrelated one", () => {
    const focus = obj({ id: "f", type: "project", title: "Focus" });
    const near = obj({ id: "n", type: "task", title: "Near" });
    const far = obj({ id: "x", type: "task", title: "Unrelated" });
    const edges = [edge("contains", "f", "n")];
    const r = buildContext({ focusObjectId: "f" }, [focus, near, far], edges);
    const ids = r.items.map((i) => i.object.id);
    expect(ids).toContain("n");
    expect(ids).not.toContain("x");
    expect(r.items.find((i) => i.object.id === "n")?.reasons).toContain("direct-relation");
  });

  it("scores a two-hop relation lower than a one-hop relation", () => {
    const focus = obj({ id: "f", type: "project", title: "Focus" });
    const hop1 = obj({ id: "h1", type: "task", title: "One hop" });
    const hop2 = obj({ id: "h2", type: "milestone", title: "Two hops" });
    const edges = [edge("contains", "f", "h1"), edge("contains", "h1", "h2")];
    const r = buildContext({ focusObjectId: "f" }, [focus, hop1, hop2], edges);
    const score = (id: string) => r.items.find((i) => i.object.id === id)?.score ?? -1;
    expect(score("h1")).toBeGreaterThan(score("h2"));
  });

  it("respects maxRelationDepth: a relation beyond the budget is not scored as direct", () => {
    // depends_on, not contains: this chain must not also qualify via the project-relation tier.
    const focus = obj({ id: "f", type: "task", title: "Focus" });
    const a = obj({ id: "a", type: "task", title: "One hop" });
    const b = obj({ id: "b", type: "task", title: "Two hops" });
    const hop3 = obj({ id: "h3", type: "task", title: "Three hops away" });
    const edges = [
      edge("depends_on", "f", "a"),
      edge("depends_on", "a", "b"),
      edge("depends_on", "b", "h3"),
    ];
    const r = buildContext({ focusObjectId: "f" }, [focus, a, b, hop3], edges, {
      ...DEFAULT_RETRIEVAL_BUDGET,
      maxRelationDepth: 1,
    });
    expect(r.items.some((i) => i.object.id === "a")).toBe(true);
    expect(r.items.some((i) => i.object.id === "h3")).toBe(false);
  });

  it("includes objects under the same project as the focus", () => {
    const project = obj({ id: "p", type: "project", title: "Project" });
    const focus = obj({ id: "t1", type: "task", title: "Focus task" });
    const sibling = obj({ id: "t2", type: "task", title: "Sibling task" });
    const outside = obj({ id: "t3", type: "task", title: "Outside" });
    const edges = [edge("contains", "p", "t1"), edge("contains", "p", "t2")];
    const r = buildContext({ focusObjectId: "t1" }, [project, focus, sibling, outside], edges);
    const ids = r.items.map((i) => i.object.id);
    expect(ids).toContain("t2");
    expect(ids).toContain("p");
    expect(ids).not.toContain("t3");
  });

  it("includes objects at the same location as the focus", () => {
    const place = obj({ id: "loc", type: "location", title: "Dorsel" });
    const focus = obj({ id: "a", type: "property", title: "Focus property" });
    const same = obj({ id: "b", type: "project", title: "Same place" });
    const elsewhere = obj({ id: "c", type: "project", title: "Elsewhere" });
    const edges = [edge("located_at", "a", "loc"), edge("located_at", "b", "loc")];
    const r = buildContext({ focusObjectId: "a" }, [place, focus, same, elsewhere], edges);
    const ids = r.items.map((i) => i.object.id);
    expect(ids).toContain("b");
    expect(ids).not.toContain("c");
  });

  it("boosts an object that shares a tag with the focus", () => {
    const focus = obj({ id: "f", type: "project", title: "Focus", tags: ["dorsel"] });
    const tagged = obj({ id: "t", type: "memory", title: "Tagged", tags: ["dorsel"] });
    const untagged = obj({ id: "u", type: "memory", title: "Untagged" });
    const r = buildContext({ focusObjectId: "f" }, [focus, tagged, untagged], []);
    const ids = r.items.map((i) => i.object.id);
    expect(ids).toContain("t");
    expect(ids).not.toContain("u");
  });

  it("matches an object type named in the query, with no focus at all", () => {
    const memory = obj({ id: "m", type: "memory", title: "Some fact" });
    const project = obj({ id: "p", type: "project", title: "Some project" });
    const r = buildContext({ query: "memories" }, [memory, project], []);
    expect(r.items.some((i) => i.object.id === "m")).toBe(true);
  });

  it("ranks free-text relevance the same direction as the command palette", () => {
    const match = obj({ id: "m1", type: "memory", title: "Tax document 2024" });
    const other = obj({ id: "m2", type: "memory", title: "Unrelated fact" });
    const r = buildContext({ query: "Tax 2024" }, [match, other], []);
    expect(r.items[0]?.object.id).toBe("m1");
  });

  it("never invents a semantic-similarity contribution: the weight is exported as zero", () => {
    expect(SEMANTIC_WEIGHT).toBe(0);
  });

  it("truncates at maxItems and reports it", () => {
    const focus = obj({ id: "f", type: "project", title: "Focus", tags: ["x"] });
    const many = Array.from({ length: 10 }, (_, i) =>
      obj({ id: `m${i}`, type: "memory", title: `Memory ${i}`, tags: ["x"] }),
    );
    const r = buildContext({ focusObjectId: "f" }, [focus, ...many], [], {
      maxItems: 3,
      maxTokens: 100_000,
      maxRelationDepth: 2,
    });
    expect(r.items).toHaveLength(3);
    expect(r.truncated).toBe(true);
  });

  it("truncates at maxTokens and reports it", () => {
    const focus = obj({ id: "f", type: "project", title: "Focus", tags: ["x"] });
    const long = obj({
      id: "m1",
      type: "memory",
      title: "M1",
      tags: ["x"],
      details: { detail: "x".repeat(400) },
    });
    const r = buildContext({ focusObjectId: "f" }, [focus, long], [], {
      maxItems: 10,
      maxTokens: 20,
      maxRelationDepth: 2,
    });
    expect(r.items).toHaveLength(1); // only the focus fits
    expect(r.truncated).toBe(true);
  });

  it("prefers higher confidence and more recent objects as tie-breakers only", () => {
    const focus = obj({ id: "f", type: "project", title: "Focus", tags: ["x"] });
    const highConfidence = obj({
      id: "a",
      type: "memory",
      title: "A",
      tags: ["x"],
      confidence: 90,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const lowConfidence = obj({
      id: "b",
      type: "memory",
      title: "B",
      tags: ["x"],
      confidence: 10,
      updatedAt: "2026-06-01T00:00:00.000Z",
    });
    // Stretches the recency span far beyond either candidate, so neither's small date difference
    // can outweigh a real confidence difference — recency stays a tie-breaker, not a signal.
    const farFuture = obj({
      id: "far",
      type: "note",
      title: "Unrelated",
      updatedAt: "2030-01-01T00:00:00.000Z",
    });
    const r = buildContext(
      { focusObjectId: "f" },
      [focus, highConfidence, lowConfidence, farFuture],
      [],
    );
    const score = (id: string) => r.items.find((i) => i.object.id === id)?.score ?? -1;
    // Both share the same base tag score; confidence tips A ahead even though B is newer.
    expect(score("a")).toBeGreaterThan(score("b"));
  });
});
