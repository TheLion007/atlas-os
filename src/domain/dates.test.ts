import { describe, expect, it } from "vitest";
import { addDays, diffDays, isValidIsoDate, maxDate } from "./dates";

describe("dates", () => {
  it("validates real calendar dates only", () => {
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2027-02-29")).toBe(false);
    expect(isValidIsoDate("2027-13-01")).toBe(false);
    expect(isValidIsoDate("2027-1-01")).toBe(false);
    expect(isValidIsoDate("not a date")).toBe(false);
  });

  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-01-01", 0)).toBe("2026-01-01");
  });

  it("computes signed whole-day differences", () => {
    expect(diffDays("2026-01-01", "2026-01-31")).toBe(30);
    expect(diffDays("2026-01-31", "2026-01-01")).toBe(-30);
    expect(diffDays("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("returns the later date", () => {
    expect(maxDate("2026-01-01", "2026-06-01")).toBe("2026-06-01");
    expect(maxDate("2027-01-01", "2026-06-01")).toBe("2027-01-01");
  });

  it("throws on invalid input rather than guessing", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addDays("2026-01-01", 1.5)).toThrow(RangeError);
    expect(() => diffDays("bad", "2026-01-01")).toThrow(RangeError);
  });
});
