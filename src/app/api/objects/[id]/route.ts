import { idParam, readJson, route } from "@/server/http";
import {
  deleteObject,
  getObject,
  parseUpdateObjectBody,
  updateObject,
} from "@/server/objects/service";

export const dynamic = "force-dynamic";

/** GET /api/objects/:id?expand=relations — relations come back grouped by edge verb. */
export const GET = route(async ({ req, owner, db, params }) => {
  const expand = new URL(req.url).searchParams.get("expand");
  const object = await getObject(db, owner, idParam(params), {
    expandRelations: expand === "relations",
  });
  return Response.json(object);
});

/** PATCH /api/objects/:id — partial update, re-validated as a whole. `type` cannot change. */
export const PATCH = route(async ({ req, owner, db, params }) => {
  const patch = parseUpdateObjectBody(await readJson(req));
  return Response.json(await updateObject(db, owner, idParam(params), patch));
});

/** DELETE /api/objects/:id — soft delete. */
export const DELETE = route(async ({ owner, db, params }) => {
  await deleteObject(db, owner, idParam(params));
  return new Response(null, { status: 204 });
});
