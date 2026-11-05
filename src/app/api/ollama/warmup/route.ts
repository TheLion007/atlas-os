import { z } from "zod";
import { isLocalRequest, OllamaFailure, warmup } from "@/server/ollama";

export const dynamic = "force-dynamic";

const body = z.object({ model: z.string().min(1).max(200) });

/** POST /api/ollama/warmup — loads a model of this PC into memory so the first answer is quick. */
export async function POST(req: Request) {
  if (!isLocalRequest(req))
    return Response.json({ error: { code: "local_only" } }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "bad_response" } }, { status: 400 });
  try {
    await warmup(parsed.data.model);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof OllamaFailure)
      return Response.json({ error: { code: e.code } }, { status: e.status });
    return Response.json({ error: { code: "bad_response" } }, { status: 502 });
  }
}
