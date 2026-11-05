import { route } from "@/server/http";
import { getProgress } from "@/server/objects/read-models";

export const dynamic = "force-dynamic";

/** GET /api/progress?days=120 — the work journal (tasks finished, notes written, files added). */
export const GET = route(async ({ req, owner, db }) => {
  const raw = Number(new URL(req.url).searchParams.get("days") ?? "120");
  return Response.json(await getProgress(db, owner, Number.isFinite(raw) ? raw : 120));
});
