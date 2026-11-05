import { readJson, route } from "@/server/http";
import { deleteMany, parseDeleteMany } from "@/server/objects/deletion";

export const dynamic = "force-dynamic";

/** POST /api/objects/delete-many (DELETE, several objects in one step). See server/objects/deletion.ts. */
export const POST = route(async ({ req, owner, db }) => {
  const result = await deleteMany(db, owner, parseDeleteMany(await readJson(req)));
  return Response.json(result, { status: 200 });
});
