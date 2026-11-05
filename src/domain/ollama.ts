import type { ApiEdge, ApiObject } from "./api-types";
import { projectCards } from "./project-view";

/**
 * The optional local assistant (Ollama), as pure logic. Everything stays on the person's own PC:
 * the app only ever talks to an Ollama running on this machine, through its own local server.
 */

export const OLLAMA_URL = "http://127.0.0.1:11434";
export const DOWNLOAD_URL = "https://ollama.com/download";

export interface OllamaModel {
  name: string;
  sizeBytes: number;
}

/** What the status check found. */
export interface OllamaStatus {
  reachable: boolean;
  models: OllamaModel[];
}

/** Ollama not found · found without any model · ready to answer. */
export type OllamaState = "off" | "no-model" | "ready";

export function ollamaState(s: OllamaStatus | undefined): OllamaState {
  if (!s || !s.reachable) return "off";
  return s.models.length === 0 ? "no-model" : "ready";
}

/** The two models the tutorial proposes. */
export const RECOMMENDED = [
  { id: "small", model: "llama3.2:3b", sizeGb: 2, ramGb: 8, ramKind: "min" },
  { id: "large", model: "qwen2.5:7b", sizeGb: 5, ramGb: 16, ramKind: "reco" },
] as const;

export const pullCommand = (model: string) => `ollama pull ${model}`;

/** The model to use: the one chosen if it is still installed, else a recommended one, else the first. */
export function pickModel(models: readonly OllamaModel[], preferred: string | null): string | null {
  if (preferred && models.some((m) => m.name === preferred)) return preferred;
  for (const r of RECOMMENDED) {
    const hit = models.find((m) => m.name === r.model || m.name.startsWith(`${r.model}-`));
    if (hit) return hit.name;
  }
  return models[0]?.name ?? null;
}

/** The ways talking to Ollama can fail, each with its own plain message. */
export type OllamaErrorCode =
  "unreachable" | "model_missing" | "timeout" | "local_only" | "bad_response";

export const OLLAMA_ERROR_CODES: readonly OllamaErrorCode[] = [
  "unreachable",
  "model_missing",
  "timeout",
  "local_only",
  "bad_response",
];

export const isOllamaErrorCode = (v: unknown): v is OllamaErrorCode =>
  typeof v === "string" && (OLLAMA_ERROR_CODES as readonly string[]).includes(v);

/** What the model is told: who it is, that it answers in French from the data, and the data. */
export const SYSTEM_PROMPT =
  "Tu es l'assistant d'Atlas OS, un outil de gestion de projets personnels qui tourne entièrement sur l'ordinateur de l'utilisateur. " +
  "Réponds en français, de façon courte, simple et concrète (quelques phrases ou une courte liste). " +
  "Appuie-toi uniquement sur les données ci-dessous. Si l'information n'y est pas, dis-le sans inventer.";

const MAX_TASKS = 12;

/**
 * A compact, readable summary of the workspace for the model: the date, each project with its
 * progress, and the next open tasks. Built here from the person's own objects, and sent only to
 * the Ollama on this PC.
 */
export function assistantContext(
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
  today: string,
): string {
  const cards = projectCards(nodes, edges, today);
  const lines: string[] = [`Date du jour : ${today}.`, "", "Projets :"];
  if (cards.length === 0) lines.push("- (aucun projet)");
  for (const c of cards)
    lines.push(
      `- ${c.title} : ${Math.round((c.progress ?? 0) * 100)} % d'avancement, ${c.tasksOpen} tâche(s) ouverte(s)` +
        (c.targetDate ? `, échéance ${c.targetDate}` : ""),
    );
  const open = nodes
    .filter((n) => n.type === "task" && (n.status === "draft" || n.status === "active"))
    .map((n) => ({ n, due: typeof n.details?.due === "string" ? (n.details.due as string) : null }))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"))
    .slice(0, MAX_TASKS);
  lines.push("", "Prochaines tâches ouvertes :");
  if (open.length === 0) lines.push("- (aucune)");
  for (const { n, due } of open) lines.push(`- ${n.title}${due ? ` (pour le ${due})` : ""}`);
  return lines.join("\n");
}
