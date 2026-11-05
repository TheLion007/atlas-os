import { describe, expect, it } from "vitest";
import { OBJECT_TYPES } from "@/domain/enums";
import { buildFixtureData } from "@/seed/fixtures";
import { neutralSeed } from "@/seed/neutral-fr";
import { exampleSeed } from "@tests/fixtures/example-seed";
import type { ApiEdge, ApiObject } from "./api-types";
import { countOf, planDeletion, presentCounts } from "./deletion";

const obj = (id: string, type: ApiObject["type"], title = id): ApiObject => ({
  id,
  type,
  title,
  status: "active",
  tags: [],
  confidence: null,
  color: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
let n = 0;
const edge = (kind: ApiEdge["kind"], from: string, to: string): ApiEdge => ({
  id: `e${++n}`,
  kind,
  from,
  to,
  label: null,
  dependencyType: null,
  lagDays: null,
  createdAt: "2026-01-01T00:00:00Z",
});

describe("what deleting an object takes with it", () => {
  const nodes = [
    obj("plan", "plan"),
    obj("proj", "project"),
    obj("other", "project"),
    obj("sub", "sub_project"),
    obj("t1", "task"),
    obj("t2", "task"),
    obj("m", "milestone"),
    obj("note", "note"),
    obj("shared", "note"),
    obj("doc", "document"),
    obj("budget", "estimate"),
    obj("risk", "risk"),
    obj("dec", "decision"),
    obj("loc", "location"),
  ];
  const edges = [
    edge("contains", "plan", "proj"),
    edge("contains", "proj", "sub"),
    edge("contains", "proj", "t1"),
    edge("contains", "sub", "t2"),
    edge("contains", "proj", "m"),
    edge("contains", "proj", "risk"),
    edge("contains", "proj", "dec"),
    edge("references", "note", "proj"),
    edge("references", "shared", "proj"),
    edge("references", "shared", "other"),
    edge("references", "doc", "proj"),
    edge("estimates", "budget", "proj"),
    edge("located_at", "proj", "loc"),
    edge("depends_on", "other", "proj"),
  ];

  it("counts the contained objects at any depth, plus what hangs only off them", () => {
    const plan = planDeletion(nodes, edges, "proj")!;
    expect(plan.counts).toMatchObject({
      subProjects: 1,
      tasks: 2,
      milestones: 1,
      risks: 1,
      decisions: 1,
      notes: 1,
      documents: 1,
      budgets: 1,
      others: 0,
    });
    expect(plan.extra).toBe(plan.others.length);
    expect(new Set(plan.all).size).toBe(plan.all.length);
    expect(plan.all[0]).toBe("proj");
    // not the plan above, not the note shared with another project, not the place, not a sibling
    for (const stays of ["plan", "shared", "other", "loc"]) expect(plan.all).not.toContain(stays);
  });

  it("says nothing extra for an object that is alone", () => {
    expect(planDeletion(nodes, edges, "t1")!.extra).toBe(0);
    expect(planDeletion(nodes, edges, "loc")!.extra).toBe(0);
    expect(planDeletion(nodes, edges, "missing")).toBeNull();
  });

  it("lists the counts that are present, in a stable order", () => {
    const plan = planDeletion(nodes, edges, "plan")!;
    expect(plan.counts.projects).toBe(1);
    expect(presentCounts(plan.counts).map((c) => c.key)).toEqual([
      "projects",
      "subProjects",
      "tasks",
      "milestones",
      "decisions",
      "risks",
      "notes",
      "documents",
      "budgets",
    ]);
    expect(countOf([])).toMatchObject({ tasks: 0, others: 0 });
  });

  it("offers to keep the children where the model lets them move up", () => {
    // a sub-project under a project: its tasks can move up to the project
    const p = planDeletion(nodes, edges, "sub")!;
    expect(p.canKeepChildren).toBe(true);
    expect(p.keep.ids).toEqual(["sub"]);
    expect(p.keep.reattach).toEqual([{ kind: "contains", from: "proj", to: "t2" }]);
  });

  it("does not offer it when a child could not sit under the parent", () => {
    // a project in a plan: a plan holds projects only, so tasks and sub-projects cannot move up
    expect(planDeletion(nodes, edges, "proj")!.canKeepChildren).toBe(false);
  });

  it("lets a plan's projects stand on their own", () => {
    const p = planDeletion(nodes, edges, "plan")!;
    expect(p.canKeepChildren).toBe(true);
    expect(p.keep.reattach).toEqual([]);
  });

  it("moves a note that was about the deleted object to its parent", () => {
    const g = [
      obj("proj", "project"),
      obj("mid", "sub_project"),
      obj("t", "task"),
      obj("note", "note"),
    ];
    const e = [
      edge("contains", "proj", "mid"),
      edge("contains", "mid", "t"),
      edge("references", "note", "mid"),
    ];
    const p = planDeletion(g, e, "mid")!;
    expect(p.canKeepChildren).toBe(true);
    expect(p.keep.reattach).toEqual(
      expect.arrayContaining([
        { kind: "contains", from: "proj", to: "t" },
        { kind: "references", from: "note", to: "proj" },
      ]),
    );
  });

  it("does not offer to keep sub-projects that would have no parent", () => {
    const g = [obj("proj", "project"), obj("sub", "sub_project")];
    const e = [edge("contains", "proj", "sub")];
    expect(planDeletion(g, e, "proj")!.canKeepChildren).toBe(false);
  });
});

describe("every kind of object, in the example data", () => {
  for (const [name, data] of [
    ["the public example", buildFixtureData(neutralSeed())],
    ["the test seed", buildFixtureData(exampleSeed())],
  ] as const) {
    it(`has a plan for every object of ${name}, listing each only once`, () => {
      const types = new Set<string>();
      for (const node of data.nodes) {
        const plan = planDeletion(data.nodes, data.edges, node.id)!;
        expect(plan, node.title).not.toBeNull();
        expect(plan.all[0]).toBe(node.id);
        expect(new Set(plan.all).size).toBe(plan.all.length);
        expect(plan.extra).toBe(plan.all.length - 1);
        types.add(node.type);
      }
      expect(types.size).toBeGreaterThan(6);
      expect(OBJECT_TYPES.length).toBeGreaterThan(0);
    });
  }
});
