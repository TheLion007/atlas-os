import { idParam, readJson, route } from "@/server/http";
import { attachTag, parseAttachTagBody } from "@/server/objects/tags";

export const dynamic = "force-dynamic";

/** POST /api/objects/:id/tags — attaches an existing tag from the catalogue to this object. */
export const POST = route(async ({ req, owner, db, params }) => {
  const objectId = idParam(params);
  const tagId = parseAttachTagBody(await readJson(req));
  await attachTag(db, owner, objectId, tagId);
  return new Response(null, { status: 204 });
});
