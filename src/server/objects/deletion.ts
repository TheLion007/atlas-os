import { z } from "zod";
import type { DeleteReceipt } from "@/domain/api-types";
import { asOwner, type Db } from "../db/types";
import { ApiError, mapDbError, notFound } from "../errors";
import { insertEdge } from "./edges";

/**
 * Deleting several objects at once, restoring them, and freeing them for good.
 *
 * - `deleteMany` soft-deletes every object in one transaction (the database soft-deletes their
 *   edges with them, so no live edge is left pointing at a deleted object) and can create the
 *   edges that keep what stays attached to a parent. It answers with a receipt that is enough to
 *   undo the whole step.
 * - `restoreMany` undoes a receipt: it removes the edges the step created, brings the objects back
 *   and revives exactly the edges that went with them (those whose two ends are alive again).
 * - `purgeMany` makes the deletion final: the objects, their details and edges, their journal
 *   entries and the bytes of their documents are removed from the database.
 */

const uuids = z.array(z.uuid()).max(5000);

export const deleteManySchema = z.object({
  ids: uuids.min(1),
  reattach: z
    .array(
      z.object({
        kind: z.enum(["contains", "references"]),
        from: z.uuid(),
        to: z.uuid(),
      }),
    )
    .max(5000)
    .default([]),
});
export type DeleteManyInput = z.infer<typeof deleteManySchema>;

export const restoreManySchema = z.object({
  objectIds: uuids.min(1),
  edgeIds: uuids.default([]),
  addedEdgeIds: uuids.default([]),
});
export type RestoreManyInput = z.infer<typeof restoreManySchema>;

export const purgeManySchema = z.object({
  ids: uuids.default([]),
  /** Also free the documents deleted a while ago whose undo delay has surely passed. */
  staleDocuments: z.boolean().default(false),
});
export type PurgeManyInput = z.infer<typeof purgeManySchema>;

/** Minutes after which a deleted document is assumed to be past its undo delay. */
const STALE_MINUTES = 10;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(400, "validation", "Invalid request.", parsed.error.issues);
  return parsed.data;
}
export const parseDeleteMany = (body: unknown) => parse(deleteManySchema, body);
export const parseRestoreMany = (body: unknown) => parse(restoreManySchema, body);
export const parsePurgeMany = (body: unknown) => parse(purgeManySchema, body);

export async function deleteMany(
  db: Db,
  owner: string,
  input: DeleteManyInput,
): Promise<DeleteReceipt> {
  const ids = [...new Set(input.ids)];
  try {
    return await asOwner(db, owner, async (tx) => {
      const live = await tx.query<{ id: string }>(
        "select id from public.objects where id = any($1::uuid[]) and deleted_at is null",
        [ids],
      );
      if (live.length !== ids.length) throw notFound();

      const docs = await tx.query<{ id: string; storage_path: string | null }>(
        `select o.id, d.storage_path
           from public.objects o left join public.document_details d on d.id = o.id
          where o.id = any($1::uuid[]) and o.type = 'document'`,
        [ids],
      );
      const edges = await tx.query<{ id: string }>(
        `select id from public.edges
          where deleted_at is null and (from_id = any($1::uuid[]) or to_id = any($1::uuid[]))`,
        [ids],
      );

      await tx.query(
        "update public.objects set deleted_at = now() where id = any($1::uuid[]) and deleted_at is null",
        [ids],
      );

      const added: string[] = [];
      for (const r of input.reattach) {
        const edge = await insertEdge(tx, owner, {
          kind: r.kind,
          from: r.from,
          to: r.to,
          label: null,
          dependencyType: null,
          lagDays: null,
        });
        added.push(edge.id);
      }
      return {
        objectIds: ids,
        edgeIds: edges.map((e) => e.id),
        addedEdgeIds: added,
        documents: docs.map((d) => ({ id: d.id, storagePath: d.storage_path })),
      };
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

export async function restoreMany(
  db: Db,
  owner: string,
  input: RestoreManyInput,
): Promise<{ restored: number; edges: number }> {
  try {
    return await asOwner(db, owner, async (tx) => {
      if (input.addedEdgeIds.length > 0)
        await tx.query("delete from public.edges where id = any($1::uuid[])", [input.addedEdgeIds]);
      const back = await tx.query<{ id: string }>(
        `update public.objects set deleted_at = null
          where id = any($1::uuid[]) and deleted_at is not null returning id`,
        [input.objectIds],
      );
      if (back.length === 0)
        throw new ApiError(409, "not_restorable", "These items were already removed for good.");
      let revived = 0;
      if (input.edgeIds.length > 0) {
        const rows = await tx.query<{ id: string }>(
          `update public.edges e set deleted_at = null
             from public.objects f, public.objects t
            where e.id = any($1::uuid[]) and e.deleted_at is not null
              and f.id = e.from_id and t.id = e.to_id
              and f.deleted_at is null and t.deleted_at is null
            returning e.id`,
          [input.edgeIds],
        );
        revived = rows.length;
      }
      return { restored: back.length, edges: revived };
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

export async function purgeMany(
  db: Db,
  owner: string,
  input: PurgeManyInput,
): Promise<{ purged: number }> {
  try {
    return await asOwner(db, owner, async (tx) => {
      const gone = await tx.query<{ id: string }>(
        `select id from public.objects
          where deleted_at is not null
            and (id = any($1::uuid[])
                 or ($2::boolean and type = 'document'
                     and deleted_at < now() - make_interval(mins => $3::int)))`,
        [input.ids, input.staleDocuments, STALE_MINUTES],
      );
      const ids = gone.map((g) => g.id);
      if (ids.length === 0) return { purged: 0 };
      // The bytes of the documents go first: that is the space the person gets back.
      await tx.query(
        `delete from public.document_files f
          using public.document_details d
          where d.id = any($1::uuid[]) and d.storage_path = f.storage_path`,
        [ids],
      );
      await tx.query("select public.purge_progress($1::uuid[])", [ids]);
      await tx.query("delete from public.objects where id = any($1::uuid[])", [ids]);
      return { purged: ids.length };
    });
  } catch (e) {
    throw mapDbError(e);
  }
}
