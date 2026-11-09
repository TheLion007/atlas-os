import { describe, expect, it } from "vitest";
import type { ApiObject } from "@/domain/api-types";
import { buildObject, initialValues, valuesFromObject } from "./form-spec";

const lookup = (nodes: Pick<ApiObject, "id" | "type">[]) => (id: string) =>
  nodes.find((n) => n.id === id);

describe("financial value form", () => {
  it("starts as an actual, manually entered amount, with any preset applied", () => {
    const v = initialValues("estimate", { preset: { category: "liability", currency: "CHF" } });
    expect(v.fields).toMatchObject({
      dataKind: "actual",
      unit: "currency",
      source: "manual",
      category: "liability",
      currency: "CHF",
    });
  });

  it("builds a value, relating it to what it is the value of", () => {
    const v = initialValues("estimate");
    v.fields = { ...v.fields, title: "Flat", amount: "310000", currency: "eur", category: "asset" };
    v.relations = { parent: "p1" };
    const built = buildObject("estimate", v, lookup([{ id: "p1", type: "property" }]));
    expect(built.ok).toBe(true);
    expect(built.input?.details).toMatchObject({
      amount: 310000,
      currency: "EUR",
      category: "asset",
    });
    expect(built.relations).toEqual([{ kind: "estimates", direction: "out", other: "p1" }]);
  });

  it("requires a currency for money, and drops it for a percentage", () => {
    const v = initialValues("estimate");
    v.fields = { ...v.fields, title: "x", amount: "5", currency: "" };
    expect(buildObject("estimate", v, lookup([])).errors.currency).toBe("form.error.required");
    v.fields = { ...v.fields, unit: "percent", dataKind: "assumption", currency: "EUR" };
    const built = buildObject("estimate", v, lookup([]));
    expect(built.ok).toBe(true);
    expect(built.input?.details).toMatchObject({ unit: "percent", currency: null });
  });
});

describe("transaction form", () => {
  it("records a positive, dated amount through an account", () => {
    const v = initialValues("transaction", { preset: { date: "2026-09-21", currency: "EUR" } });
    v.fields = { ...v.fields, title: "Groceries", amount: "42,50", subcategory: "Food" };
    v.relations = { account: "acc" };
    const built = buildObject("transaction", v, lookup([{ id: "acc", type: "estimate" }]));
    expect(built.ok).toBe(true);
    expect(built.input?.details).toMatchObject({
      date: "2026-09-21",
      amount: 42.5,
      currency: "EUR",
      kind: "expense",
      subcategory: "Food",
    });
    expect(built.relations).toEqual([
      { kind: "references", direction: "out", other: "acc", label: "account" },
    ]);
  });

  it("refuses a zero amount and a missing date", () => {
    const v = initialValues("transaction");
    v.fields = { ...v.fields, title: "x", amount: "0", currency: "EUR" };
    const built = buildObject("transaction", v, lookup([]));
    expect(built.errors.amount).toBe("form.error.positive");
    expect(built.errors.date).toBe("form.error.required");
  });
});

describe("document form", () => {
  it("edits metadata without losing the file's own facts", () => {
    const doc: ApiObject = {
      id: "d",
      type: "document",
      title: "Notice",
      status: "active",
      tags: [],
      confidence: null,
      color: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      details: { mime: "application/pdf", storagePath: "files/1/a.pdf", kind: "other" },
    };
    const v = valuesFromObject(doc);
    v.fields = { ...v.fields, kind: "tax", description: "Yearly" };
    const built = buildObject("document", v, lookup([]));
    expect(built.ok).toBe(true);
    // The patch carries the edited fields and keeps the mime; storagePath is untouched (merged).
    expect(built.input?.details).toMatchObject({
      mime: "application/pdf",
      kind: "tax",
      description: "Yearly",
    });
    expect(built.input?.details).not.toHaveProperty("storagePath");
  });
});

describe("adding something from a sub-project", () => {
  const sub = { id: "s1", type: "sub_project" as const };
  const FILL: Record<string, Record<string, string>> = {
    task: {},
    milestone: { date: "2027-01-15" },
    decision: { question: "Which colour?" },
    risk: { probability: "3", impact: "3" },
  };

  for (const type of ["task", "milestone", "decision", "risk"] as const) {
    it(`a ${type} is held by the sub-project (a "contains" link, never a plain reference)`, () => {
      const v = initialValues(type);
      v.fields = { ...v.fields, title: "From the sub-project", ...FILL[type] };
      v.relations = { parent: sub.id };
      const built = buildObject(type, v, lookup([sub]));
      expect(built.ok).toBe(true);
      expect(built.relations).toEqual([{ kind: "contains", direction: "in", other: sub.id }]);
    });
  }
});
