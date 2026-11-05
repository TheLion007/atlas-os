import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import {
  calendarItems,
  localParts,
  monthWeeks,
  rescheduledDetails,
  stepAnchor,
  toInstant,
  weekOf,
} from "./calendar";

const obj = (id: string, type: ApiObject["type"], details: object, status = "active"): ApiObject =>
  ({
    id,
    type,
    title: id,
    status,
    tags: [],
    confidence: null,
    color: null,
    createdAt: "",
    updatedAt: "",
    details,
  }) as ApiObject;
const contains = (from: string, to: string): ApiEdge => ({
  id: `${from}-${to}`,
  kind: "contains",
  from,
  to,
  label: null,
  dependencyType: null,
  lagDays: null,
  createdAt: "",
});

const nodes = [
  obj("p", "project", { targetDate: "2026-12-05" }),
  obj("t1", "task", { due: "2026-11-03" }),
  obj("t2", "task", {}),
  obj("m1", "milestone", { date: "2026-11-20" }, "done"),
  obj("e1", "event", { startsAt: "2026-11-02T09:00:00.000Z", allDay: false }),
  obj("gone", "task", { due: "2026-11-04" }, "dropped"),
];
const edges = [contains("p", "t1"), contains("p", "m1")];

describe("calendar", () => {
  it("collects the dates other objects carry, plus events, in order", () => {
    const items = calendarItems(nodes, edges, 0);
    expect(items.map((i) => [i.id, i.kind, i.day, i.time])).toEqual([
      ["e1", "reminder", "2026-11-02", "09:00"],
      ["t1", "due", "2026-11-03", null],
      ["m1", "due", "2026-11-20", null],
      ["p", "due", "2026-12-05", null],
    ]);
    expect(items.find((i) => i.id === "t1")?.projectId).toBe("p");
    expect(items.find((i) => i.id === "m1")?.done).toBe(true);
  });

  it("reads an instant in the local time zone and back", () => {
    expect(localParts("2026-11-02T23:30:00Z", 60)).toEqual({ day: "2026-11-03", time: "00:30" });
    expect(toInstant("2026-11-03", "00:30", 60)).toBe("2026-11-02T23:30:00.000Z");
  });

  it("rewrites the right field when an item is moved", () => {
    const items = calendarItems(nodes, edges, 0);
    const task = nodes[1] as ApiObject;
    expect(rescheduledDetails(task, items[1]!, "2026-11-10", null, 0)).toEqual({
      due: "2026-11-10",
    });
    const ev = nodes[4] as ApiObject;
    expect(rescheduledDetails(ev, items[0]!, "2026-11-04", "14:00", 0).startsAt).toBe(
      "2026-11-04T14:00:00.000Z",
    );
  });

  it("lays a month out in Monday-first weeks", () => {
    const w = monthWeeks("2026-11-15");
    expect(w[0]![0]).toBe("2026-10-26");
    expect(w.at(-1)!.at(-1)).toBe("2026-12-06");
    expect(w).toHaveLength(6);
    expect(weekOf("2026-11-04")[0]).toBe("2026-11-02");
  });

  it("steps by the unit of the view", () => {
    expect(stepAnchor("2026-11-15", "month", 1)).toBe("2026-12-01");
    expect(stepAnchor("2026-01-15", "month", -1)).toBe("2025-12-01");
    expect(stepAnchor("2026-11-15", "week", -1)).toBe("2026-11-08");
    expect(stepAnchor("2026-11-15", "day", 1)).toBe("2026-11-16");
  });
});
