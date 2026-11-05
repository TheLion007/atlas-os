import { z } from "zod";
import type { ApiTag } from "@/domain/api-types";
import { createTagSchema, updateTagSchema, type ParsedTagInput } from "@/domain/schemas";
import { asOwner, toPgTextArray, type Db } from "../db/types";
import { ApiError, mapDbError, notFound } from "../errors";
import { iso } from "./mapping";

/**
 * The user tag catalogue (ADR 0002 §4). System tags (#project, #task, ...) are a presentational
 * alias over `object.type` computed by the client/UI layer — they are never rows here, so there
 * is nothing to seed, rename-protect, or reconcile for them.
 *
 * Deliberately independent of `objects.tags`/`search_text`: that free-text array is pre-existing,
 * unrelated architecture (it also carries reserved `atlas:`-prefixed bookkeeping tags, see
 * `src/domain/creation.ts`), and this module does not read or write it. The two are complementary
 * ways to tag an object, not one derived from the other — see ADR 0002's implementation notes for
 * why the originally proposed "cache" framing was dropped in favour of this simpler, non-breaking
 * split once the existing free-text path was found still in active, tested use.
 */

interface TagRow {
  id: string;
  name: string;
  kind: "system" | "user";
  color: string | null;
  created_at: unknown;
  [key: string]: unknown;
}

const toApiTag = (r: TagRow): ApiTag => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  color: r.color,
  createdAt: iso(r.created_at),
});

function validation(message: string, issues: unknown): ApiError {
  return new ApiError(400, "validation", message, issues);
}

export function parseCreateTagBody(body: unknown): ParsedTagInput {
  const parsed = createTagSchema.safeParse(body);
  if (!parsed.success) throw validation("Invalid tag.", parsed.error.issues);
  return parsed.data;
}

export function parseUpdateTagBody(body: unknown) {
  const parsed = updateTagSchema.safeParse(body);
  if (!parsed.success) throw validation("Invalid tag update.", parsed.error.issues);
  return parsed.data;
}

export async function listTags(db: Db, owner: string): Promise<ApiTag[]> {
  return asOwner(db, owner, async (tx) => {
    const rows = await tx.query<TagRow>(
      "select id, name, kind, color, created_at from public.tags order by lower(name)",
    );
    return rows.map(toApiTag);
  });
}

export async function createTag(db: Db, owner: string, input: ParsedTagInput): Promise<ApiTag> {
  try {
    return await asOwner(db, owner, async (tx) => {
      const rows = await tx.query<TagRow>(
        `insert into public.tags (name, color, owner_id) values ($1, $2, $3)
         returning id, name, kind, color, created_at`,
        [input.name, input.color, owner],
      );
      return toApiTag(rows[0] as TagRow);
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

export async function updateTag(
  db: Db,
  owner: string,
  id: string,
  patch: { name?: string; color?: string | null },
): Promise<ApiTag> {
  try {
    return await asOwner(db, owner, async (tx) => {
      const rows = await tx.query<TagRow>(
        `update public.tags set name = coalesce($2, name), color = case when $3 then $4 else color end
         where id = $1 returning id, name, kind, color, created_at`,
        [id, patch.name ?? null, patch.color !== undefined, patch.color ?? null],
      );
      if (rows.length === 0) throw notFound("Tag");
      return toApiTag(rows[0] as TagRow);
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

export async function deleteTag(db: Db, owner: string, id: string): Promise<void> {
  try {
    await asOwner(db, owner, async (tx) => {
      const rows = await tx.query("delete from public.tags where id = $1 returning id", [id]);
      if (rows.length === 0) throw notFound("Tag");
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

const attachBodySchema = z.object({ tagId: z.uuid() });

export function parseAttachTagBody(body: unknown): string {
  const parsed = attachBodySchema.safeParse(body);
  if (!parsed.success) throw validation("Expected { tagId }.", parsed.error.issues);
  return parsed.data.tagId;
}

/** Attaches a tag to an object. Attaching the same tag twice is a no-op, not an error. */
export async function attachTag(
  db: Db,
  owner: string,
  objectId: string,
  tagId: string,
): Promise<void> {
  try {
    await asOwner(db, owner, async (tx) => {
      await tx.query(
        `insert into public.object_tags (object_id, tag_id, owner_id) values ($1, $2, $3)
         on conflict (object_id, tag_id) do nothing`,
        [objectId, tagId, owner],
      );
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

export async function detachTag(
  db: Db,
  owner: string,
  objectId: string,
  tagId: string,
): Promise<void> {
  try {
    await asOwner(db, owner, async (tx) => {
      await tx.query("delete from public.object_tags where object_id = $1 and tag_id = $2", [
        objectId,
        tagId,
      ]);
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

export interface ObjectTagRow {
  objectId: string;
  tagId: string;
  name: string;
  color: string | null;
}

/** Every tag attached to a set of objects, for the UI to group by object id. */
export async function listTagsForObjects(
  db: Db,
  owner: string,
  objectIds: readonly string[],
): Promise<ObjectTagRow[]> {
  if (objectIds.length === 0) return [];
  return asOwner(db, owner, async (tx) => {
    const rows = await tx.query<{
      object_id: string;
      tag_id: string;
      name: string;
      color: string | null;
    }>(
      `select ot.object_id, t.id as tag_id, t.name, t.color
       from public.object_tags ot join public.tags t on t.id = ot.tag_id
       where ot.object_id = any($1::uuid[])
       order by lower(t.name)`,
      [toPgTextArray(objectIds)],
    );
    return rows.map((r) => ({
      objectId: r.object_id,
      tagId: r.tag_id,
      name: r.name,
      color: r.color,
    }));
  });
}
