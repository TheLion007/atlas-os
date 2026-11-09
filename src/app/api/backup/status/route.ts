import { route } from "@/server/http";
import { currentJob } from "@/server/backup/jobs";

export const dynamic = "force-dynamic";

/** GET /api/backup/status: the running (or last) export or import, for the progress bar. */
export const GET = route(async () => Response.json({ job: currentJob() }));
