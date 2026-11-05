import { readJson, route } from "@/server/http";
import { purgeMany, parsePurgeMany } from "@/server/objects/deletion";

export const dynamic = "force-dynamic";

/** POST /api/objects/purge-many (PURGE, several objects in one step). See server/objects/deletion.ts. */
export const POST = route(async ({ req, owner, db }) => {
  const result = await purgeMany(db, owner, parsePurgeMany(await readJson(req)));
  return Response.json(result, { status: 200 });
});
