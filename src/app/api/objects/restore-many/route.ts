import { readJson, route } from "@/server/http";
import { restoreMany, parseRestoreMany } from "@/server/objects/deletion";

export const dynamic = "force-dynamic";

/** POST /api/objects/restore-many (RESTORE, several objects in one step). See server/objects/deletion.ts. */
export const POST = route(async ({ req, owner, db }) => {
  const result = await restoreMany(db, owner, parseRestoreMany(await readJson(req)));
  return Response.json(result, { status: 200 });
});
