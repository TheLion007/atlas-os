import { readJson, route } from "@/server/http";
import { createTag, listTags, parseCreateTagBody } from "@/server/objects/tags";

export const dynamic = "force-dynamic";

/** GET /api/tags — the owner's user tag catalogue (ADR 0002 §4). System tags are not rows here. */
export const GET = route(async ({ owner, db }) => Response.json(await listTags(db, owner)));

/** POST /api/tags — creates a user tag. */
export const POST = route(async ({ req, owner, db }) => {
  const tag = await createTag(db, owner, parseCreateTagBody(await readJson(req)));
  return Response.json(tag, { status: 201 });
});
