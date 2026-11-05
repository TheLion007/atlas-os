import { route } from "@/server/http";
import { getGraph } from "@/server/objects/read-models";

export const dynamic = "force-dynamic";

/**
 * GET /api/graph?details=true — every live object and relation, in one payload. The lenses
 * (Command Center, Graph, Timeline, Map) are projections of this. Subgraph filtering by
 * `from` and `depth` arrives with the Graph lens.
 */
export const GET = route(async ({ req, owner, db }) => {
  const details = new URL(req.url).searchParams.get("details") === "true";
  return Response.json(await getGraph(db, owner, { details }));
});
