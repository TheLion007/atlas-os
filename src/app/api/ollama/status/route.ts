import { isLocalRequest, readStatus } from "@/server/ollama";

export const dynamic = "force-dynamic";

/** GET /api/ollama/status — is the Ollama on this PC answering, and which models does it have? */
export async function GET(req: Request) {
  if (!isLocalRequest(req))
    return Response.json({ error: { code: "local_only" } }, { status: 403 });
  return Response.json(await readStatus());
}
