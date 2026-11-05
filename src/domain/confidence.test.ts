import { describe, expect, it } from "vitest";
import { confidenceBand } from "./confidence";

describe("confidenceBand", () => {
  it.each([
    [100, "high"],
    [75, "high"],
    [74, "medium"],
    [45, "medium"],
    [44, "low"],
    [40, "low"],
    [0, "low"],
  ] as const)("classifies %i as %s", (score, band) => {
    expect(confidenceBand(score)).toBe(band);
  });

  it("treats a missing score as unset, not low", () => {
    expect(confidenceBand(null)).toBe("unset");
    expect(confidenceBand(undefined)).toBe("unset");
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])("rejects out-of-range %s", (score) => {
    expect(() => confidenceBand(score)).toThrow(RangeError);
  });
});
