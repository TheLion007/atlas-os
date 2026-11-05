import { foldAccents } from "@/domain/search-text";
import type { ApiObject } from "@/domain/api-types";
import type { LifecycleStatus, ObjectType } from "@/domain/enums";
import { asOwner, toPgTextArray, type Db } from "../db/types";
import { mapDbError } from "../errors";

/**
 * Server-side search across every object type, including Memory — the foundation for a unified
 * Atlas search (ADR 0002 §6, brief "SEARCH"). Backed entirely by columns and indexes that already
 * exist (`objects.search` tsvector, the `pg_trgm` title index, and the tag catalogue): no new
 * extension, no AI call, no embeddings. This is the server-side tier `src/domain/search.ts`'s own
 * docstring already anticipated ("a server-side `/api/search` will replace [client ranking] when
 * the dataset outgrows the client") — the client-side ranking stays for small/already-loaded
 * datasets; this is for when it does not.
 *
 * A leading `#tag` in the query is treated as an exact tag filter (brief's tag-match tier),
 * checked against both tag surfaces that exist today: the free-text `objects.tags` array and the
 * first-class `object_tags` catalogue (ADR 0002's implementation notes explain why these are two
 * independent surfaces rather than one being a cache of the other).
 */

export interface SearchResultRow extends ApiObject {
  /** Relevance, highest first. Not meaningful across calls or as an absolute number. */
  score: number;
}

interface Parsed {
  text: string;
  tags: string[];
}

/** Splits a query into its free-text part and any `#tag` tokens. */
export function parseSearchQuery(raw: string): Parsed {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const tags = tokens
    .filter((t) => t.startsWith("#") && t.length > 1)
    .map((t) => t.slice(1).toLowerCase());
  const text = tokens.filter((t) => !t.startsWith("#")).join(" ");
  return { text, tags };
}

interface Row {
  id: string;
  type: ObjectType;
  title: string;
  status: LifecycleStatus;
  tags: string[];
  confidence: number | null;
  color: string | null;
  created_at: unknown;
  updated_at: unknown;
  score: number | string;
  [key: string]: unknown;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

export async function searchAllTypes(
  db: Db,
  owner: string,
  query: string,
  opts: { limit?: number } = {},
): Promise<SearchResultRow[]> {
  const { text, tags } = parseSearchQuery(query);
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  if (text === "" && tags.length === 0) return [];

  try {
    return await asOwner(db, owner, async (tx) => {
      const rows = await tx.query<Row>(
        `select o.id, o.type, o.title, o.status, o.tags, o.confidence, o.color,
                o.created_at, o.updated_at,
                greatest(
                  case when $1 <> '' and lower(o.title) = lower($1) then 100 else 0 end,
                  case when $1 <> '' then greatest(
                    ts_rank(o.search, websearch_to_tsquery('simple', $1)),
                    ts_rank(o.search, websearch_to_tsquery('simple', $4))
                  ) * 60 else 0 end,
                  case when $1 <> '' then extensions.similarity(o.title, $1) * 40 else 0 end,
                  case when $2::text[] <> '{}' and (
                         o.tags && $2::text[]
                         or exists (
                           select 1 from public.object_tags ot join public.tags t on t.id = ot.tag_id
                           where ot.object_id = o.id and lower(t.name) = any($2::text[])
                         )
                       ) then 80 else 0 end
                ) as score
         from public.objects o
         where o.deleted_at is null
           and (
             ($1 <> '' and (
               o.search @@ websearch_to_tsquery('simple', $1)
               -- The same query without accents, matching the folded copy in search_text.
               or o.search @@ websearch_to_tsquery('simple', $4)
               or extensions.similarity(o.title, $1) > 0.2
             ))
             or ($2::text[] <> '{}' and (
               o.tags && $2::text[]
               or exists (
                 select 1 from public.object_tags ot join public.tags t on t.id = ot.tag_id
                 where ot.object_id = o.id and lower(t.name) = any($2::text[])
               )
             ))
           )
         order by score desc, o.title
         limit $3`,
        [text, toPgTextArray(tags), limit, foldAccents(text)],
      );
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title,
        status: r.status,
        tags: r.tags,
        confidence: r.confidence,
        color: r.color,
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
        score: Number(r.score),
      }));
    });
  } catch (e) {
    throw mapDbError(e);
  }
}
