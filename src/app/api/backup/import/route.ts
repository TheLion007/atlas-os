import { z } from "zod";
import { readJson, route } from "@/server/http";
import { ApiError } from "@/server/errors";
import { startImport } from "@/server/backup/jobs";

export const dynamic = "force-dynamic";

const body = z.object({
  path: z.string().min(3).max(1000),
  mode: z.enum(["replace", "merge"]),
  prefs: z.record(z.string(), z.string()).optional(),
});

/** POST /api/backup/import: safety copy first, then replace or merge; poll /api/backup/status. */
export const POST = route(async ({ req }) => {
  const parsed = body.safeParse(await readJson(req));
  if (!parsed.success) throw new ApiError(400, "validation", "Invalid request.");
  return Response.json(startImport(parsed.data), { status: 202 });
});
