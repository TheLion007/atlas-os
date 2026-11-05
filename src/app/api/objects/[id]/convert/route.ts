import { idParam, readJson, route } from "@/server/http";
import { convertObjectType, parseConvertTypeBody } from "@/server/objects/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/objects/:id/convert — changes an object's category (project/sub_project/plan only).
 * `objects.type` is immutable, so this creates a new object of the target type and archives the
 * original; see `convertObjectType` for exactly what carries over.
 */
export const POST = route(async ({ req, owner, db, params }) => {
  const body = parseConvertTypeBody(await readJson(req));
  const result = await convertObjectType(db, owner, idParam(params), body.type);
  return Response.json(result);
});
