import { route } from "@/server/http";
import { closeLiveDatabase } from "@/server/db/pglite";

export const dynamic = "force-dynamic";

/** POST /api/backup/shutdown: the desktop shell closes the database cleanly before stopping. */
export const POST = route(async () => {
  await closeLiveDatabase();
  return Response.json({ ok: true });
});
