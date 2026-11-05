import { route } from "@/server/http";
import { getSettings } from "@/server/objects/read-models";

export const dynamic = "force-dynamic";

/** GET /api/settings — base currency, active scenario and manual FX rates. Read-only for now. */
export const GET = route(async ({ owner, db }) => Response.json(await getSettings(db, owner)));
