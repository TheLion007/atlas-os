import { readJson, route } from "@/server/http";
import { createEdge, parseCreateEdgeBody } from "@/server/objects/edges";

export const dynamic = "force-dynamic";

/** POST /api/edges — relates two existing objects. The database enforces every edge rule. */
export const POST = route(async ({ req, owner, db }) => {
  const edge = await createEdge(db, owner, parseCreateEdgeBody(await readJson(req)));
  return Response.json(edge, { status: 201 });
});
