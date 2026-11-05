import { idParam, route } from "@/server/http";
import { deleteEdge } from "@/server/objects/edges";

export const dynamic = "force-dynamic";

/** DELETE /api/edges/:id — soft delete; the same relation may be created again later. */
export const DELETE = route(async ({ owner, db, params }) => {
  await deleteEdge(db, owner, idParam(params));
  return new Response(null, { status: 204 });
});
