import { z } from "zod";
import { readJson, route } from "@/server/http";
import { ApiError } from "@/server/errors";
import { inspectBackup } from "@/server/backup/load";

export const dynamic = "force-dynamic";

const body = z.object({ path: z.string().min(3).max(1000) });

/** POST /api/backup/inspect: checks a backup and says what is in it, changing nothing. */
export const POST = route(async ({ req }) => {
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "validation", "Invalid request.");
  return Response.json(await inspectBackup(parsed.data.path));
});
