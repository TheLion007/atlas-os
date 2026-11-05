import { z } from "zod";
import { chat, isLocalRequest, OllamaFailure } from "@/server/ollama";

export const dynamic = "force-dynamic";

const body = z.object({
  model: z.string().min(1).max(200),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().max(40_000),
      }),
    )
    .min(1)
    .max(40),
  json: z.boolean().optional(),
  temperature: z.number().min(0).max(1).optional(),
});

/** POST /api/ollama/chat — one answer from a model installed on this PC. */
export async function POST(req: Request) {
  if (!isLocalRequest(req))
    return Response.json({ error: { code: "local_only" } }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "bad_response" } }, { status: 400 });
  try {
    const answer = await chat(parsed.data.model, parsed.data.messages, {
      json: parsed.data.json,
      temperature: parsed.data.temperature,
    });
    return Response.json({ answer });
  } catch (e) {
    if (e instanceof OllamaFailure)
      return Response.json({ error: { code: e.code } }, { status: e.status });
    return Response.json({ error: { code: "bad_response" } }, { status: 502 });
  }
}
