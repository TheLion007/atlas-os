import { describe, expect, it } from "vitest";
import type { ApiEdge } from "@/domain/api-types";
import { planDeletion } from "@/domain/deletion";
import { emptyFixtureData } from "@/seed/fixtures";
import { buildFixtureData } from "@/seed/fixtures";
import { neutralSeed } from "@/seed/neutral-fr";
import { exampleSeed } from "@tests/fixtures/example-seed";
import { createFixtureSource } from "./fixture-source";

/** In-memory sources only: nothing here reads or writes a real database. */
const key = (e: Pick<ApiEdge, "kind" | "from" | "to">) => `${e.kind}:${e.from}>${e.to}`;

async function orphans(source: ReturnType<typeof createFixtureSource>) {
  const g = await source.graph();
  const ids = new Set(g.nodes.map((n) => n.id));
  return g.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
}

describe("deleting and restoring, on every object of the example data", () => {
  for (const [name, build] of [
    ["the public example", () => buildFixtureData(neutralSeed())],
    ["the test seed", () => buildFixtureData(exampleSeed())],
  ] as const) {
    it(`deletes each object of ${name} with what goes with it, leaves no orphan edge, and restores it exactly`, async () => {
      const source = createFixtureSource(build());
      const before = await source.graph();
      const types = new Set<string>();
      for (const node of before.nodes) {
        const plan = planDeletion(before.nodes, before.edges, node.id)!;
        const receipt = await source.deleteMany({ ids: plan.all });
        const gone = new Set(plan.all);
        const mid = await source.graph();
        expect(
          mid.nodes.some((n) => gone.has(n.id)),
          node.title,
        ).toBe(false);
        expect(mid.edges.some((e) => gone.has(e.from) || gone.has(e.to))).toBe(false);
        expect(await orphans(source)).toEqual([]);
        // what the journal and the lenses read follows at once
        const progress = await source.progress(3650);
        expect(progress.some((p) => p.objectId !== null && gone.has(p.objectId))).toBe(false);

        await source.restoreMany(receipt);
        const after = await source.graph();
        expect(after.nodes.map((n) => n.id).sort()).toEqual(before.nodes.map((n) => n.id).sort());
        expect(after.edges.map(key).sort()).toEqual(before.edges.map(key).sort());
        types.add(node.type);
      }
      expect(types.size).toBeGreaterThan(6);
    });
  }

  it("keeps the children of a deleted object attached to its parent, and undoes that too", async () => {
    const source = createFixtureSource(buildFixtureData(neutralSeed()));
    const before = await source.graph();
    // a sub-project whose project can take its tasks
    const sub = before.nodes.find(
      (n) =>
        n.type === "sub_project" &&
        before.edges.some((e) => e.kind === "contains" && e.from === n.id),
    )!;
    const plan = planDeletion(before.nodes, before.edges, sub.id)!;
    expect(plan.canKeepChildren).toBe(true);
    const receipt = await source.deleteMany({ ids: plan.keep.ids, reattach: plan.keep.reattach });
    expect(receipt.addedEdgeIds).toHaveLength(plan.keep.reattach.length);
    const mid = await source.graph();
    for (const r of plan.keep.reattach)
      expect(mid.edges.some((e) => e.kind === r.kind && e.from === r.from && e.to === r.to)).toBe(
        true,
      );
    expect(await orphans(source)).toEqual([]);
    await source.restoreMany(receipt);
    const after = await source.graph();
    expect(after.edges.map(key).sort()).toEqual(before.edges.map(key).sort());
  });

  it("is all or nothing: a re-attachment the model refuses undoes the deletion", async () => {
    const source = createFixtureSource(buildFixtureData(neutralSeed()));
    const before = await source.graph();
    const task = before.nodes.find((n) => n.type === "task")!;
    const note = before.nodes.find((n) => n.type === "note")!;
    // a task cannot contain a note
    await expect(
      source.deleteMany({
        ids: [note.id],
        reattach: [{ kind: "contains", from: task.id, to: before.nodes[0]!.id }],
      }),
    ).rejects.toBeTruthy();
    const after = await source.graph();
    expect(after.nodes.map((n) => n.id).sort()).toEqual(before.nodes.map((n) => n.id).sort());
    expect(after.edges.map(key).sort()).toEqual(before.edges.map(key).sort());
  });

  it("refuses what is not there, and an object twice", async () => {
    const source = createFixtureSource(emptyFixtureData(exampleSeed()));
    await expect(
      source.deleteMany({ ids: ["00000000-0000-4000-8000-000000000001"] }),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it("tells the document files to free once a deletion is final", async () => {
    const source = createFixtureSource(buildFixtureData(exampleSeed()));
    const before = await source.graph();
    const doc = before.nodes.find((n) => n.type === "document" && n.details?.storagePath)!;
    const receipt = await source.deleteMany({ ids: [doc.id] });
    expect(receipt.documents).toEqual([
      { id: doc.id, storagePath: doc.details!.storagePath as string },
    ]);
  });
});
