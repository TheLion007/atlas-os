import { ApiError } from "@/server/errors";
import { readJson, route } from "@/server/http";
import {
  createObject,
  listObjects,
  listObjectsQuerySchema,
  parseCreateObjectBody,
} from "@/server/objects/service";

export const dynamic = "force-dynamic";

/** GET /api/objects?type=&status=&limit=&offset= — details are included when `type` is set. */
export const GET = route(async ({ req, owner, db }) => {
  const query = listObjectsQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!query.success) {
    throw new ApiError(400, "validation", "Invalid query.", query.error.issues);
  }
  return Response.json(await listObjects(db, owner, query.data));
});

/** POST /api/objects — creates an object, its details and any `relations` atomically. */
export const POST = route(async ({ req, owner, db }) => {
  const { object, relations } = parseCreateObjectBody(await readJson(req));
  const created = await createObject(db, owner, object, relations);
  return Response.json(created, {
    status: 201,
    headers: { Location: `/api/objects/${created.id}` },
  });
});
