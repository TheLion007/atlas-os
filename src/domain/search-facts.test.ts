import { describe, expect, it } from "vitest";
import type { ApiObject } from "./api-types";
import { deriveFacts } from "./object-facts";
import { searchObjects } from "./search";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { exampleSeed } from "@tests/fixtures/example-seed";

const data = buildFixtureData(exampleSeed());
const titles = (hits: { node: ApiObject }[]) => hits.map((h) => h.node.title);

describe("searchObjects", () => {
  it("returns nothing for an empty query", () => {
    expect(searchObjects(data.nodes, "")).toEqual([]);
    expect(searchObjects(data.nodes, "   ")).toEqual([]);
  });

  it("ranks a title prefix above a word-start match", () => {
    const hits = searchObjects(data.nodes, "mar");
    const names = titles(hits);
    expect(names[0]?.toLowerCase().startsWith("mar")).toBe(true);
    expect(names).toContain("Dorsel Marina"); // word start: found, but ranked below the prefixes
    expect(names.indexOf("Dorsel Marina")).toBeGreaterThan(names.indexOf("Marina 1BR purchase"));
  });

  it("requires every word to match somewhere", () => {
    expect(titles(searchObjects(data.nodes, "marina purchase"))).toContain("Marina 1BR purchase");
    expect(searchObjects(data.nodes, "marina zzzz")).toEqual([]);
  });

  it("matches by type name and tag, not just title", () => {
    expect(searchObjects(data.nodes, "risk").every((h) => h.score > 0)).toBe(true);
    expect(titles(searchObjects(data.nodes, "risk"))).toContain("Financing is declined");
    expect(searchObjects(data.nodes, "illustrative", { limit: 1000 }).length).toBe(
      data.nodes.length,
    );
  });

  it("matches text inside details, ranked below the title", () => {
    const hits = searchObjects(data.nodes, "waterfront");
    expect(titles(hits)).toEqual(["Dorsel Marina"]);
  });

  it("ignores case and diacritics", () => {
    const nodes: ApiObject[] = [
      {
        id: "1",
        type: "location",
        title: "Lindor",
        status: "active",
        tags: [],
        confidence: null,
        color: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    expect(titles(searchObjects(nodes, "LINDOR"))).toEqual(["Lindor"]);
  });

  it("does not treat regex characters as syntax", () => {
    expect(() => searchObjects(data.nodes, "(.*[")).not.toThrow();
    expect(searchObjects(data.nodes, "(.*[")).toEqual([]);
  });

  it("honours the limit", () => {
    expect(searchObjects(data.nodes, "e", { limit: 5 })).toHaveLength(5);
  });
});

describe("deriveFacts", () => {
  const facts = (key: string) => deriveFacts(seedId(key), data.nodes, data.edges);

  it("is null for an unknown object", () => {
    expect(deriveFacts("nope", data.nodes, data.edges)).toBeNull();
  });

  it("derives project progress from effort, and no progress for other types", () => {
    expect(facts("p_reloc")?.progress?.progress).toBeCloseTo(0.5);
    expect(facts("t_visa")?.progress).toBeNull();
  });

  it("derives a risk level", () => {
    expect(facts("r_price")?.riskLevel).toBe("high");
    expect(facts("r_fin")?.riskLevel).toBe("high");
    expect(facts("p_reloc")?.riskLevel).toBeNull();
  });

  it("derives slip against the baseline, with no stored slip", () => {
    const s = facts("m_purchase")?.schedule;
    expect(s?.date).toBe("2028-12-31");
    expect(s?.slipDays).toBe(92);
    expect(s?.drivenBy).toBeNull(); // slipped on its own plan, not pushed by a predecessor
  });

  it("names what blocks a task, and nothing for unblocked work", () => {
    expect(facts("t_valuation")?.blockedBy.map((b) => b.title)).toEqual([
      "Review service charge history",
    ]);
    expect(facts("t_charges")?.blockedBy).toEqual([]);
  });

  it("never marks an estimate as blocked by another estimate", () => {
    expect(facts("e_cap_actual")?.blockedBy).toEqual([]);
  });

  it("traces a delay to the object that pushed it", () => {
    // Push the chain: make the sale later than the savings milestone allows.
    const nodes = data.nodes.map((n) =>
      n.id === seedId("m_sold") ? { ...n, details: { ...n.details, date: "2028-09-30" } } : n,
    );
    const s = deriveFacts(seedId("m_savings"), nodes, data.edges)?.schedule;
    expect(s?.drivenBy?.title).toBe("Ironfield flat sold");
    expect(s?.date).toBe("2028-09-30");
    expect(s?.slipDays).toBe(92);
  });
});
