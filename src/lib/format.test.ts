import { describe, expect, it } from "vitest";
import {
  formatAgo,
  formatDate,
  formatDelta,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuarter,
} from "./format";

describe("formatMoney", () => {
  it("formats any currency from data, not a hard-coded one", () => {
    expect(formatMoney(109400, "EUR")).toContain("109,400");
    expect(formatMoney(109400, "EUR")).toContain("€");
    expect(formatMoney(1500000, "AED")).toContain("1,500,000");
    expect(formatMoney(1500000, "AED")).not.toContain("€");
  });

  it("supports a compact form", () => {
    expect(formatMoney(1_250_000, "EUR", { compact: true })).toMatch(/1\.[23][Mm]/);
  });

  it("rejects an invalid currency code rather than guessing", () => {
    expect(() => formatMoney(1, "not-a-code")).toThrow();
  });
});

describe("formatPercent", () => {
  it("rounds a fraction", () => expect(formatPercent(0.4286)).toBe("43%"));
  it("never renders 'no data' as 0%", () => expect(formatPercent(null)).toBe("—"));
  it("renders a real zero as 0%", () => expect(formatPercent(0)).toBe("0%"));
});

describe("formatDelta", () => {
  it("uses a true minus sign and an explicit plus", () => {
    expect(formatDelta(12)).toBe("+12");
    expect(formatDelta(-4)).toBe("−4");
    expect(formatDelta(0)).toBe("0");
  });
});

describe("formatNumber", () => {
  it("groups digits", () => expect(formatNumber(1234567)).toBe("1,234,567"));
});

describe("formatDate / formatQuarter", () => {
  it("formats a calendar date without time-zone drift", () => {
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDate("2028-02-29")).toBe("29 Feb 2028");
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("names quarters", () => {
    expect(formatQuarter("2031-06-30")).toBe("2031 Q2");
    expect(formatQuarter("2029-01-01")).toBe("2029 Q1");
    expect(formatQuarter("2032-12-31")).toBe("2032 Q4");
  });

  it("rejects impossible dates", () => {
    expect(() => formatDate("2027-02-30")).toThrow(RangeError);
    expect(() => formatQuarter("nope")).toThrow(RangeError);
  });
});

describe("formatAgo", () => {
  const now = new Date("2026-09-21T12:00:00Z");
  it.each([
    ["2026-09-21T11:59:40Z", "just now"],
    ["2026-09-21T11:55:00Z", "5 min ago"],
    ["2026-09-21T09:00:00Z", "3 h ago"],
    ["2026-09-18T12:00:00Z", "3 d ago"],
  ])("%s → %s", (iso, expected) => expect(formatAgo(iso, now)).toBe(expected));
});
