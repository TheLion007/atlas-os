import { z } from "zod";
import { ApiError } from "@/server/errors";
import { route } from "@/server/http";
import { searchAllTypes } from "@/server/objects/search";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().max(200),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * GET /api/search?q= — unified search across every object type, including Memory (ADR 0002 §6).
 * Server-side, index-backed, no AI call. `#tag` in `q` filters by tag exactly; everything else is
 * ranked full-text/fuzzy title relevance. Preserves each result's type, status and colour so the
 * caller never has to re-fetch to know what it found.
 */
export const GET = route(async ({ req, owner, db }) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success)
    throw new ApiError(400, "validation", "Invalid search query.", parsed.error.issues);
  const results = await searchAllTypes(db, owner, parsed.data.q, { limit: parsed.data.limit });
  return Response.json({ results });
});
