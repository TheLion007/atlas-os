import { describe, expect, it } from "vitest";
import {
  buildProposal,
  buildWorkspace,
  setChecked,
  type AssistantAction,
} from "@/domain/assistant-plan";
import { emptyFixtureData } from "@/seed/fixtures";
import { exampleSeed } from "@tests/fixtures/example-seed";
import { applyProposal, undoBatch } from "./assistant-apply";
import type { AtlasDataSource } from "./data-source";
import { createFixtureSource } from "./fixture-source";

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const fresh = () => createFixtureSource(emptyFixtureData(exampleSeed()), { newId: uuid });

const snapshot = async (s: AtlasDataSource) => {
  const g = await s.graph();
  return { nodes: g.nodes.map((x) => x.id).sort(), edges: g.edges.map((x) => x.id).sort() };
};

const NIRYS: AssistantAction[] = [
  { type: "create_plan", name: "NIRYS" },
  { type: "create_project", name: "Atlas OS", plan: "NIRYS", category: "Logiciel" },
  { type: "create_project", name: "Nimbus", plan: "NIRYS" },
  { type: "create_subproject", name: "Design", project: "Atlas OS" },
  {
    type: "add_task",
    title: "finir le graphe",
    project: "Design",
    due: "2026-12-01",
    category: "Design",
  },
  { type: "add_note", title: "Idées", text: "Un lexique commun", project: "Nimbus" },
  { type: "add_deadline", title: "Livraison", date: "2026-12-15", project: "Atlas OS" },
];

describe("applying and undoing a proposal", () => {
  it("creates every kind of element under the right parent, and undoes it whole", async () => {
    const s = fresh();
    const before = await snapshot(s);
    const ws = buildWorkspace([], []);
    const batch = await applyProposal(s, buildProposal(NIRYS, ws), "Créé par l’assistant.");
    expect(batch.objectIds).toHaveLength(7);
    const g = await s.graph();
    const title = (id: string) => g.nodes.find((x) => x.id === id)?.title;
    const parentOf = (name: string) => {
      const id = g.nodes.find((x) => x.title === name)!.id;
      return title(g.edges.find((e) => e.kind === "contains" && e.to === id)?.from ?? "");
    };
    expect(parentOf("Atlas OS")).toBe("NIRYS");
    expect(parentOf("Design")).toBe("Atlas OS");
    expect(parentOf("Finir le graphe")).toBe("Design");
    expect(parentOf("Livraison")).toBe("Atlas OS");
    const task = await s.object(g.nodes.find((x) => x.title === "Finir le graphe")!.id);
    expect(task.details).toMatchObject({ due: "2026-12-01" });
    expect(task.tags).toEqual(["Design"]);
    const project = await s.object(g.nodes.find((x) => x.title === "Atlas OS")!.id);
    expect(project.details).toMatchObject({ kind: "Logiciel" });

    await undoBatch(s, batch);
    expect(await snapshot(s)).toEqual(before);
  });

  it("puts an existing project into the new plan and takes it out again on undo", async () => {
    const s = fresh();
    const made = await s.createObject({
      type: "project",
      title: "Atlas OS",
      status: "active",
      tags: [],
      confidence: null,
      details: { description: "", kind: "general", startDate: null, targetDate: null },
    });
    const g0 = await s.graph();
    const ws = buildWorkspace(g0.nodes, g0.edges);
    const batch = await applyProposal(s, buildProposal(NIRYS.slice(0, 2), ws), "x");
    expect(batch.objectIds).toHaveLength(1); // only the plan
    expect(batch.edgeIds).toHaveLength(1);
    const g1 = await s.graph();
    expect(g1.edges.some((e) => e.kind === "contains" && e.to === made.id)).toBe(true);
    await undoBatch(s, batch);
    const g2 = await s.graph();
    expect(g2.edges.some((e) => e.kind === "contains" && e.to === made.id)).toBe(false);
    expect(g2.nodes.some((x) => x.id === made.id)).toBe(true);
  });

  it("undoes a batch whose items were partly deleted by hand since", async () => {
    const s = fresh();
    const before = await snapshot(s);
    const batch = await applyProposal(s, buildProposal(NIRYS, buildWorkspace([], [])), "x");
    // the person deleted two of the created items one by one from the detail panel
    await s.deleteObject(batch.objectIds[2]!);
    await s.deleteObject(batch.objectIds[5]!);
    await expect(undoBatch(s, batch)).resolves.toBeUndefined();
    expect(await snapshot(s)).toEqual(before);
  });

  it("creates only what is still ticked", async () => {
    const s = fresh();
    const before = await snapshot(s);
    let p = buildProposal(NIRYS, buildWorkspace([], []));
    p = setChecked(p, p.nodes.find((x) => x.title === "NIRYS")!.key, false);
    const batch = await applyProposal(s, p, "x");
    expect(batch.objectIds).toHaveLength(0);
    expect(await snapshot(s)).toEqual(before);
  });

  it("removes what it already made when a write fails halfway", async () => {
    const real = fresh();
    const before = await snapshot(real);
    let calls = 0;
    const flaky: AtlasDataSource = new Proxy(real, {
      get(target, prop, recv) {
        if (prop === "createObject")
          return (...a: Parameters<AtlasDataSource["createObject"]>) => {
            if (++calls === 4) return Promise.reject(new Error("disk full"));
            return target.createObject(...a);
          };
        return Reflect.get(target, prop, recv);
      },
    });
    await expect(
      applyProposal(flaky, buildProposal(NIRYS, buildWorkspace([], [])), "x"),
    ).rejects.toThrow("disk full");
    expect(await snapshot(real)).toEqual(before);
  });
});
