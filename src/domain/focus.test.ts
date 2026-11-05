import { describe, expect, it } from "vitest";
import { focusMinutes, formatFocus, monthCells, monthLevel } from "./focus";

describe("focus summaries", () => {
  it("adds the minutes of a range of days", () => {
    const s = [
      { day: "2026-10-30", minutes: 25 },
      { day: "2026-10-31", minutes: 50 },
      { day: "2026-11-01", minutes: 90 },
    ];
    expect(focusMinutes(s, "2026-10-31", "2026-10-31")).toBe(50);
    expect(focusMinutes(s, "2026-10-01", "2026-10-31")).toBe(75);
  });

  it("writes a duration the way the design does", () => {
    expect(formatFocus(0)).toBe("0 min");
    expect(formatFocus(45)).toBe("45 min");
    expect(formatFocus(400)).toBe("6 h 40");
    expect(formatFocus(125)).toBe("2 h 05");
  });

  it("darkens a day with the number of advances", () => {
    expect([0, 1, 3, 6, 12].map(monthLevel)).toEqual([0, 1, 2, 3, 4]);
  });

  it("lists a month with its Monday-first lead", () => {
    const c = monthCells("2026-10-15");
    expect(c.slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(c).toHaveLength(3 + 31);
  });
});
