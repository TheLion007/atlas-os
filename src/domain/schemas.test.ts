import { describe, expect, it } from "vitest";
import { createEdgeSchema, createObjectSchema } from "./schemas";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("createObjectSchema — spine", () => {
  it("applies defaults", () => {
    const o = createObjectSchema.parse({ type: "task", title: "  Book viewing  ", details: {} });
    expect(o.title).toBe("Book viewing");
    expect(o.status).toBe("active");
    expect(o.tags).toEqual([]);
    expect(o.confidence).toBeNull();
  });

  it("rejects an empty title and out-of-range confidence", () => {
    expect(createObjectSchema.safeParse({ type: "task", title: " ", details: {} }).success).toBe(
      false,
    );
    expect(
      createObjectSchema.safeParse({ type: "task", title: "x", confidence: 101, details: {} })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown type", () => {
    expect(createObjectSchema.safeParse({ type: "widget", title: "x", details: {} }).success).toBe(
      false,
    );
  });

  it("rejects derived values that must never be stored", () => {
    const o = createObjectSchema.parse({
      type: "project",
      title: "P",
      details: { progress: 0.5, level: "high" },
    });
    expect(o.details).not.toHaveProperty("progress");
  });
});

describe("project and sub-project", () => {
  it("accepts a project with a budget", () => {
    const r = createObjectSchema.safeParse({
      type: "project",
      title: "Dorsel Marina Apartment #01",
      details: {
        budgetAmount: 420000,
        budgetCurrency: "EUR",
        startDate: "2026-01-01",
        targetDate: "2031-06-30",
      },
    });
    expect(r.success).toBe(true);
  });

  it("requires amount and currency together", () => {
    const r = createObjectSchema.safeParse({
      type: "project",
      title: "P",
      details: { budgetAmount: 10 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a target date before the start date", () => {
    const r = createObjectSchema.safeParse({
      type: "project",
      title: "P",
      details: { startDate: "2027-01-01", targetDate: "2026-01-01" },
    });
    expect(r.success).toBe(false);
  });

  it("rejects an impossible calendar date", () => {
    expect(
      createObjectSchema.safeParse({
        type: "project",
        title: "P",
        details: { startDate: "2027-02-30" },
      }).success,
    ).toBe(false);
  });

  it("forbids an independent budget on a sub-project", () => {
    const r = createObjectSchema.safeParse({
      type: "sub_project",
      title: "S",
      details: { budgetAmount: 1, budgetCurrency: "EUR" },
    });
    expect(r.success).toBe(false);
  });
});

describe("estimate", () => {
  it("requires a currency for monetary units", () => {
    const r = createObjectSchema.safeParse({
      type: "estimate",
      title: "Equity",
      details: { amount: 109_400 },
    });
    expect(r.success).toBe(false);
  });

  it("forbids a currency on non-monetary units", () => {
    const r = createObjectSchema.safeParse({
      type: "estimate",
      title: "Savings rate",
      details: { amount: 20, unit: "percent", currency: "EUR", dataKind: "assumption" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a fully described estimate and keeps dataKind separate from status", () => {
    const o = createObjectSchema.parse({
      type: "estimate",
      title: "Equity",
      confidence: 40,
      details: {
        amount: 109_400,
        currency: "EUR",
        category: "capital",
        dataKind: "target",
        source: "illustrative",
      },
    });
    expect(o.status).toBe("active");
    if (o.type === "estimate") expect(o.details.dataKind).toBe("target");
  });
});

describe("location", () => {
  it("allows a place with no coordinates yet (never faked)", () => {
    const o = createObjectSchema.parse({ type: "location", title: "Dorsel Marina", details: {} });
    if (o.type === "location") expect(o.details.lat).toBeNull();
  });

  it("requires latitude and longitude together", () => {
    const r = createObjectSchema.safeParse({
      type: "location",
      title: "X",
      details: { lat: 25.08 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects out-of-range coordinates and bad country codes", () => {
    expect(
      createObjectSchema.safeParse({ type: "location", title: "X", details: { lat: 91, lng: 0 } })
        .success,
    ).toBe(false);
    expect(
      createObjectSchema.safeParse({ type: "location", title: "X", details: { countryCode: "be" } })
        .success,
    ).toBe(false);
  });

  it("works identically for any country", () => {
    for (const [cc, lat, lng] of [
      ["AE", 25.0805, 55.1403],
      ["BE", 50.8503, 4.3517],
    ] as const) {
      const r = createObjectSchema.safeParse({
        type: "location",
        title: cc,
        details: { countryCode: cc, lat, lng, coordinatesSource: "manual" },
      });
      expect(r.success).toBe(true);
    }
  });
});

describe("decision — no close without a reason", () => {
  const base = {
    type: "decision" as const,
    title: "Which apartment?",
    details: {
      question: "Which apartment?",
      options: [
        { id: "a", label: "Marina 1BR" },
        { id: "b", label: "JLT 1BR" },
      ],
    },
  };

  it("allows an open decision", () => {
    expect(createObjectSchema.safeParse(base).success).toBe(true);
  });

  it("rejects closing without an option", () => {
    expect(createObjectSchema.safeParse({ ...base, status: "done" }).success).toBe(false);
  });

  it("rejects closing without a rationale", () => {
    const r = createObjectSchema.safeParse({
      ...base,
      status: "done",
      details: { ...base.details, resolvedOptionId: "a", rationale: "   " },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a resolved option that is not among the options", () => {
    const r = createObjectSchema.safeParse({
      ...base,
      details: { ...base.details, resolvedOptionId: "zzz", rationale: "because" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts a properly closed decision", () => {
    const r = createObjectSchema.safeParse({
      ...base,
      status: "done",
      details: {
        ...base.details,
        resolvedOptionId: "a",
        rationale: "Best yield at acceptable risk.",
      },
    });
    expect(r.success).toBe(true);
  });
});

describe("risk", () => {
  it("requires probability and impact within 1–5", () => {
    expect(
      createObjectSchema.safeParse({
        type: "risk",
        title: "R",
        details: { probability: 3, impact: 4 },
      }).success,
    ).toBe(true);
    expect(
      createObjectSchema.safeParse({
        type: "risk",
        title: "R",
        details: { probability: 0, impact: 4 },
      }).success,
    ).toBe(false);
    expect(
      createObjectSchema.safeParse({
        type: "risk",
        title: "R",
        details: { probability: 3, impact: 6 },
      }).success,
    ).toBe(false);
    expect(
      createObjectSchema.safeParse({ type: "risk", title: "R", details: { probability: 3 } })
        .success,
    ).toBe(false);
  });
});

describe("createEdgeSchema", () => {
  it("defaults depends_on to finish-to-start with zero lag", () => {
    const e = createEdgeSchema.parse({ kind: "depends_on", from: A, to: B });
    expect(e.dependencyType).toBe("fs");
    expect(e.lagDays).toBe(0);
  });

  it("keeps a lead (negative lag)", () => {
    expect(
      createEdgeSchema.parse({ kind: "depends_on", from: A, to: B, lagDays: -14 }).lagDays,
    ).toBe(-14);
  });

  it("rejects dependency fields on other kinds", () => {
    expect(
      createEdgeSchema.safeParse({ kind: "contains", from: A, to: B, lagDays: 3 }).success,
    ).toBe(false);
  });

  it("rejects self edges, bad ids and unknown kinds", () => {
    expect(createEdgeSchema.safeParse({ kind: "references", from: A, to: A }).success).toBe(false);
    expect(createEdgeSchema.safeParse({ kind: "references", from: "x", to: B }).success).toBe(
      false,
    );
    expect(createEdgeSchema.safeParse({ kind: "related_to", from: A, to: B }).success).toBe(false);
  });

  it("allows a label on references edges (assignee / owner)", () => {
    expect(
      createEdgeSchema.parse({ kind: "references", from: A, to: B, label: "assignee" }).label,
    ).toBe("assignee");
  });
});
