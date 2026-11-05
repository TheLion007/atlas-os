import { describe, expect, it } from "vitest";
import { buildFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { buildCollection, filterCollection, sortCollection } from "./collection";
import { exampleSeed } from "@tests/fixtures/example-seed";

const data = buildFixtureData(exampleSeed());
const rows = (type: Parameters<typeof buildCollection>[0]) =>
  buildCollection(type, data.nodes, data.edges);

describe("collections are projections of the shared graph", () => {
  it("lists exactly the objects of one type", () => {
    const projects = rows("project");
    expect(projects.length).toBe(data.nodes.filter((n) => n.type === "project").length);
    expect(projects.every((r) => r.type === "project")).toBe(true);
    expect(rows("estimate").length).toBe(data.nodes.filter((n) => n.type === "estimate").length);
  });

  it("derives project progress with the engine, keeping a real 0% apart from no data", () => {
    const byTitle = new Map(rows("project").map((r) => [r.title, r]));
    expect(byTitle.get("Dorsel relocation")?.progress).toBe(0.5);
    expect(rows("project").some((r) => r.progress === 0)).toBe(true);
  });

  it("knows what a task belongs to and when it is due", () => {
    const task = rows("task").find((r) => r.id === seedId("t_charges"))!;
    expect(task.parent?.title).toBe("Due diligence");
    expect(rows("task").some((r) => r.date !== null)).toBe(true);
  });

  it("flags blocked work by dependency, never by stored status", () => {
    const blocked = rows("task").filter((r) => r.blocked);
    expect(blocked.length).toBeGreaterThan(0);
    for (const r of blocked) expect(["draft", "active"]).toContain(r.status);
  });

  it("derives a risk's level from probability and impact", () => {
    const risks = rows("risk");
    expect(risks.length).toBeGreaterThan(0);
    for (const r of risks) {
      expect(r.risk).not.toBeNull();
      expect(["low", "medium", "high", "critical"]).toContain(r.risk!.level);
    }
  });

  it("marks example data, so it is never mistaken for the user's own", () => {
    expect(rows("project").every((r) => r.example)).toBe(true);
  });

  it("is empty, not an error, for a type with no objects", () => {
    expect(buildCollection("note", [], [])).toEqual([]);
  });
});

describe("ordering and filtering", () => {
  it("puts open work first, dated items soonest first, and risks by severity", () => {
    const tasks = sortCollection(rows("task"));
    const firstDone = tasks.findIndex((r) => r.status === "done");
    const lastActive = tasks.map((r) => r.status).lastIndexOf("active");
    expect(lastActive).toBeLessThan(firstDone);
    const risks = sortCollection(rows("risk"));
    const scores = risks.map((r) => r.risk!.probability * r.risk!.impact);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("filters by status and by text, ignoring case and accents", () => {
    const projects = rows("project");
    expect(filterCollection(projects, { query: "MARINA" }).map((r) => r.title)).toContain(
      "Marina 1BR purchase",
    );
    expect(filterCollection(projects, { query: "zzzz" })).toEqual([]);
    expect(filterCollection(projects, { status: "done" }).every((r) => r.status === "done")).toBe(
      true,
    );
    expect(filterCollection(projects, { status: "all" }).length).toBe(projects.length);
    const accented = [{ ...projects[0]!, title: "Café à Bremont" }];
    expect(filterCollection(accented, { query: "cafe a bremont" })).toHaveLength(1);
  });
});
