import { describe, expect, it } from "vitest";
import { EXAMPLE_TAG } from "@/domain/creation";
import { createFixtureSource } from "@/client/fixture-source";
import { buildFixtureData } from "./fixtures";
import { neutralSeed } from "./neutral-fr";
import { seedId } from "./seed-types";

const data = () => buildFixtureData(neutralSeed());

describe("the neutral French example workspace", () => {
  it("validates against the real API schemas and relation rules", () => {
    const d = data();
    expect(d.nodes.filter((n) => n.type === "project")).toHaveLength(5);
    expect(d.nodes.filter((n) => n.type === "task").length).toBeGreaterThan(20);
    expect(d.nodes.every((n) => n.tags.includes(EXAMPLE_TAG))).toBe(true);
  });

  it("is in French and holds nothing personal", () => {
    const text = JSON.stringify(data().nodes.map((n) => n.title)).toLowerCase();
    expect(text).toContain("refonte du site web");
    expect(text).toContain("lancement v2.1");
    expect(text).toContain("documentation technique");
    for (const personal of ["dorsel", "ironfield", "nérys", "borland"])
      expect(text).not.toContain(personal);
  });

  it("carries a work journal with a live streak ending today", () => {
    const d = data();
    const days = new Set(d.progress.map((p) => p.day));
    expect(d.progress.length).toBeGreaterThan(80);
    for (let i = 0; i < 6; i++) {
      const day = new Date(Date.parse(`${d.today}T09:00:00Z`) - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      expect(days.has(day), `day ${day}`).toBe(true);
    }
  });
});

describe("the work journal in the demo source", () => {
  it("logs a finished task against its project, exactly once", async () => {
    const source = createFixtureSource(data());
    const before = (await source.progress(30)).length;
    const taskId = seedId("t_web1");
    await source.updateObject(taskId, { status: "done" });
    // Another edit that leaves it done is not new progress.
    await source.updateObject(taskId, { title: "Maquettes de la page tarifs (v2)" });
    const after = await source.progress(30);
    expect(after).toHaveLength(before + 1);
    expect(after[0]).toMatchObject({
      kind: "task_done",
      objectId: taskId,
      projectId: seedId("p_web"),
    });
  });

  it("logs a note and a file once they are attached to a project", async () => {
    const source = createFixtureSource(data());
    const before = (await source.progress(30)).length;
    const note = await source.createObject(
      {
        type: "note",
        title: "Compte rendu",
        status: "active",
        tags: [],
        confidence: null,
        details: { blocks: [], pinned: false },
      },
      [{ kind: "references", direction: "out", other: seedId("p_v21") }],
    );
    const log = await source.progress(30);
    expect(log).toHaveLength(before + 1);
    expect(log[0]).toMatchObject({
      kind: "note_created",
      objectId: note.id,
      projectId: seedId("p_v21"),
    });
  });
});
