import { describe, expect, it } from "vitest";
import type { ProgressEntry } from "./api-types";
import {
  activeDays,
  bestDay,
  bestWeek,
  byProject,
  dayCounts,
  entriesOn,
  levelOf,
  streaks,
  weekdayOf,
  yearGrid,
} from "./history";

let n = 0;
const e = (day: string, projectId: string | null = null): ProgressEntry => ({
  id: ++n,
  at: `${day}T09:00:00Z`,
  day,
  projectId,
  objectId: null,
  kind: "task_done",
});

const TODAY = "2026-10-31"; // a Saturday

describe("the year grid", () => {
  it("is 53 Monday-first weeks ending with the current one", () => {
    const g = yearGrid([], TODAY);
    expect(g.columns).toHaveLength(53);
    expect(g.columns.every((c) => c.length === 7)).toBe(true);
    expect(weekdayOf(g.columns[0]![0]!.day)).toBe(0);
    const last = g.columns.at(-1)!;
    expect(last[5]).toMatchObject({ day: TODAY, isToday: true, future: false });
    expect(last[6]).toMatchObject({ day: "2026-11-01", future: true });
  });

  it("shades each day relative to the busiest one", () => {
    const g = yearGrid(
      [e("2026-10-30"), e("2026-10-29"), e("2026-10-29"), e("2026-10-29"), e("2026-10-29")],
      TODAY,
    );
    const cell = (day: string) => g.columns.flat().find((c) => c.day === day)!;
    expect(g.max).toBe(4);
    expect(cell("2026-10-29")).toMatchObject({ count: 4, level: 4 });
    expect(cell("2026-10-30")).toMatchObject({ count: 1, level: 1 });
    expect(cell("2026-10-28").level).toBe(0);
  });

  it("can be limited to one project", () => {
    const g = yearGrid([e("2026-10-30", "a"), e("2026-10-30", "b")], TODAY, 53, "a");
    expect(g.columns.flat().find((c) => c.day === "2026-10-30")?.count).toBe(1);
  });

  it("marks where each month starts", () => {
    const g = yearGrid([], TODAY, 53);
    // Labels never crowd each other: at least three columns apart.
    g.months
      .slice(1)
      .forEach((m, i) => expect(m.column - g.months[i]!.column).toBeGreaterThanOrEqual(3));
    expect(g.months.at(-1)?.month).toBe(9); // October
  });

  it("has four steps above empty", () => {
    expect([0, 1, 3, 5, 7, 8].map((c) => levelOf(c, 8))).toEqual([0, 1, 2, 3, 4, 4]);
    expect(levelOf(3, 0)).toBe(0);
  });
});

describe("streaks and records", () => {
  const log = [
    "2026-10-01",
    "2026-10-02",
    "2026-10-03",
    "2026-10-04", // a run of 4
    "2026-10-10",
    "2026-10-30",
    "2026-10-31", // the current run
  ].map((d) => e(d));

  it("finds the current and the longest run", () => {
    expect(streaks(log, TODAY)).toEqual({ current: 2, longest: 4, longestEnd: "2026-10-04" });
  });

  it("forgives a day that is not over yet", () => {
    expect(
      streaks(
        log.filter((x) => x.day !== TODAY),
        TODAY,
      ).current,
    ).toBe(1);
    expect(streaks([e("2026-10-10")], TODAY).current).toBe(0);
  });

  it("knows the best day and the best week", () => {
    const busy = [...log, e("2026-10-10"), e("2026-10-10"), e("2026-10-11")];
    expect(bestDay(busy)).toEqual({ day: "2026-10-10", count: 3 });
    expect(bestWeek(busy)).toMatchObject({ start: "2026-10-05", count: 4 });
    expect(bestDay([])).toBeNull();
  });

  it("counts the days with progress", () => {
    expect(activeDays(log)).toBe(7);
    expect(activeDays(log, "2026-10-30")).toBe(2);
  });
});

describe("the spread over projects and a day's detail", () => {
  const log = [
    e("2026-10-30", "a"),
    e("2026-10-30", "a"),
    e("2026-10-30", "b"),
    e("2026-10-29", null),
  ];

  it("ranks projects by how much work they got, unfiled last", () => {
    expect(byProject(log)).toEqual([
      { projectId: "a", count: 2 },
      { projectId: "b", count: 1 },
      { projectId: null, count: 1 },
    ]);
  });

  it("lists one day, optionally for one project", () => {
    expect(entriesOn(log, "2026-10-30")).toHaveLength(3);
    expect(entriesOn(log, "2026-10-30", "b")).toHaveLength(1);
    expect(dayCounts(log).get("2026-10-29")).toBe(1);
  });
});
