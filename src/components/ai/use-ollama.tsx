"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  isOllamaErrorCode,
  ollamaState,
  pickModel,
  type OllamaErrorCode,
  type OllamaState,
  type OllamaStatus,
} from "@/domain/ollama";
import { useOllamaStore } from "@/lib/ollama-store";

const POLL_MS = 3000;
/// A little more than the server's own limit, so the server's answer is the one the person sees.
const CHAT_CLIENT_TIMEOUT_MS = 125_000;

async function fetchStatus(): Promise<OllamaStatus> {
  try {
    const res = await fetch("/api/ollama/status", { cache: "no-store" });
    if (!res.ok) return { reachable: false, models: [] };
    return (await res.json()) as OllamaStatus;
  } catch {
    return { reachable: false, models: [] };
  }
}

export interface UseOllama {
  /** Nothing known yet (the first check is still running). */
  pending: boolean;
  state: OllamaState;
  status: OllamaStatus | undefined;
  /** The installed model that will be used. */
  model: string | null;
  /** A check is running (the first one or a re-check). */
  checking: boolean;
  /** Ask again now; resolves with what was found. */
  check: () => Promise<OllamaStatus>;
}

/**
 * Is Ollama there, and with which models? Checked when asked for, again whenever the window comes
 * back, and every few seconds while the tutorial is open (`poll`), so a step finished in another
 * window is noticed without any click.
 */
export function useOllama(poll = false): UseOllama {
  const preferred = useOllamaStore((s) => s.model);
  const q = useQuery({
    queryKey: ["ollama-status"],
    queryFn: fetchStatus,
    refetchInterval: poll ? POLL_MS : false,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
  });
  return {
    pending: q.isPending,
    state: ollamaState(q.data),
    status: q.data,
    model: q.data ? pickModel(q.data.models, preferred) : null,
    checking: q.isFetching,
    check: async () => (await q.refetch()).data ?? { reachable: false, models: [] },
  };
}

export type AskResult =
  { ok: true; answer: string } | { ok: false; code: OllamaErrorCode | "cancelled" };

/** One question to the local model, through this app's own server. Never throws. */
export async function askOllama(
  model: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  signal?: AbortSignal,
  opts?: { json?: boolean; temperature?: number },
): Promise<AskResult> {
  try {
    const res = await fetch("/api/ollama/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, ...opts }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(CHAT_CLIENT_TIMEOUT_MS)])
        : AbortSignal.timeout(CHAT_CLIENT_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as {
      answer?: unknown;
      error?: { code?: unknown };
    } | null;
    if (res.ok && typeof body?.answer === "string") return { ok: true, answer: body.answer };
    const code = body?.error?.code;
    return { ok: false, code: isOllamaErrorCode(code) ? code : "bad_response" };
  } catch (e) {
    if (signal?.aborted) return { ok: false, code: "cancelled" };
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    return { ok: false, code: timedOut ? "timeout" : "unreachable" };
  }
}

/**
 * Asks Ollama to load `model` into memory. Resolves `true` when it is loaded; never throws.
 * Loading a model for the first time is the slow part of a first answer.
 */
export async function warmUpModel(model: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/api/ollama/warmup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Restores what was decided about the assistant (model, "later") once the page is up. */
export function AiEngine() {
  useEffect(() => {
    void useOllamaStore.persist.rehydrate();
  }, []);
  return null;
}
