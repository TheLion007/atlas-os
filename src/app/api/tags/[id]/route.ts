import { idParam, readJson, route } from "@/server/http";
import { deleteTag, parseUpdateTagBody, updateTag } from "@/server/objects/tags";

export const dynamic = "force-dynamic";

/** PATCH /api/tags/:id — renames or recolours a tag. */
export const PATCH = route(async ({ req, owner, db, params }) => {
  const patch = parseUpdateTagBody(await readJson(req));
  const tag = await updateTag(db, owner, idParam(params), patch);
  return Response.json(tag);
});

/** DELETE /api/tags/:id — removes the tag and every attachment to it (cascade). */
export const DELETE = route(async ({ owner, db, params }) => {
  await deleteTag(db, owner, idParam(params));
  return new Response(null, { status: 204 });
});
