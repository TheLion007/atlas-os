import { z } from "zod";
import { ApiError } from "@/server/errors";
import { idParam, route } from "@/server/http";
import { detachTag } from "@/server/objects/tags";

export const dynamic = "force-dynamic";

/** DELETE /api/objects/:id/tags/:tagId — detaches a tag. Detaching one already gone is a no-op. */
export const DELETE = route(async ({ owner, db, params }) => {
  const objectId = idParam(params);
  const tagId = z.uuid().safeParse(params.tagId);
  if (!tagId.success) throw new ApiError(400, "validation", "The tag id is not a valid UUID.");
  await detachTag(db, owner, objectId, tagId.data);
  return new Response(null, { status: 204 });
});
