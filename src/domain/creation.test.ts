import { describe, expect, it } from "vitest";
import {
  CREATABLE_TYPES,
  EXAMPLE_TAG,
  childTypesFor,
  isExample,
  quickChildren,
  relationForChild,
  visibleTags,
} from "./creation";
import { isEdgeAllowed } from "./edge-rules";
import { OBJECT_TYPES } from "./enums";

describe("relationForChild", () => {
  it("relates a task created in a project through containment", () => {
    expect(relationForChild("project", "task")).toEqual({ kind: "contains", direction: "in" });
    expect(relationForChild("sub_project", "milestone")).toEqual({
      kind: "contains",
      direction: "in",
    });
  });

  it("locates things at a location, whichever end is the location", () => {
    // A project created at a place: the project is the source of located_at.
    expect(relationForChild("location", "project")).toEqual({
      kind: "located_at",
      direction: "out",
    });
    // A place created from a project: the new location is the target.
    expect(relationForChild("project", "location")).toEqual({
      kind: "located_at",
      direction: "in",
    });
    // Places nest.
    expect(relationForChild("location", "location")).toEqual({ kind: "contains", direction: "in" });
  });

  it("falls back to a reference for notes and people", () => {
    expect(relationForChild("project", "note")).toEqual({ kind: "references", direction: "out" });
    expect(relationForChild("task", "person")).toEqual({ kind: "references", direction: "out" });
  });

  it("relates a memory to the project it was created in through 'about'", () => {
    expect(relationForChild("project", "memory")).toEqual({ kind: "about", direction: "out" });
    expect(relationForChild("sub_project", "memory")).toEqual({ kind: "about", direction: "out" });
    expect(relationForChild("task", "memory")).toEqual({ kind: "about", direction: "out" });
  });

  it("never relates a memory to another memory through 'about' (that needs references)", () => {
    expect(relationForChild("memory", "memory")).toEqual({ kind: "references", direction: "out" });
  });

  it("only ever returns a relation the edge rules allow", () => {
    for (const parent of OBJECT_TYPES)
      for (const child of CREATABLE_TYPES) {
        const r = relationForChild(parent, child);
        if (!r) continue;
        const [from, to] = r.direction === "in" ? [parent, child] : [child, parent];
        expect(isEdgeAllowed(r.kind, from, to), `${parent} → ${child}`).toBe(true);
      }
  });
});

describe("childTypesFor", () => {
  it("offers sub-projects but not projects inside a project", () => {
    const kids = childTypesFor("project");
    expect(kids).toContain("task");
    expect(kids).toContain("sub_project");
    expect(kids).not.toContain("project");
  });

  it("offers a project at a location", () => {
    expect(childTypesFor("location")).toContain("project");
  });

  it("names the everyday additions on a project, including a memory", () => {
    expect(quickChildren("project")).toEqual(["task", "milestone", "decision", "risk", "memory"]);
    expect(quickChildren("task")).toEqual(["note"]);
  });
});

describe("example data", () => {
  it("is ordinary data with a reserved tag that is never displayed", () => {
    expect(isExample({ tags: ["a", EXAMPLE_TAG] })).toBe(true);
    expect(isExample({ tags: ["a"] })).toBe(false);
    expect(visibleTags(["a", EXAMPLE_TAG, "b"])).toEqual(["a", "b"]);
  });
});
