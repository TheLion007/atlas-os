import { describe, expect, it } from "vitest";
import type { FxRate } from "./api-types";
import { convertAmount, sumInBase } from "./money";

const rate = (from: string, to: string, r: number, asOf = "2026-09-01"): FxRate => ({
  from,
  to,
  rate: r,
  asOf,
  source: "manual",
});

describe("convertAmount", () => {
  it("returns the amount unchanged for the same currency, with no rate needed", () => {
    expect(convertAmount(100, "EUR", "EUR", [])).toBe(100);
  });

  it("uses a direct rate", () => {
    expect(convertAmount(1000, "AED", "EUR", [rate("AED", "EUR", 0.25)])).toBe(250);
  });

  it("falls back to the inverse of the opposite direction", () => {
    expect(convertAmount(1000, "AED", "EUR", [rate("EUR", "AED", 4)])).toBe(250);
  });

  it("prefers the most recent rate", () => {
    const rates = [rate("AED", "EUR", 0.2, "2026-01-01"), rate("AED", "EUR", 0.25, "2026-09-01")];
    expect(convertAmount(100, "AED", "EUR", rates)).toBe(25);
  });

  it("does not invent a rate: no rate means unconvertible", () => {
    expect(convertAmount(100, "AED", "EUR", [])).toBeNull();
    expect(convertAmount(100, "AED", "EUR", [rate("USD", "EUR", 0.9)])).toBeNull();
  });

  it("does not triangulate through a third currency", () => {
    expect(
      convertAmount(100, "AED", "EUR", [rate("AED", "USD", 0.27), rate("USD", "EUR", 0.9)]),
    ).toBeNull();
  });
});

describe("sumInBase", () => {
  it("sums mixed currencies into the base", () => {
    const sum = sumInBase(
      [
        { amount: 100, currency: "EUR", label: "a" },
        { amount: 400, currency: "AED", label: "b" },
      ],
      "EUR",
      [rate("AED", "EUR", 0.25)],
    );
    expect(sum).toEqual({ total: 200, unconverted: [] });
  });

  it("reports what it could not convert instead of hiding it", () => {
    const sum = sumInBase(
      [
        { amount: 100, currency: "EUR", label: "kept" },
        { amount: 50, currency: "GBP", label: "no rate" },
      ],
      "EUR",
      [],
    );
    expect(sum.total).toBe(100);
    expect(sum.unconverted.map((i) => i.label)).toEqual(["no rate"]);
  });

  it("is zero for nothing", () => {
    expect(sumInBase([], "EUR", [])).toEqual({ total: 0, unconverted: [] });
  });
});
