import type { PNode, Proposal } from "@/domain/assistant-plan";
import { stepsOf } from "@/domain/assistant-plan";
import { relationForChild } from "@/domain/creation";
import type { ObjectType } from "@/domain/enums";
import type { CreateObjectInput } from "@/domain/schemas";
import { DataSourceError, type AtlasDataSource } from "./data-source";
import type { CreatedBatch } from "@/lib/assistant-undo";

/**
 * Makes what the person approved: parents first, each object tied to its parent through the one
 * relation the rules allow. If any write fails, everything already made is removed again, so a
 * creation either happens whole or not at all.
 */

const TYPE_OF: Record<PNode["kind"], ObjectType> = {
  plan: "plan",
  project: "project",
  sub: "sub_project",
  task: "task",
  note: "note",
  deadline: "milestone",
};

function inputFor(n: PNode, createdBy: string): CreateObjectInput {
  const base = { title: n.title, tags: [] as string[], confidence: null };
  switch (n.kind) {
    case "plan":
      return {
        ...base,
        type: "plan",
        status: "active",
        details: { description: n.description ?? createdBy },
      };
    case "project":
      return {
        ...base,
        type: "project",
        status: "active",
        details: {
          description: n.description ?? createdBy,
          kind: n.category ?? "general",
          startDate: null,
          targetDate: null,
        },
      };
    case "sub":
      return {
        ...base,
        type: "sub_project",
        status: "active",
        details: {
          description: createdBy,
          kind: n.category ?? "general",
          startDate: null,
          targetDate: null,
        },
      };
    case "task":
      return {
        ...base,
        type: "task",
        status: "draft",
        tags: n.category ? [n.category.slice(0, 40)] : [],
        details: { description: "", due: n.due ?? null },
      };
    case "note":
      return {
        ...base,
        type: "note",
        status: "active",
        details: { blocks: [{ id: "b1", type: "paragraph", text: n.text ?? "" }], pinned: false },
      };
    case "deadline":
      return {
        ...base,
        type: "milestone",
        status: "active",
        details: { date: n.due ?? null, baselineDate: n.due ?? null, gateCriteria: [] },
      };
  }
}

export async function applyProposal(
  source: AtlasDataSource,
  proposal: Proposal,
  createdBy: string,
): Promise<CreatedBatch> {
  const batch: CreatedBatch = { objectIds: [], edgeIds: [] };
  const ids = new Map<string, string>(); // proposal key → real id
  for (const n of proposal.nodes) if (n.existingId) ids.set(n.key, n.existingId);
  try {
    for (const step of stepsOf(proposal)) {
      const parentId = step.parentKey ? (ids.get(step.parentKey) ?? null) : null;
      if (step.op === "attach") {
        if (!parentId || !step.node.existingId) continue;
        const e = await source.createEdge({
          kind: "contains",
          from: parentId,
          to: step.node.existingId,
        });
        batch.edgeIds.push(e.id);
        continue;
      }
      const parentNode = step.parentKey
        ? proposal.nodes.find((x) => x.key === step.parentKey)
        : undefined;
      const rel = parentNode
        ? relationForChild(TYPE_OF[parentNode.kind], TYPE_OF[step.node.kind])
        : null;
      const created = await source.createObject(
        inputFor(step.node, createdBy),
        parentId && rel ? [{ kind: rel.kind, direction: rel.direction, other: parentId }] : [],
      );
      batch.objectIds.push(created.id);
      ids.set(step.node.key, created.id);
    }
    return batch;
  } catch (e) {
    await undoBatch(source, batch).catch(() => undefined);
    throw e;
  }
}

/** Removes everything a batch made: the added relations, then the objects, newest first. */
export async function undoBatch(source: AtlasDataSource, batch: CreatedBatch): Promise<void> {
  // Something already deleted by hand (one by one, from the detail panel) is simply not there.
  const gone = (e: unknown) => e instanceof DataSourceError && e.status === 404;
  for (const id of [...batch.edgeIds].reverse())
    await source.deleteEdge(id).catch((e) => {
      if (!gone(e)) throw e;
    });
  for (const id of [...batch.objectIds].reverse())
    await source.deleteObject(id).catch((e) => {
      if (!gone(e)) throw e;
    });
}
