import { z } from "zod";
import type { ApiEdge, ApiObject } from "./api-types";
import { descendantsOf } from "./project-view";
import { norm } from "./triage";

/**
 * The assistant's structured mode, as pure logic. The local model reads the person's loose text and
 * answers with a list of typed actions (JSON). Nothing from the model is trusted: the answer is
 * validated strictly, every project it cites is checked against the real ones (it can never invent
 * an identifier), duplicates are folded into what already exists, and the result is a tree the
 * person reviews, edits and approves before anything is created.
 */

// ── What the model may answer ────────────────────────────────────────────────────────────────

const clean = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : v);
const str = (max: number) => z.string().trim().min(1).max(max);
const optStr = (max: number) => z.preprocess(clean, str(max).optional());
const isoDay = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date au format AAAA-MM-JJ")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T12:00:00Z`)), "date inexistante");
const optDay = z.preprocess(clean, isoDay.optional());

export const ACTION_TYPES = [
  "create_plan",
  "create_project",
  "create_subproject",
  "add_task",
  "add_note",
  "add_deadline",
] as const;

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_plan"), name: str(200), description: optStr(2_000) }),
  z.object({
    type: z.literal("create_project"),
    name: str(200),
    plan: optStr(200),
    category: optStr(60),
    description: optStr(2_000),
  }),
  z.object({
    type: z.literal("create_subproject"),
    name: str(200),
    project: optStr(200),
    category: optStr(60),
  }),
  z.object({
    type: z.literal("add_task"),
    title: str(200),
    project: optStr(200),
    due: optDay,
    category: optStr(40),
  }),
  z.object({
    type: z.literal("add_note"),
    title: str(200),
    text: optStr(10_000),
    project: optStr(200),
  }),
  z.object({
    type: z.literal("add_deadline"),
    title: str(200),
    date: isoDay,
    project: optStr(200),
  }),
]);
export type AssistantAction = z.infer<typeof actionSchema>;

const answerSchema = z.object({ actions: z.array(actionSchema).max(200) });

export type ParseResult = { ok: true; actions: AssistantAction[] } | { ok: false; reason: string };

/** The JSON inside a model answer: bare, in a code fence, or wrapped in a sentence. */
export function extractJson(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const open = text.search(/[{[]/);
    const close = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (open < 0 || close <= open) throw new Error("no JSON");
    return JSON.parse(text.slice(open, close + 1));
  }
}

/**
 * Strict validation of a model answer. The reason is written to be sent back to the model.
 * Outside a context every action must say which project it goes to; inside one (`scoped`) a
 * missing project simply means "here".
 */
export function parseActions(raw: string, scoped = false): ParseResult {
  let data: unknown;
  try {
    data = extractJson(raw);
  } catch {
    return { ok: false, reason: "ta réponse n'est pas du JSON valide" };
  }
  if (Array.isArray(data)) data = { actions: data };
  const res = answerSchema.safeParse(data);
  if (res.success) {
    const lost = scoped
      ? -1
      : res.data.actions.findIndex(
          (a) => a.type !== "create_plan" && a.type !== "create_project" && !a.project,
        );
    if (lost >= 0) return { ok: false, reason: `actions.${lost}.project : champ obligatoire` };
    return { ok: true, actions: res.data.actions };
  }
  const issues = res.error.issues.slice(0, 3).map((i) => {
    const where = i.path.length ? i.path.join(".") : "racine";
    return `${where} : ${i.message}`;
  });
  return { ok: false, reason: issues.join(" ; ") };
}

// ── What the model is told ───────────────────────────────────────────────────────────────────

export interface WsItem {
  /** Short identifier shown to the model (pl1, pr2, sp3): it maps to a real id and nothing else. */
  alias: string;
  id: string;
  name: string;
  parentId: string | null;
  /** Normalised titles of the open tasks inside (to avoid proposing them twice). */
  tasks: Set<string>;
}

export interface Workspace {
  plans: WsItem[];
  projects: WsItem[];
  subs: WsItem[];
  byId: Map<string, WsItem & { kind: "plan" | "project" | "sub" }>;
}

/** The plans, projects and sub-projects that exist, with short aliases for the model. */
export function buildWorkspace(nodes: readonly ApiObject[], edges: readonly ApiEdge[]): Workspace {
  const parent = new Map<string, string>();
  for (const e of edges) if (e.kind === "contains") parent.set(e.to, e.from);
  const tasksOf = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (n.type !== "task" || n.status === "done" || n.status === "dropped") continue;
    const p = parent.get(n.id);
    if (p) tasksOf.set(p, (tasksOf.get(p) ?? new Set()).add(norm(n.title)));
  }
  const make = (type: ApiObject["type"], prefix: string) =>
    nodes
      .filter((n) => n.type === type && n.status !== "dropped")
      .map((n, i) => ({
        alias: `${prefix}${i + 1}`,
        id: n.id,
        name: n.title,
        parentId: parent.get(n.id) ?? null,
        tasks: tasksOf.get(n.id) ?? new Set<string>(),
      }));
  const plans = make("plan", "pl");
  const projects = make("project", "pr");
  const subs = make("sub_project", "sp");
  const byId: Workspace["byId"] = new Map();
  for (const [list, kind] of [
    [plans, "plan"],
    [projects, "project"],
    [subs, "sub"],
  ] as const)
    for (const it of list) byId.set(it.id, { ...it, kind });
  return { plans, projects, subs, byId };
}

// ── The context the assistant was opened from ────────────────────────────────────────────────

export type ScopeKind = "project" | "sub" | "task";

/**
 * The element the assistant was opened from. While it is active everything the assistant makes
 * goes inside it: the model is only shown what it holds, and whatever the model answers is
 * brought back inside (see `buildProposal`).
 */
export interface AssistantScope {
  id: string;
  name: string;
  kind: ScopeKind;
  parent: { id: string; name: string; kind: "plan" | ScopeKind } | null;
  /** Names from the top project down to the element itself (« Jeu Roblox », « Map »). */
  trail: string[];
  /** Normalised titles of the open tasks directly inside (to avoid proposing them twice). */
  tasks: Set<string>;
}

/** How the model names the active context. */
export const SCOPE_REF = "ctx";

const SCOPE_KINDS: Partial<Record<ApiObject["type"], "plan" | ScopeKind>> = {
  plan: "plan",
  project: "project",
  sub_project: "sub",
  task: "task",
};

/** The context for an object, or null when it is not a live project, sub-project or task. */
export function resolveScope(
  id: string | null | undefined,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): AssistantScope | null {
  if (!id) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const me = byId.get(id);
  const kind = me ? SCOPE_KINDS[me.type] : undefined;
  if (!me || !kind || kind === "plan" || me.status === "dropped") return null;
  const up = new Map<string, string>();
  for (const e of edges) if (e.kind === "contains") up.set(e.to, e.from);
  const trail = [me.title];
  const seen = new Set([id]);
  for (let cur = up.get(id); cur && !seen.has(cur); cur = up.get(cur)) {
    seen.add(cur);
    const n = byId.get(cur);
    const k = n ? SCOPE_KINDS[n.type] : undefined;
    if (!n || !k || k === "plan") break;
    trail.unshift(n.title);
  }
  const above = byId.get(up.get(id) ?? "");
  const aboveKind = above ? SCOPE_KINDS[above.type] : undefined;
  const tasks = new Set<string>();
  for (const n of nodes)
    if (n.type === "task" && n.status !== "done" && n.status !== "dropped" && up.get(n.id) === id)
      tasks.add(norm(n.title));
  return {
    id,
    name: me.title,
    kind,
    parent: above && aboveKind ? { id: above.id, name: above.title, kind: aboveKind } : null,
    trail,
    tasks,
  };
}

/** The workspace as seen from a context: the element and what it holds, nothing else. */
export function scopeWorkspace(
  scope: AssistantScope,
  nodes: readonly ApiObject[],
  edges: readonly ApiEdge[],
): Workspace {
  const keep = descendantsOf(scope.id, edges);
  keep.add(scope.id);
  return buildWorkspace(
    nodes.filter((n) => keep.has(n.id)),
    edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  );
}

const SUB_VS_TASK =
  "- Distingue bien un sous-projet d'une tâche. Un sous-projet est un ensemble de plusieurs tâches avec un objectif propre : son nom est un groupe nominal (« Gestion de la map », « Design », « Promotion »). Une tâche est une action précise, qu'on coche quand elle est faite : elle commence par un verbe (« Dessiner le terrain »). Ne crée jamais de sous-projet pour une action unique ; dans le doute, c'est une tâche.\n";

const KIND_FR: Record<"plan" | ScopeKind, string> = {
  plan: "le plan",
  project: "le projet",
  sub: "le sous-projet",
  task: "la tâche",
};

const SCOPED_HEAD =
  "Tu es le moteur de classement d'Atlas OS, un outil de gestion de projets. " +
  `L'utilisateur travaille en ce moment DANS un élément précis, le « contexte actif », décrit dans son message et désigné par l'id "${SCOPE_REF}". ` +
  "Tout ce qu'il écrit concerne cet élément : tu ajoutes dedans, jamais ailleurs. " +
  'Tu transformes son texte en actions et tu réponds UNIQUEMENT par un objet JSON de la forme {"actions":[...]}, sans aucun autre texte.\n\n';

const SCOPED_COMMON =
  "- Ne demande jamais de quel projet il s'agit et n'en cherche pas d'autre : c'est le contexte actif.\n" +
  "- Ne crée jamais de plan ni de projet. Ne recrée pas le contexte actif ni ce qu'il contient déjà.\n" +
  "- Une tâche commence par un verbe (« Dessiner le terrain »). Calcule les dates relatives (demain, vendredi) à partir de la date du jour.\n" +
  "- Ignore ce qui n'est clairement rien à créer. S'il n'y a rien à faire, réponds {\"actions\":[]}.\n\n";

/** Opened from a project or a sub-project: sub-projects (or sub-sub-projects) and tasks inside. */
const SYSTEM_PROMPT_IN_CONTAINER =
  SCOPED_HEAD +
  "Types d'actions et leurs champs :\n" +
  `- {"type":"create_subproject","name":"...","project":"${SCOPE_REF} ou l'id d'un sous-projet du contexte"}\n` +
  `- {"type":"add_task","title":"...","project":"${SCOPE_REF}, l'id d'un sous-projet du contexte, ou le nom d'un sous-projet que tu crées","due":"AAAA-MM-JJ (facultatif)"}\n` +
  `- {"type":"add_note","title":"...","text":"contenu","project":"${SCOPE_REF} ou un sous-projet du contexte"}\n` +
  `- {"type":"add_deadline","title":"...","date":"AAAA-MM-JJ","project":"${SCOPE_REF} ou un sous-projet du contexte"}\n\n` +
  "Règles :\n" +
  `- Le champ "project" vaut "${SCOPE_REF}", l'id d'un sous-projet listé dans le contexte, ou le nom d'un sous-projet que tu crées dans la même réponse. Rien d'autre.\n` +
  SUB_VS_TASK +
  "- Par défaut, une chose à faire est une tâche (add_task). Utilise add_note seulement pour une information à garder, et add_deadline seulement quand une date précise est donnée.\n" +
  SCOPED_COMMON +
  "Exemple. Contexte actif : le projet « Jeu Roblox ». Texte : « ajoute la gestion de la map, avec dessiner le terrain et placer les spawns, et il faut corriger le bug du saut ». Réponse :\n" +
  `{"actions":[{"type":"create_subproject","name":"Gestion de la map","project":"${SCOPE_REF}"},{"type":"add_task","title":"Dessiner le terrain","project":"Gestion de la map"},{"type":"add_task","title":"Placer les spawns","project":"Gestion de la map"},{"type":"add_task","title":"Corriger le bug du saut","project":"${SCOPE_REF}"}]}`;

/** Opened from a task: only sub-tasks (and notes) of that task. */
const SYSTEM_PROMPT_IN_TASK =
  SCOPED_HEAD +
  "Le contexte actif est une tâche : tu la découpes en sous-tâches.\n\n" +
  "Types d'actions et leurs champs :\n" +
  `- {"type":"add_task","title":"...","project":"${SCOPE_REF}","due":"AAAA-MM-JJ (facultatif)"} : une sous-tâche\n` +
  `- {"type":"add_note","title":"...","text":"contenu","project":"${SCOPE_REF}"} : une information à garder\n\n` +
  "Règles :\n" +
  "- Chaque chose à faire devient une sous-tâche (add_task). Ne crée jamais de sous-projet ici.\n" +
  SCOPED_COMMON +
  "Exemple. Contexte actif : la tâche « Dessiner le terrain ». Texte : « d'abord faire un croquis, puis sculpter les collines et peindre l'herbe ». Réponse :\n" +
  `{"actions":[{"type":"add_task","title":"Faire un croquis","project":"${SCOPE_REF}"},{"type":"add_task","title":"Sculpter les collines","project":"${SCOPE_REF}"},{"type":"add_task","title":"Peindre l'herbe","project":"${SCOPE_REF}"}]}`;

/** What the model is told: the usual instructions, or the ones of the active context. */
export function systemPrompt(scope?: AssistantScope | null): string {
  if (!scope) return SYSTEM_PROMPT_STRUCT;
  return scope.kind === "task" ? SYSTEM_PROMPT_IN_TASK : SYSTEM_PROMPT_IN_CONTAINER;
}

/** One line saying where the context is: « le sous-projet « Map », dans le projet « Jeu Roblox » ». */
export function scopeSentence(scope: AssistantScope): string {
  const where = scope.parent ? `, dans ${KIND_FR[scope.parent.kind]} « ${scope.parent.name} »` : "";
  return `${KIND_FR[scope.kind]} « ${scope.name} »${where}`;
}

/** The active context, as the model reads it: where it is, and what it already holds. */
export function describeScope(ws: Workspace, scope: AssistantScope, today: string): string {
  const lines = [
    `Date du jour : ${today}.`,
    "",
    `CONTEXTE ACTIF (id : ${SCOPE_REF}) : ${scopeSentence(scope)}.`,
    `Chemin : ${scope.trail.join(" › ")}`,
  ];
  if (scope.kind !== "task") {
    const subs = ws.subs.filter((s) => s.id !== scope.id).slice(0, 150);
    lines.push("", "Sous-projets déjà dans ce contexte :");
    if (subs.length === 0) lines.push("- (aucun)");
    for (const s of subs) {
      const up = s.parentId && s.parentId !== scope.id ? ws.byId.get(s.parentId)?.alias : null;
      lines.push(`- ${s.alias} : ${s.name}${up ? ` (dans ${up})` : ""}`);
    }
  }
  return lines.join("\n");
}

export const SYSTEM_PROMPT_STRUCT =
  "Tu es le moteur de classement d'Atlas OS, un outil de gestion de projets. " +
  'L\'utilisateur écrit en vrac, dans ses mots. Tu transformes son texte en actions et tu réponds UNIQUEMENT par un objet JSON de la forme {"actions":[...]}, sans aucun autre texte.\n\n' +
  "Types d'actions et leurs champs :\n" +
  '- {"type":"create_plan","name":"..."}\n' +
  '- {"type":"create_project","name":"...","plan":"nom ou id du plan (facultatif)","category":"catégorie courte (facultatif)"}\n' +
  '- {"type":"create_subproject","name":"...","project":"nom ou id du projet parent"}\n' +
  '- {"type":"add_task","title":"...","project":"nom ou id du projet ou sous-projet","due":"AAAA-MM-JJ (facultatif)","category":"(facultatif)"}\n' +
  '- {"type":"add_note","title":"...","text":"contenu","project":"nom ou id"}\n' +
  '- {"type":"add_deadline","title":"...","date":"AAAA-MM-JJ","project":"nom ou id"}\n\n' +
  "Règles :\n" +
  "- Comprends le texte dans son ensemble : une phrase peut donner plusieurs actions de types différents. Ne découpe jamais ligne par ligne sans raison.\n" +
  "- Pour un projet, un sous-projet ou un plan qui existe déjà, reprends son nom exactement comme dans la liste (ou son id). N'invente jamais d'id.\n" +
  "- Si le projet cité n'existe pas, mets simplement son nom : il sera créé. Ne recrée pas ce qui existe déjà.\n" +
  "- Quand l'utilisateur ne donne pas de catégorie pour un projet, choisis-en une courte et logique (Logiciel, Audio, Voyage, Finance, Maison, Santé…).\n" +
  "- Par défaut, une chose à faire est une tâche (add_task). Utilise add_note seulement pour une information à garder, et add_deadline seulement quand une date précise est donnée.\n" +
  SUB_VS_TASK +
  "- Une tâche commence par un verbe (« Finir le design du graphe »). Calcule les dates relatives (demain, vendredi) à partir de la date du jour.\n" +
  "- Ignore ce qui n'est clairement ni un projet, ni une tâche, ni une note, ni une échéance. S'il n'y a rien à faire, réponds {\"actions\":[]}.\n\n" +
  "Exemple 1. Texte : « Crée un plan Maison avec Cuisine et Jardin, et dans Cuisine ajoute les sous-projets Peinture et Meubles ». Réponse :\n" +
  '{"actions":[{"type":"create_plan","name":"Maison"},{"type":"create_project","name":"Cuisine","plan":"Maison","category":"Maison"},{"type":"create_project","name":"Jardin","plan":"Maison","category":"Maison"},{"type":"create_subproject","name":"Peinture","project":"Cuisine"},{"type":"create_subproject","name":"Meubles","project":"Cuisine"}]}\n' +
  "Exemple 2. Projets existants : pr1 « Site web », pr2 « Voyage Japon ». Texte : « refaire la page contact du site, réserver les billets pour le Japon avant le 2026-12-01 ». Réponse :\n" +
  '{"actions":[{"type":"add_task","title":"Refaire la page contact","project":"pr1"},{"type":"add_task","title":"Réserver les billets","project":"pr2","due":"2026-12-01"}]}';

export function describeWorkspace(ws: Workspace, today: string): string {
  const line = (it: WsItem, extra = "") => `- ${it.alias} : ${it.name}${extra}`;
  const nameOf = (id: string | null) => (id ? ws.byId.get(id)?.alias : undefined);
  const part = (title: string, items: string[]) => [
    title,
    ...(items.length ? items : ["- (aucun)"]),
  ];
  return [
    `Date du jour : ${today}.`,
    "",
    ...part(
      "Plans existants :",
      ws.plans.map((p) => line(p)),
    ),
    "",
    ...part(
      "Projets existants :",
      ws.projects
        .slice(0, 150)
        .map((p) => line(p, nameOf(p.parentId) ? ` (dans ${nameOf(p.parentId)})` : "")),
    ),
    "",
    ...part(
      "Sous-projets existants :",
      ws.subs
        .slice(0, 150)
        .map((p) => line(p, nameOf(p.parentId) ? ` (dans ${nameOf(p.parentId)})` : "")),
    ),
  ].join("\n");
}

export function userMessage(
  ws: Workspace,
  today: string,
  text: string,
  scope?: AssistantScope | null,
): string {
  const context = scope ? describeScope(ws, scope, today) : describeWorkspace(ws, today);
  return `${context}\n\nTexte de l'utilisateur :\n"""\n${text}\n"""\n\nRéponds uniquement par le JSON.`;
}

/** The message that follows an invalid answer. */
export function correctiveMessage(reason: string): string {
  return `Ta réponse est invalide : ${reason}. Recommence et réponds UNIQUEMENT par un objet JSON {"actions":[...]} qui respecte exactement les types et les champs demandés.`;
}

/**
 * Cuts a long text into pieces the model can digest, never inside a list or a sentence unless it
 * has to: first at blank lines, then at line ends, then at sentence ends.
 */
export function chunkText(text: string, max = 1_800): string[] {
  const body = text.trim();
  if (body.length <= max) return body ? [body] : [];
  const atomic = (para: string): string[] => {
    if (para.length <= max) return [para];
    const out: string[] = [];
    let cur = "";
    const pieces = para
      .split(/\n/)
      .flatMap((l) =>
        l.length <= max
          ? [l]
          : (l.match(/[^.!?]+[.!?]*\s*/g) ?? [l]).flatMap(
              (s) => s.match(new RegExp(`.{1,${max}}`, "gs")) ?? [],
            ),
      );
    for (const p of pieces) {
      if (cur && cur.length + p.length + 1 > max) {
        out.push(cur.trim());
        cur = "";
      }
      cur += (cur ? "\n" : "") + p;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const out: string[] = [];
  let cur = "";
  for (const para of body.split(/\n\s*\n/).flatMap(atomic)) {
    if (cur && cur.length + para.length + 2 > max) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + para;
  }
  if (cur) out.push(cur);
  return out;
}

// ── The proposal tree ────────────────────────────────────────────────────────────────────────

export type NodeKind = "plan" | "project" | "sub" | "task" | "note" | "deadline";

export interface PNode {
  key: string;
  kind: NodeKind;
  title: string;
  /** The real object this node stands for (shown as context, never created again). */
  existingId: string | null;
  /** Key of the node it sits under, or null at the top. */
  parent: string | null;
  checked: boolean;
  category?: string;
  description?: string;
  due?: string;
  text?: string;
}

export interface Proposal {
  nodes: PNode[];
  /** Tasks left out because the project already has them. */
  skipped: number;
}

/** The project that takes what the model could not place. */
export const UNSORTED = "À classer";

const CONTAINERS: NodeKind[] = ["plan", "project", "sub"];
const isContainer = (k: NodeKind) => CONTAINERS.includes(k);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function matchByName<T extends { name: string }>(items: readonly T[], ref: string): T | undefined {
  const q = norm(ref).trim();
  if (!q) return undefined;
  const exact = items.find((i) => norm(i.name).trim() === q);
  if (exact) return exact;
  if (q.length < 3) return undefined;
  // « Atlas » for « Atlas OS » (or the opposite): accepted only when a single one fits.
  const near = items.filter((i) => {
    const n = norm(i.name).trim();
    return n.includes(q) || (n.length >= 3 && q.includes(n));
  });
  return near.length === 1 ? near[0] : undefined;
}

/** Infinitives that do not end in -er or -ir, as a first word they announce an action. */
const VERBS_RE = new Set(
  (
    "faire refaire defaire mettre remettre soumettre transmettre permettre prendre reprendre " +
    "apprendre comprendre ecrire reecrire decrire inscrire lire relire construire reconstruire " +
    "produire reduire traduire conduire introduire rendre vendre repondre attendre etendre " +
    "joindre rejoindre peindre repeindre suivre poursuivre resoudre dire redire voir revoir " +
    "prevoir recevoir concevoir boire croire connaitre reconnaitre"
  ).split(" "),
);
/** Nouns that end like an infinitive (« Atelier », « Player »): never read as an action. */
const NOUNS_ER_IR = new Set(
  (
    "atelier calendrier papier dossier courrier chantier cahier clavier premier dernier escalier " +
    "quartier metier fichier panier mobilier immobilier foyer loyer diner dejeuner gouter souper " +
    "hiver danger verger potager plancher rocher grenier evier pilier sentier tablier financier " +
    "particulier loisir avenir souvenir plaisir desir tir elixir cuir pouvoir devoir savoir " +
    "player multiplayer server manager user layer shader trailer teaser launcher spawner timer " +
    "banner footer header router controller scanner printer computer cluster poster master " +
    "partner designer developer leader builder helper loader parser renderer browser"
  ).split(" "),
);

/**
 * A name that reads as an action to tick off (« Dessiner le terrain ») rather than as a group of
 * work (« Gestion de la map »): its first word is an infinitive.
 */
export function looksLikeTask(name: string): boolean {
  const first = norm(name)
    .trim()
    .split(/[^a-z]+/)[0];
  if (!first || first.length < 4 || NOUNS_ER_IR.has(first)) return false;
  return VERBS_RE.has(first) || /(er|ir)$/.test(first);
}

/**
 * Turns validated actions into a proposal. Existing projects are only ever reached through a real
 * alias, id or name; anything else becomes a creation. A project, sub-project or plan with the
 * name of an existing one is that one. An existing project named inside a new plan is attached to it.
 *
 * With a `scope` (the element the assistant was opened from) `ws` is that element's own workspace
 * (`scopeWorkspace`) and nothing ever lands outside it: no plan and no project is made, a project
 * the model names becomes a sub-project of the context, and a place that is not inside the
 * context is the context itself. From a task, everything to do becomes a sub-task.
 */
export function buildProposal(
  actions: readonly AssistantAction[],
  ws: Workspace,
  scope: AssistantScope | null = null,
): Proposal {
  const nodes: PNode[] = [];
  let skipped = 0;
  let seq = 0;
  const key = () => `n${++seq}`;
  const existingNodes = new Map<string, PNode>(); // real id → node
  const aliasOf = new Map<string, WsItem & { kind: "plan" | "project" | "sub" }>();
  for (const it of ws.byId.values()) aliasOf.set(it.alias.toLowerCase(), it);

  const existing = (it: WsItem & { kind: "plan" | "project" | "sub" }): PNode => {
    let n = existingNodes.get(it.id);
    if (!n) {
      n = {
        key: key(),
        kind: it.kind,
        title: it.name,
        existingId: it.id,
        parent: null,
        checked: true,
      };
      existingNodes.set(it.id, n);
      nodes.push(n);
      // Inside a context the tree is drawn from the context down: each element under its parent.
      const above = scope && it.id !== scope.id && it.parentId ? ws.byId.get(it.parentId) : null;
      if (above) n.parent = existing(above).key;
    }
    return n;
  };

  /** The node of the active context: everything made in this proposal hangs below it. */
  let root: PNode | null = null;
  if (scope) {
    const it = ws.byId.get(scope.id);
    if (it) root = existing(it);
    else {
      root = {
        key: key(),
        kind: scope.kind,
        title: scope.name,
        existingId: scope.id,
        parent: null,
        checked: true,
      };
      existingNodes.set(scope.id, root);
      nodes.push(root);
    }
  }
  const scopeNames = new Set(scope ? scope.trail.map((n) => norm(n).trim()) : []);

  /** Names some action puts things into: a sub-project with one of these names is a real group. */
  const filled = new Set<string>();
  for (const a of actions)
    if (a.type !== "create_plan" && a.type !== "create_project" && a.project)
      filled.add(norm(a.project).trim());

  /** An action as it applies here: brought back inside the context, sub-projects that are tasks demoted. */
  const settle = (a: AssistantAction): AssistantAction | null => {
    if (scope) {
      if (a.type === "create_plan") return null;
      // The context (or what it sits in) named again is not something to create.
      if (
        (a.type === "create_project" || a.type === "create_subproject") &&
        scopeNames.has(norm(a.name).trim())
      )
        return null;
      if (a.type === "create_project")
        a = { type: "create_subproject", name: a.name, project: SCOPE_REF, category: a.category };
      if (scope.kind === "task") {
        if (a.type === "create_subproject")
          return { type: "add_task", title: a.name, project: SCOPE_REF };
        if (a.type === "add_deadline")
          return { type: "add_task", title: a.title, project: SCOPE_REF, due: a.date };
      }
    }
    if (a.type === "create_subproject" && looksLikeTask(a.name) && !filled.has(norm(a.name).trim()))
      return { type: "add_task", title: a.name, project: a.project, category: a.category };
    return a;
  };
  const settled = actions.map(settle).filter((a): a is AssistantAction => a !== null);
  const created = (kind: NodeKind, title: string) =>
    nodes.find((n) => n.existingId === null && n.kind === kind && norm(n.title) === norm(title));

  /** A plan, project or sub-project by alias, then real name; created plans/projects first. */
  const find = (ref: string, kinds: NodeKind[]): PNode | null => {
    const byAlias = aliasOf.get(ref.trim().toLowerCase());
    if (byAlias && kinds.includes(byAlias.kind)) return existing(byAlias);
    for (const k of kinds) {
      const c = created(k, ref);
      if (c) return c;
    }
    const pool = [
      ...(kinds.includes("plan") ? ws.plans.map((p) => ({ ...p, kind: "plan" as const })) : []),
      ...(kinds.includes("project")
        ? ws.projects.map((p) => ({ ...p, kind: "project" as const }))
        : []),
      ...(kinds.includes("sub") ? ws.subs.map((p) => ({ ...p, kind: "sub" as const })) : []),
    ];
    const hit = matchByName(pool, ref);
    return hit ? existing(hit) : null;
  };

  const ensureProject = (
    given: string | undefined,
    kinds: NodeKind[] = ["project", "sub"],
  ): PNode => {
    let ref = given?.trim() || UNSORTED;
    if (root && scope) {
      // Inside a context: the context itself, something it holds, or something made here. Never elsewhere.
      if (!given?.trim() || ref.toLowerCase() === SCOPE_REF || scope.kind === "task") return root;
      if (norm(ref).trim() === norm(scope.name).trim()) return root;
      return find(ref, kinds) ?? root;
    }
    // An identifier that does not exist (« pr0 ») is never a name: those go to « À classer ».
    if (/^(pl|pr|sp)\d+$/i.test(ref.trim()) && !aliasOf.has(ref.trim().toLowerCase()))
      ref = UNSORTED;
    const found = find(ref, kinds);
    if (found) return found;
    const n: PNode = {
      key: key(),
      kind: "project",
      title: cap(ref.trim()),
      existingId: null,
      parent: null,
      checked: true,
    };
    nodes.push(n);
    return n;
  };

  const ordered = [
    ...settled.filter((a) => a.type === "create_plan"),
    ...settled.filter((a) => a.type === "create_project"),
    ...settled.filter((a) => a.type === "create_subproject"),
    ...settled.filter(
      (a) =>
        a.type !== "create_plan" && a.type !== "create_project" && a.type !== "create_subproject",
    ),
  ];

  for (const a of ordered) {
    if (a.type === "create_plan") {
      if (find(a.name, ["plan"])) continue;
      nodes.push({
        key: key(),
        kind: "plan",
        title: cap(a.name),
        existingId: null,
        parent: null,
        checked: true,
        description: a.description,
      });
    } else if (a.type === "create_project") {
      const plan = a.plan ? (find(a.plan, ["plan"]) ?? null) : null;
      const planNode =
        plan ??
        (a.plan
          ? (() => {
              const n: PNode = {
                key: key(),
                kind: "plan",
                title: cap(a.plan),
                existingId: null,
                parent: null,
                checked: true,
              };
              nodes.push(n);
              return n;
            })()
          : null);
      const hit = find(a.name, ["project"]);
      if (hit) {
        // Already there: attach it to the plan when it has none yet, otherwise leave it alone.
        const real = hit.existingId ? ws.byId.get(hit.existingId) : null;
        if (planNode && hit.parent === null && real && real.parentId === null)
          hit.parent = planNode.key;
        continue;
      }
      nodes.push({
        key: key(),
        kind: "project",
        title: cap(a.name),
        existingId: null,
        parent: planNode?.key ?? null,
        checked: true,
        category: a.category,
        description: a.description,
      });
    } else if (a.type === "create_subproject") {
      const parent = ensureProject(a.project);
      const dupe = nodes.find(
        (n) => n.kind === "sub" && n.parent === parent.key && norm(n.title) === norm(a.name),
      );
      const real = parent.existingId
        ? [...ws.subs].find(
            (s) => s.parentId === parent.existingId && norm(s.name) === norm(a.name),
          )
        : undefined;
      if (dupe || real) {
        if (real) existing({ ...real, kind: "sub" }).parent = parent.key;
        continue;
      }
      nodes.push({
        key: key(),
        kind: "sub",
        title: cap(a.name),
        existingId: null,
        parent: parent.key,
        checked: true,
        category: a.category,
      });
    } else {
      const parent = ensureProject(a.project);
      const title = cap(a.title);
      const had = !parent.existingId
        ? undefined
        : scope && parent.existingId === scope.id
          ? scope.tasks
          : ws.byId.get(parent.existingId)?.tasks;
      const same = nodes.some(
        (n) =>
          n.parent === parent.key &&
          n.kind !== "plan" &&
          norm(n.title) === norm(title) &&
          n.existingId === null,
      );
      if (a.type === "add_task" && (same || had?.has(norm(title)))) {
        skipped++;
        continue;
      }
      if (same) continue;
      if (a.type === "add_task")
        nodes.push({
          key: key(),
          kind: "task",
          title,
          existingId: null,
          parent: parent.key,
          checked: true,
          due: a.due,
          category: a.category,
        });
      else if (a.type === "add_note")
        nodes.push({
          key: key(),
          kind: "note",
          title,
          existingId: null,
          parent: parent.key,
          checked: true,
          text: a.text,
        });
      else
        nodes.push({
          key: key(),
          kind: "deadline",
          title,
          existingId: null,
          parent: parent.key,
          checked: true,
          due: a.date,
        });
    }
  }
  return prune({ nodes, skipped });
}

/** Existing containers that end up with nothing to do are not shown. */
export function prune(p: Proposal): Proposal {
  const used = new Set<string>();
  for (const n of p.nodes)
    if (n.existingId === null || n.parent !== null) {
      used.add(n.key);
      for (let up = n.parent; up;) {
        used.add(up);
        up = p.nodes.find((x) => x.key === up)?.parent ?? null;
      }
    }
  return { ...p, nodes: p.nodes.filter((n) => used.has(n.key) || n.existingId === null) };
}

// ── Editing the proposal ─────────────────────────────────────────────────────────────────────

export const childrenOf = (p: Proposal, key: string | null) =>
  p.nodes.filter((n) => n.parent === key);

function descendants(p: Proposal, key: string): Set<string> {
  const out = new Set<string>();
  const walk = (k: string) => {
    for (const c of childrenOf(p, k)) {
      out.add(c.key);
      walk(c.key);
    }
  };
  walk(key);
  return out;
}

/** A node counts when it and all its ancestors are ticked. */
export function isActive(p: Proposal, n: PNode): boolean {
  for (
    let cur: PNode | undefined = n;
    cur;
    cur = cur.parent ? p.nodes.find((x) => x.key === cur?.parent) : undefined
  )
    if (!cur.checked) return false;
  return true;
}

/**
 * An existing project hanging under a plan in the proposal is a "move into the plan". Anything
 * else that exists and is drawn under its parent (a sub-project in its project) is only context.
 */
export const isAttach = (n: PNode, p: Proposal) =>
  n.existingId !== null &&
  n.kind === "project" &&
  n.parent !== null &&
  p.nodes.some((x) => x.key === n.parent && x.kind === "plan");

export interface Counts {
  /** Objects that will be created. */
  create: number;
  /** Existing projects that will be put into a plan. */
  attach: number;
  byKind: Record<NodeKind, number>;
}

export function countProposal(p: Proposal): Counts {
  const byKind: Counts["byKind"] = { plan: 0, project: 0, sub: 0, task: 0, note: 0, deadline: 0 };
  let create = 0;
  let attach = 0;
  for (const n of p.nodes) {
    if (!isActive(p, n)) continue;
    if (n.existingId === null) {
      create++;
      byKind[n.kind]++;
    } else if (isAttach(n, p)) attach++;
  }
  return { create, attach, byKind };
}

export const setTitle = (p: Proposal, key: string, title: string): Proposal => ({
  ...p,
  nodes: p.nodes.map((n) => (n.key === key && title.trim() ? { ...n, title: title.trim() } : n)),
});

export const setChecked = (p: Proposal, key: string, checked: boolean): Proposal => ({
  ...p,
  nodes: p.nodes.map((n) => (n.key === key ? { ...n, checked } : n)),
});

/** Where a node may be moved: the containers of the right kind, never itself or what it holds. */
export function parentChoices(p: Proposal, n: PNode): PNode[] {
  if (n.kind === "plan") return [];
  const below = descendants(p, n.key);
  const allowed: NodeKind[] = n.kind === "project" ? ["plan"] : ["project", "sub"];
  // A sub-task (or a note) may also stay in the real task the assistant was opened from.
  const inTask = (c: PNode) =>
    c.kind === "task" && c.existingId !== null && (n.kind === "task" || n.kind === "note");
  return p.nodes.filter(
    (c) => c.key !== n.key && !below.has(c.key) && (allowed.includes(c.kind) || inTask(c)),
  );
}

/**
 * Whether a new element may be turned from a sub-project into a task or back: a sub-project that
 * holds nothing yet, or a task that sits in a project or a sub-project.
 */
export function canSwitchKind(p: Proposal, n: PNode): boolean {
  if (n.existingId !== null) return false;
  if (n.kind === "sub") return childrenOf(p, n.key).length === 0;
  if (n.kind !== "task") return false;
  const parent = p.nodes.find((x) => x.key === n.parent);
  return !!parent && (parent.kind === "project" || parent.kind === "sub");
}

/** Sub-project ↔ task, when `canSwitchKind` allows it. */
export function switchKind(p: Proposal, key: string): Proposal {
  const n = p.nodes.find((x) => x.key === key);
  if (!n || !canSwitchKind(p, n)) return p;
  const next: PNode =
    n.kind === "sub"
      ? { ...n, kind: "task", category: undefined }
      : { ...n, kind: "sub", due: undefined, category: undefined };
  return { ...p, nodes: p.nodes.map((x) => (x.key === key ? next : x)) };
}

export function moveNode(p: Proposal, key: string, parent: string | null): Proposal {
  const n = p.nodes.find((x) => x.key === key);
  if (!n) return p;
  if (parent !== null && !parentChoices(p, n).some((c) => c.key === parent)) return p;
  if (parent === null && n.kind !== "project" && n.kind !== "plan") return p;
  return { ...p, nodes: p.nodes.map((x) => (x.key === key ? { ...x, parent } : x)) };
}

/** Adds a real container to the proposal so a node can be moved into it. */
export function withExisting(
  p: Proposal,
  ws: Workspace,
  id: string,
): { proposal: Proposal; key: string } | null {
  const have = p.nodes.find((n) => n.existingId === id);
  if (have) return { proposal: p, key: have.key };
  const it = ws.byId.get(id);
  if (!it) return null;
  const k = `e${p.nodes.length + 1}-${it.alias}`;
  const node: PNode = {
    key: k,
    kind: it.kind,
    title: it.name,
    existingId: it.id,
    parent: null,
    checked: true,
  };
  return { proposal: { ...p, nodes: [...p.nodes, node] }, key: k };
}

// ── Applying ─────────────────────────────────────────────────────────────────────────────────

export type Step =
  | { op: "create"; node: PNode; parentKey: string | null }
  | { op: "attach"; node: PNode; parentKey: string };

/** The writes to make, parents before children. */
export function stepsOf(p: Proposal): Step[] {
  const depth = (n: PNode): number =>
    n.parent ? 1 + depth(p.nodes.find((x) => x.key === n.parent) ?? { ...n, parent: null }) : 0;
  return p.nodes
    .filter((n) => isActive(p, n))
    .sort((a, b) => depth(a) - depth(b))
    .flatMap<Step>((n) => {
      if (n.existingId === null) return [{ op: "create", node: n, parentKey: n.parent }];
      if (isAttach(n, p) && n.parent) return [{ op: "attach", node: n, parentKey: n.parent }];
      return [];
    });
}

export const isContainerKind = isContainer;
