import { route } from "@/server/http";
import { getActivity } from "@/server/objects/read-models";

export const dynamic = "force-dynamic";

/** GET /api/activity?limit=30 — what changed recently, newest first. */
export const GET = route(async ({ req, owner, db }) => {
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? "30");
  return Response.json(await getActivity(db, owner, Number.isFinite(raw) ? raw : 30));
});
