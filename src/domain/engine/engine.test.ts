import { describe, expect, it } from "vitest";
import { CycleError, computeBlocked, computeSchedule, riskLevel, rollUpProgress } from "./index";
import type { EdgeRef } from "../graph-validation";

const contains = (from: string, to: string): EdgeRef => ({ kind: "contains", from, to });
const dep = (from: string, to: string, lagDays?: number) => ({
  kind: "depends_on" as const,
  from,
  to,
  lagDays,
});

describe("rollUpProgress", () => {
  it("weights tasks by effort", () => {
    const res = rollUpProgress(
      [
        { id: "p", type: "project", status: "active" },
        { id: "t1", type: "task", status: "done", effort: 3 },
        { id: "t2", type: "task", status: "active", effort: 1 },
      ],
      [contains("p", "t1"), contains("p", "t2")],
    );
    expect(res.get("p")).toEqual({ progress: 0.75, doneEffort: 3, totalEffort: 4 });
  });

  it("uses the default weight when effort is missing", () => {
    const res = rollUpProgress(
      [
        { id: "p", type: "project", status: "active" },
        { id: "t1", type: "task", status: "done" },
        { id: "t2", type: "task", status: "draft" },
      ],
      [contains("p", "t1"), contains("p", "t2")],
    );
    expect(res.get("p")?.progress).toBe(0.5);
  });

  it("computes a sub-project from its own tasks, like a project", () => {
    const res = rollUpProgress(
      [
        { id: "p", type: "project", status: "active" },
        { id: "s", type: "sub_project", status: "active" },
        { id: "site", type: "task", status: "done" },
        { id: "other", type: "task", status: "active" },
      ],
      [contains("p", "s"), contains("s", "site"), contains("s", "other")],
    );
    expect(res.get("s")).toEqual({ progress: 0.5, doneEffort: 1, totalEffort: 2 });
  });

  it("counts a task once in the project even when it sits in the project and in its sub-project", () => {
    const res = rollUpProgress(
      [
        { id: "p", type: "project", status: "active" },
        { id: "s", type: "sub_project", status: "active" },
        { id: "shared", type: "task", status: "done" },
        { id: "open", type: "task", status: "active" },
      ],
      [contains("p", "s"), contains("p", "shared"), contains("s", "shared"), contains("p", "open")],
    );
    expect(res.get("s")).toEqual({ progress: 1, doneEffort: 1, totalEffort: 1 });
    // two tasks in the project (shared, open), not three
    expect(res.get("p")).toEqual({ progress: 0.5, doneEffort: 1, totalEffort: 2 });
  });

  it("reports no data, not 0%, when there is nothing to measure", () => {
    const res = rollUpProgress([{ id: "p", type: "project", status: "active" }], []);
    expect(res.get("p")?.progress).toBeNull();
  });

  it("excludes dropped tasks from the total instead of counting them as failures", () => {
    const res = rollUpProgress(
      [
        { id: "p", type: "project", status: "active" },
        { id: "t1", type: "task", status: "done", effort: 2 },
        { id: "t2", type: "task", status: "dropped", effort: 8 },
      ],
      [contains("p", "t1"), contains("p", "t2")],
    );
    expect(res.get("p")?.progress).toBe(1);
  });

  it("rolls up through sub-projects by effort, not by count", () => {
    const res = rollUpProgress(
      [
        { id: "p", type: "project", status: "active" },
        { id: "s1", type: "sub_project", status: "active" },
        { id: "s2", type: "sub_project", status: "active" },
        { id: "a", type: "task", status: "done", effort: 9 },
        { id: "b", type: "task", status: "active", effort: 1 },
        { id: "c", type: "task", status: "active", effort: 1 },
      ],
      [
        contains("p", "s1"),
        contains("p", "s2"),
        contains("s1", "a"),
        contains("s2", "b"),
        contains("s2", "c"),
      ],
    );
    expect(res.get("s1")?.progress).toBe(1);
    expect(res.get("s2")?.progress).toBe(0);
    expect(res.get("p")?.progress).toBeCloseTo(9 / 11);
  });

  it("ignores non-task descendants such as milestones", () => {
    const res = rollUpProgress(
      [
        { id: "p", type: "project", status: "active" },
        { id: "m", type: "milestone", status: "done" },
      ],
      [contains("p", "m")],
    );
    expect(res.get("p")?.progress).toBeNull();
  });

  it("throws on a containment cycle instead of recursing forever", () => {
    expect(() =>
      rollUpProgress(
        [
          { id: "a", type: "project", status: "active" },
          { id: "b", type: "sub_project", status: "active" },
        ],
        [contains("a", "b"), contains("b", "a")],
      ),
    ).toThrow(CycleError);
  });
});

describe("riskLevel", () => {
  it.each([
    [1, 1, "low"],
    [2, 2, "low"],
    [1, 5, "medium"],
    [3, 3, "medium"],
    [2, 5, "high"],
    [4, 4, "high"],
    [5, 4, "critical"],
    [5, 5, "critical"],
  ] as const)("p=%i × i=%i is %s", (p, i, level) => {
    expect(riskLevel(p, i)).toBe(level);
  });

  it("rejects values off the 5×5 scale", () => {
    expect(() => riskLevel(0, 3)).toThrow(RangeError);
    expect(() => riskLevel(3, 6)).toThrow(RangeError);
    expect(() => riskLevel(2.5, 3)).toThrow(RangeError);
  });
});

describe("computeBlocked", () => {
  const nodes = [
    { id: "a", status: "active" as const },
    { id: "b", status: "active" as const },
    { id: "c", status: "done" as const },
    { id: "d", status: "dropped" as const },
  ];

  it("blocks an object while a predecessor is unfinished", () => {
    expect(computeBlocked(nodes, [dep("a", "b")]).get("a")).toEqual({
      blockedBy: ["b"],
      broken: [],
    });
  });

  it("does not block once the predecessor is done", () => {
    expect(computeBlocked(nodes, [dep("a", "c")]).has("a")).toBe(false);
  });

  it("flags a dropped predecessor as broken, not blocking", () => {
    expect(computeBlocked(nodes, [dep("a", "d")]).get("a")).toEqual({
      blockedBy: [],
      broken: ["d"],
    });
  });

  it("never marks a finished or dropped object as blocked", () => {
    const out = computeBlocked(nodes, [dep("c", "b"), dep("d", "b")]);
    expect(out.size).toBe(0);
  });

  it("ignores other edge kinds and unknown ids", () => {
    const out = computeBlocked(nodes, [
      { kind: "references", from: "a", to: "b" },
      dep("a", "ghost"),
    ]);
    expect(out.size).toBe(0);
  });
});

describe("computeSchedule", () => {
  it("leaves independent dates untouched with zero slip", () => {
    const r = computeSchedule([{ id: "m", date: "2027-01-01" }], []);
    expect(r.get("m")).toEqual({
      id: "m",
      plannedDate: "2027-01-01",
      scheduledDate: "2027-01-01",
      slipDays: 0,
      drivenBy: null,
    });
  });

  it("pushes a dependant later when its predecessor slips", () => {
    const nodes = [
      { id: "purchase", date: "2027-06-30" },
      { id: "move", date: "2027-07-15" },
    ];
    const edges = [dep("move", "purchase", 30)];
    const r = computeSchedule(nodes, edges, new Map([["purchase", "2027-12-31"]]));
    expect(r.get("purchase")?.slipDays).toBe(184);
    expect(r.get("move")?.scheduledDate).toBe("2028-01-30");
    expect(r.get("move")?.slipDays).toBe(199);
    expect(r.get("move")?.drivenBy).toBe("purchase");
  });

  it("does not move a dependant that already has enough slack", () => {
    const nodes = [
      { id: "a", date: "2027-01-01" },
      { id: "b", date: "2027-12-01" },
    ];
    const r = computeSchedule(nodes, [dep("b", "a", 10)]);
    expect(r.get("b")?.scheduledDate).toBe("2027-12-01");
    expect(r.get("b")?.drivenBy).toBeNull();
    expect(r.get("b")?.slipDays).toBe(0);
  });

  it("takes the latest of several predecessors and names the driver", () => {
    const nodes = [
      { id: "x", date: "2027-01-01" },
      { id: "y", date: "2027-03-01" },
      { id: "z", date: "2027-02-01" },
    ];
    const r = computeSchedule(nodes, [dep("z", "x"), dep("z", "y")]);
    expect(r.get("z")?.scheduledDate).toBe("2027-03-01");
    expect(r.get("z")?.drivenBy).toBe("y");
  });

  it("propagates through a chain", () => {
    const nodes = [
      { id: "a", date: "2027-01-01" },
      { id: "b", date: "2027-01-02" },
      { id: "c", date: "2027-01-03" },
    ];
    const r = computeSchedule(
      nodes,
      [dep("b", "a", 10), dep("c", "b", 10)],
      new Map([["a", "2027-02-01"]]),
    );
    expect(r.get("b")?.scheduledDate).toBe("2027-02-11");
    expect(r.get("c")?.scheduledDate).toBe("2027-02-21");
  });

  it("derives a date for an undated dependant from its predecessor", () => {
    const r = computeSchedule(
      [
        { id: "a", date: "2027-05-01" },
        { id: "b", date: null },
      ],
      [dep("b", "a", 7)],
    );
    expect(r.get("b")?.scheduledDate).toBe("2027-05-08");
    expect(r.get("b")?.slipDays).toBeNull();
  });

  it("measures slip against an explicit baseline", () => {
    const r = computeSchedule([{ id: "m", date: "2027-03-01", baselineDate: "2027-01-01" }], []);
    expect(r.get("m")?.slipDays).toBe(59);
  });

  it("supports lead (negative lag)", () => {
    const r = computeSchedule(
      [
        { id: "a", date: "2027-06-01" },
        { id: "b", date: "2027-01-01" },
      ],
      [dep("b", "a", -10)],
    );
    expect(r.get("b")?.scheduledDate).toBe("2027-05-22");
  });

  it("does not write anything back: overrides only affect the result", () => {
    const nodes = [{ id: "m", date: "2027-01-01" }];
    computeSchedule(nodes, [], new Map([["m", "2030-01-01"]]));
    expect(nodes[0]?.date).toBe("2027-01-01");
  });

  it("throws on a dependency cycle", () => {
    const nodes = [
      { id: "a", date: "2027-01-01" },
      { id: "b", date: "2027-01-01" },
    ];
    expect(() => computeSchedule(nodes, [dep("a", "b"), dep("b", "a")])).toThrow(CycleError);
  });

  it("is deterministic regardless of input order", () => {
    const nodes = [
      { id: "a", date: "2027-01-01" },
      { id: "b", date: "2027-01-05" },
      { id: "c", date: "2027-01-02" },
    ];
    const edges = [dep("c", "a", 30), dep("b", "c", 2)];
    const one = computeSchedule(nodes, edges);
    const two = computeSchedule([...nodes].reverse(), [...edges].reverse());
    for (const id of ["a", "b", "c"]) expect(one.get(id)).toEqual(two.get(id));
  });
});
