import { hasDesktopToken } from "./local-owner";
import {
  OLLAMA_URL,
  type OllamaErrorCode,
  type OllamaModel,
  type OllamaStatus,
} from "@/domain/ollama";

/**
 * Atlas OS talks to Ollama from its own local server, never from the page: the browser would hit
 * CORS (Ollama only trusts a few origins), while a server-to-server call on the same PC does not,
 * in development, in `next start` and in any packaged build that embeds this server. Nothing here
 * leaves the machine: the only address ever called is the Ollama on this PC.
 */

const base = () => (process.env.ATLAS_OLLAMA_URL ?? OLLAMA_URL).replace(/\/+$/, "");

/** How long to wait for each kind of call. */
export const STATUS_TIMEOUT_MS = 2_500;
export const CHAT_TIMEOUT_MS = 120_000;
/** How long a model stays in memory after its last use. */
export const KEEP_ALIVE = "15m";

/** Only a request that comes from this same PC may use the bridge (never a remote visitor). */
export function isLocalRequest(req: Request): boolean {
  if (!hasDesktopToken(req)) return false;
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const o = new URL(origin).hostname.replace(/^\[|\]$/g, "");
    return ["localhost", "127.0.0.1", "::1"].includes(o);
  } catch {
    return false;
  }
}

export class OllamaFailure extends Error {
  constructor(
    readonly code: OllamaErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(`${base()}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw timedOut
      ? new OllamaFailure("timeout", 504, "Ollama took too long to answer.")
      : new OllamaFailure("unreachable", 503, "Ollama is not running.");
  }
}

/** Is Ollama answering, and which models are installed? Never throws: "off" is an answer. */
export async function readStatus(): Promise<OllamaStatus> {
  try {
    const res = await call("/api/tags", { method: "GET" }, STATUS_TIMEOUT_MS);
    if (!res.ok) return { reachable: false, models: [] };
    const body = (await res.json()) as { models?: { name?: unknown; size?: unknown }[] };
    const models: OllamaModel[] = (body.models ?? []).flatMap((m) =>
      typeof m.name === "string"
        ? [{ name: m.name, sizeBytes: typeof m.size === "number" ? m.size : 0 }]
        : [],
    );
    return { reachable: true, models };
  } catch {
    return { reachable: false, models: [] };
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One answer from `model`, or a typed failure. */
export interface ChatOptions {
  /** Ask for a JSON answer (Ollama then only produces valid JSON). */
  json?: boolean;
  temperature?: number;
}

export async function chat(
  model: string,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const res = await call(
    "/api/chat",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        keep_alive: KEEP_ALIVE,
        ...(opts.json ? { format: "json" } : {}),
        ...(opts.temperature !== undefined ? { options: { temperature: opts.temperature } } : {}),
      }),
    },
    CHAT_TIMEOUT_MS,
  );
  if (res.status === 404)
    throw new OllamaFailure("model_missing", 404, `The model ${model} is not installed.`);
  if (!res.ok) throw new OllamaFailure("bad_response", 502, "Ollama answered with an error.");
  let body: { message?: { content?: unknown } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new OllamaFailure("bad_response", 502, "Ollama sent something unreadable.");
  }
  const text = body.message?.content;
  if (typeof text !== "string" || text.trim() === "")
    throw new OllamaFailure("bad_response", 502, "Ollama sent an empty answer.");
  return text.trim();
}

/** Loads `model` into memory (an empty request), so the first real question does not pay for it. */
export async function warmup(model: string): Promise<void> {
  const res = await call(
    "/api/generate",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, keep_alive: KEEP_ALIVE }),
    },
    CHAT_TIMEOUT_MS,
  );
  if (res.status === 404)
    throw new OllamaFailure("model_missing", 404, `The model ${model} is not installed.`);
  if (!res.ok) throw new OllamaFailure("bad_response", 502, "Ollama answered with an error.");
}
