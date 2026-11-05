import { describe, expect, it } from "vitest";
import { EXAMPLE_TAG } from "@/domain/creation";
import type { CreateEdgeInput, CreateObjectInput } from "@/domain/schemas";
import { buildFixtureData, emptyFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { DataSourceError } from "./data-source";
import { createFixtureSource } from "./fixture-source";
import { exampleSeed } from "@tests/fixtures/example-seed";

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const source = (data = emptyFixtureData(exampleSeed())) =>
  createFixtureSource(data, { newId: uuid });

const project = (title: string): CreateObjectInput => ({
  type: "project",
  title,
  status: "active",
  tags: [],
  confidence: null,
  details: {
    description: "",
    kind: "general",
    priority: 2,
    startDate: null,
    targetDate: null,
    budgetAmount: null,
    budgetCurrency: null,
  },
});
const subProject = (title: string): CreateObjectInput =>
  ({ ...project(title), type: "sub_project" }) as CreateObjectInput;
const task = (title: string): CreateObjectInput => ({
  type: "task",
  title,
  status: "active",
  tags: [],
  confidence: null,
  details: { description: "", due: null, effort: null },
});
const edge = (kind: CreateEdgeInput["kind"], from: string, to: string): CreateEdgeInput => ({
  kind,
  from,
  to,
  label: null,
  dependencyType: null,
  lagDays: null,
});

describe("the fixture source is a real store, with the API rules", () => {
  it("starts empty and stays empty until the user builds something", async () => {
    const s = source();
    expect(await s.graph()).toEqual({ nodes: [], edges: [] });
  });

  it("creates a project that is immediately part of the graph", async () => {
    const s = source();
    const p = await s.createObject(project("Relocation"));
    const graph = await s.graph();
    expect(graph.nodes.map((x) => x.title)).toEqual(["Relocation"]);
    expect(p.status).toBe("active");
    expect(p.relations.contains.outgoing).toEqual([]);
  });

  it("creates a task inside a project through the typed contains edge, atomically", async () => {
    const s = source();
    const p = await s.createObject(project("Relocation"));
    const t = await s.createObject(task("Open a bank account"), [
      { kind: "contains", direction: "in", other: p.id },
    ]);
    expect(t.relations.contains.incoming.map((r) => r.object.title)).toEqual(["Relocation"]);
    const parent = await s.object(p.id);
    expect(parent.relations.contains.outgoing.map((r) => r.object.title)).toEqual([
      "Open a bank account",
    ]);
    const { edges } = await s.graph();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ kind: "contains", from: p.id, to: t.id });
  });

  it("refuses a relation the edge rules do not allow, and leaves nothing behind", async () => {
    const s = source();
    const p = await s.createObject(project("Relocation"));
    const note: CreateObjectInput = {
      type: "note",
      title: "Idea",
      status: "active",
      tags: [],
      confidence: null,
      details: { blocks: [], pinned: false },
    };
    // A project cannot contain a note.
    await expect(
      s.createObject(note, [{ kind: "contains", direction: "in", other: p.id }]),
    ).rejects.toMatchObject({ status: 409 });
    const graph = await s.graph();
    expect(graph.nodes.map((x) => x.title)).toEqual(["Relocation"]);
    expect(graph.edges).toEqual([]);
  });

  it("validates the object with the same schema as the API", async () => {
    const s = source();
    await expect(s.createObject({ ...project(""), title: "  " })).rejects.toMatchObject({
      status: 400,
    });
    const badRisk = {
      type: "risk",
      title: "R",
      status: "active",
      tags: [],
      confidence: null,
      details: { probability: 9, impact: 2, mitigation: "" },
    } as CreateObjectInput;
    await expect(s.createObject(badRisk)).rejects.toBeInstanceOf(DataSourceError);
  });

  it("enforces a single parent and no cycles", async () => {
    const s = source();
    const a = await s.createObject(project("A"));
    const b = await s.createObject(subProject("B"));
    const c = await s.createObject(project("C"));
    await s.createEdge(edge("contains", a.id, b.id));
    await expect(s.createEdge(edge("contains", c.id, b.id))).rejects.toMatchObject({
      status: 409,
    });
    const t1 = await s.createObject(task("T1"));
    const t2 = await s.createObject(task("T2"));
    await s.createEdge(edge("depends_on", t1.id, t2.id));
    await expect(s.createEdge(edge("depends_on", t2.id, t1.id))).rejects.toMatchObject({
      status: 409,
    });
  });

  it("updates through the same schema and keeps the audit trail", async () => {
    const s = source();
    const t = await s.createObject(task("Draft"));
    const updated = await s.updateObject(t.id, { title: "Final", status: "done" });
    expect(updated).toMatchObject({ title: "Final", status: "done" });
    const activity = await s.activity();
    expect(activity[0]).toMatchObject({ action: "updated", object: { title: "Final" } });
    expect(activity[0]?.diff).toMatchObject({ status: { from: "active", to: "done" } });
    await expect(s.updateObject(t.id, { title: "" })).rejects.toMatchObject({ status: 400 });
    await expect(s.updateObject("nope", { title: "x" })).rejects.toMatchObject({ status: 404 });
  });

  it("deletes an object with its relations, and says so in the activity feed", async () => {
    const s = source();
    const p = await s.createObject(project("Relocation"));
    const t = await s.createObject(task("T"), [{ kind: "contains", direction: "in", other: p.id }]);
    await s.deleteObject(t.id);
    const graph = await s.graph();
    expect(graph.nodes.map((x) => x.id)).toEqual([p.id]);
    expect(graph.edges).toEqual([]);
    expect((await s.activity())[0]).toMatchObject({ action: "deleted", diff: { title: "T" } });
    await expect(s.object(t.id)).rejects.toMatchObject({ status: 404 });
  });

  it("reports each write so a session can persist it", async () => {
    const seen: number[] = [];
    const s = createFixtureSource(emptyFixtureData(exampleSeed()), {
      newId: uuid,
      onChange: (d) => seen.push(d.nodes.length),
    });
    await s.createObject(project("A"));
    await s.createObject(project("B"));
    expect(seen).toEqual([1, 2]);
  });

  it("does not mutate the data it was given", async () => {
    const data = emptyFixtureData(exampleSeed());
    const s = createFixtureSource(data, { newId: uuid });
    await s.createObject(project("A"));
    expect(data.nodes).toEqual([]);
  });
});

describe("example data and the user's own", () => {
  it("tags every illustrative object, and only those", async () => {
    const seed = buildFixtureData(exampleSeed());
    expect(seed.nodes.length).toBeGreaterThan(20);
    expect(seed.nodes.every((x) => x.tags.includes(EXAMPLE_TAG))).toBe(true);
    const s = source(seed);
    const mine = await s.createObject(project("Mine"));
    expect(mine.tags).not.toContain(EXAMPLE_TAG);
  });

  it("lets a person build inside an example project without changing what an example is", async () => {
    const s = source(buildFixtureData(exampleSeed()));
    const t = await s.createObject(task("My own task"), [
      { kind: "contains", direction: "in", other: seedId("p_reloc") },
    ]);
    expect(t.tags).toEqual([]);
    expect(t.relations.contains.incoming[0]?.object.title).toBe("Dorsel relocation");
  });

  it("starts a new user from a genuinely empty workspace with no invented currency", () => {
    const empty = emptyFixtureData(exampleSeed());
    expect(empty.nodes).toEqual([]);
    expect(empty.settings.baseCurrency).toBeNull();
    expect(empty.settings.fxRates).toEqual([]);
  });
});
