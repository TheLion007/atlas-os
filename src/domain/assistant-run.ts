import {
  buildProposal,
  chunkText,
  correctiveMessage,
  parseActions,
  systemPrompt,
  userMessage,
  type AssistantAction,
  type AssistantScope,
  type Proposal,
  type Workspace,
} from "./assistant-plan";
import type { OllamaErrorCode } from "./ollama";

/**
 * One run of the structured assistant: cut the text in pieces, ask the local model for each, check
 * every answer strictly (one corrective retry), and fold everything into a single proposal. The
 * model call is injected, so the same code runs against the real Ollama and against a stand-in.
 */

type Msg = { role: "system" | "user" | "assistant"; content: string };
export type Ask = (
  messages: Msg[],
  opts: { json: boolean; temperature: number },
) => Promise<{ ok: true; answer: string } | { ok: false; code: OllamaErrorCode | "cancelled" }>;

export type RunResult =
  | {
      ok: true;
      proposal: Proposal;
      actions: AssistantAction[];
      chunks: number;
      /** Pieces the model could not answer properly even after a retry. */
      failedChunks: number;
      retries: number;
    }
  | {
      ok: false;
      /** `weak`: the model never produced a usable answer. `empty`: it understood, found nothing. */
      code: OllamaErrorCode | "cancelled" | "weak" | "empty";
    };

export interface RunInput {
  text: string;
  /** Everything that exists, or only what the active context holds when `scope` is given. */
  workspace: Workspace;
  /** The element the assistant was opened from: everything is then made inside it. */
  scope?: AssistantScope | null;
  today: string;
  ask: Ask;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  chunkSize?: number;
}

export async function runAssistant(input: RunInput): Promise<RunResult> {
  const pieces = chunkText(input.text, input.chunkSize);
  const scope = input.scope ?? null;
  const actions: AssistantAction[] = [];
  let failed = 0;
  let retries = 0;
  input.onProgress?.(0, pieces.length);
  for (const [i, piece] of pieces.entries()) {
    if (input.signal?.aborted) return { ok: false, code: "cancelled" };
    const base: Msg[] = [
      { role: "system", content: systemPrompt(scope) },
      { role: "user", content: userMessage(input.workspace, input.today, piece, scope) },
    ];
    let res = await input.ask(base, { json: true, temperature: 0.1 });
    if (!res.ok) return { ok: false, code: res.code };
    let parsed = parseActions(res.answer, scope !== null);
    if (!parsed.ok) {
      retries++;
      res = await input.ask(
        [
          ...base,
          { role: "assistant", content: res.answer.slice(0, 4_000) },
          { role: "user", content: correctiveMessage(parsed.reason) },
        ],
        { json: true, temperature: 0 },
      );
      if (!res.ok) return { ok: false, code: res.code };
      parsed = parseActions(res.answer, scope !== null);
    }
    if (parsed.ok) actions.push(...parsed.actions);
    else failed++;
    input.onProgress?.(i + 1, pieces.length);
  }
  if (pieces.length > 0 && failed === pieces.length) return { ok: false, code: "weak" };
  const proposal = buildProposal(actions, input.workspace, scope);
  if (proposal.nodes.length === 0 && proposal.skipped === 0) return { ok: false, code: "empty" };
  return { ok: true, proposal, actions, chunks: pieces.length, failedChunks: failed, retries };
}
