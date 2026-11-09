import { z } from "zod";
import { readJson, route } from "@/server/http";
import { ApiError } from "@/server/errors";
import { startExport } from "@/server/backup/jobs";
import { BACKUP_EXTENSION } from "@/server/backup/manifest";

export const dynamic = "force-dynamic";

const body = z.object({
  path: z.string().min(3).max(1000),
  prefs: z.record(z.string(), z.string()).optional(),
  kind: z.enum(["manual", "auto", "safety"]).optional(),
});

/** POST /api/backup/export: writes a .atlasbackup in the background; poll /api/backup/status. */
export const POST = route(async ({ req }) => {
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "validation", "Invalid request.");
  if (!parsed.data.path.toLowerCase().endsWith(BACKUP_EXTENSION))
    throw new ApiError(400, "validation", "A backup file ends with .atlasbackup.");
  return Response.json(startExport(parsed.data), { status: 202 });
});
