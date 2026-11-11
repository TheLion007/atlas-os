import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import {
  buildProposal,
  canSwitchKind,
  countProposal,
  describeScope,
  looksLikeTask,
  parentChoices,
  parseActions,
  resolveScope,
  scopeWorkspace,
  stepsOf,
  switchKind,
  systemPrompt,
  type AssistantAction,
  type AssistantScope,
  type PNode,
  type Proposal,
} from "./assistant-plan";
import { runAssistant, type Ask } from "./assistant-run";
import { assistantContext } from "./ollama";
import { triage, triageInScope } from "./triage";

const obj = (id: string, type: ApiObject["type"], title: string, status = "active"): ApiObject => ({
  id,
  type,
  title,
  status: status as ApiObject["status"],
  tags: [],
  confidence: null,
  color: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
const edge = (from: string, to: string): ApiEdge => ({
  id: `${from}-${to}`,
  kind: "contains",
  from,
  to,
  label: null,
  dependencyType: null,
  lagDays: null,
  createdAt: "2026-01-01T00:00:00Z",
});

// Plan « Jeux » › project « Jeu Roblox » › sub-project « Map » › task « Dessiner le terrain »,
// next to an unrelated project « Site web » that has its own « Design » and « Map ».
const NODES = [
  obj("pl", "plan", "Jeux"),
  obj("rob", "project", "Jeu Roblox"),
  obj("map", "sub_project", "Map"),
  obj("ui", "sub_project", "Interface"),
  obj("t-terrain", "task", "Dessiner le terrain"),
  obj("t-croquis", "task", "Faire un croquis"),
  obj("t-saut", "task", "Corriger le bug du saut"),
  obj("web", "project", "Site web"),
  obj("web-design", "sub_project", "Design"),
  obj("web-map", "sub_project", "Plan du site"),
  obj("loc", "location", "Lausanne"),
];
const EDGES = [
  edge("pl", "rob"),
  edge("rob", "map"),
  edge("rob", "ui"),
  edge("rob", "t-saut"),
  edge("map", "t-terrain"),
  edge("t-terrain", "t-croquis"),
  edge("web", "web-design"),
  edge("web", "web-map"),
];

const scopeOf = (id: string): AssistantScope => resolveScope(id, NODES, EDGES)!;
const propose = (id: string, actions: AssistantAction[]): Proposal => {
  const scope = scopeOf(id);
  return buildProposal(actions, scopeWorkspace(scope, NODES, EDGES), scope);
};
const made = (p: Proposal) => p.nodes.filter((n) => n.existingId === null);
const parentTitle = (p: Proposal, n: PNode) => p.nodes.find((x) => x.key === n.parent)?.title;

describe("the context the assistant is opened from", () => {
  it("knows the element, its kind, its parent and the path down to it", () => {
    expect(scopeOf("rob")).toMatchObject({
      id: "rob",
      name: "Jeu Roblox",
      kind: "project",
      parent: { id: "pl", kind: "plan" },
      trail: ["Jeu Roblox"],
    });
    expect(scopeOf("map")).toMatchObject({
      kind: "sub",
      parent: { id: "rob", name: "Jeu Roblox", kind: "project" },
      trail: ["Jeu Roblox", "Map"],
    });
    const task = scopeOf("t-terrain");
    expect(task).toMatchObject({ kind: "task", parent: { id: "map", kind: "sub" } });
    expect(task.trail).toEqual(["Jeu Roblox", "Map", "Dessiner le terrain"]);
    expect([...task.tasks]).toEqual(["faire un croquis"]);
  });

  it("gives no context outside a project, a sub-project or a task", () => {
    expect(resolveScope(null, NODES, EDGES)).toBeNull();
    expect(resolveScope("nope", NODES, EDGES)).toBeNull();
    expect(resolveScope("pl", NODES, EDGES)).toBeNull();
    expect(resolveScope("loc", NODES, EDGES)).toBeNull();
    expect(resolveScope("x", [obj("x", "project", "Abandonné", "dropped")], [])).toBeNull();
  });

  it("only shows the model what the context holds", () => {
    const scope = scopeOf("rob");
    const ws = scopeWorkspace(scope, NODES, EDGES);
    expect(ws.projects.map((p) => p.name)).toEqual(["Jeu Roblox"]);
    expect(ws.subs.map((s) => s.name).sort()).toEqual(["Interface", "Map"]);
    const told = describeScope(ws, scope, "2026-11-11");
    expect(told).toMatch(
      /CONTEXTE ACTIF \(id : ctx\) : le projet « Jeu Roblox », dans le plan « Jeux »/,
    );
    expect(told).toContain("Map");
    expect(told).not.toContain("Site web");
    expect(told).not.toContain("Design");
  });

  it("gives the model the instructions of the level it is opened at", () => {
    expect(systemPrompt(scopeOf("rob"))).toContain("create_subproject");
    expect(systemPrompt(scopeOf("rob"))).not.toContain("create_project");
    expect(systemPrompt(scopeOf("t-terrain"))).toContain("sous-tâche");
    expect(systemPrompt(scopeOf("t-terrain"))).not.toContain('"type":"create_subproject"');
    expect(systemPrompt(null)).toContain("create_project");
  });
});

describe("a proposal made inside a context", () => {
  it("adds « la gestion de la map » to the open project, without asking which one", () => {
    const p = propose("rob", [
      { type: "create_subproject", name: "Gestion de la map", project: "ctx" },
      { type: "add_task", title: "Dessiner le relief", project: "Gestion de la map" },
      { type: "add_task", title: "Tester le saut" },
    ]);
    const sub = made(p).find((n) => n.kind === "sub")!;
    expect(sub.title).toBe("Gestion de la map");
    expect(parentTitle(p, sub)).toBe("Jeu Roblox");
    expect(
      parentTitle(
        p,
        made(p).find((n) => n.title === "Dessiner le relief")!,
      ),
    ).toBe("Gestion de la map");
    expect(
      parentTitle(
        p,
        made(p).find((n) => n.title === "Tester le saut")!,
      ),
    ).toBe("Jeu Roblox");
    expect(countProposal(p)).toMatchObject({ create: 3, attach: 0 });
    // The context is the real project: it is never created again.
    expect(p.nodes.filter((n) => n.kind === "project")).toHaveLength(1);
    expect(p.nodes.find((n) => n.kind === "project")?.existingId).toBe("rob");
  });

  it("never makes a plan, a project or a double of the context", () => {
    const p = propose("rob", [
      { type: "create_plan", name: "Jeux vidéo" },
      { type: "create_project", name: "Jeu Roblox" },
      { type: "create_project", name: "Boutique" },
      { type: "add_task", title: "Fixer les prix", project: "Boutique" },
    ]);
    expect(made(p).map((n) => [n.kind, n.title])).toEqual([
      ["sub", "Boutique"],
      ["task", "Fixer les prix"],
    ]);
    expect(parentTitle(p, made(p)[0]!)).toBe("Jeu Roblox");
    expect(stepsOf(p).every((s) => s.op === "create")).toBe(true);
  });

  it("never reaches outside: another project's name or id falls back on the context", () => {
    const p = propose("rob", [
      { type: "add_task", title: "Refaire le menu", project: "Site web" },
      { type: "add_task", title: "Choisir les couleurs", project: "Design" },
      { type: "add_task", title: "Ranger les fichiers", project: "pr7" },
    ]);
    expect(made(p)).toHaveLength(3);
    for (const n of made(p)) expect(parentTitle(p, n)).toBe("Jeu Roblox");
    expect(p.nodes.some((n) => n.existingId === "web" || n.existingId === "web-design")).toBe(
      false,
    );
    expect(p.nodes.some((n) => n.title === "À classer")).toBe(false);
  });

  it("reuses what the context already holds, drawn under it", () => {
    const p = propose("rob", [
      { type: "create_subproject", name: "map", project: "ctx" },
      { type: "add_task", title: "Placer les spawns", project: "Map" },
      { type: "add_task", title: "corriger le bug du saut", project: "ctx" },
    ]);
    expect(made(p).map((n) => n.title)).toEqual(["Placer les spawns"]);
    expect(p.skipped).toBe(1);
    const map = p.nodes.find((n) => n.existingId === "map")!;
    expect(parentTitle(p, map)).toBe("Jeu Roblox");
    expect(countProposal(p).attach).toBe(0);
  });

  it("from a sub-project, makes tasks and sub-sub-projects inside it", () => {
    const p = propose("map", [
      { type: "create_subproject", name: "Décors", project: "ctx" },
      { type: "create_project", name: "Éclairage" },
      { type: "add_task", title: "Placer les arbres", project: "Décors" },
      { type: "add_task", title: "Dessiner le terrain", project: "ctx" },
    ]);
    const subs = made(p).filter((n) => n.kind === "sub");
    expect(subs.map((n) => n.title)).toEqual(["Décors", "Éclairage"]);
    for (const s of subs) expect(parentTitle(p, s)).toBe("Map");
    expect(p.skipped).toBe(1); // « Dessiner le terrain » is already in Map
    expect(p.nodes.find((n) => n.existingId === "map")?.kind).toBe("sub");
  });

  it("from a task, everything to do becomes a sub-task of it", () => {
    const p = propose("t-terrain", [
      { type: "add_task", title: "Sculpter les collines", project: "ctx" },
      { type: "create_subproject", name: "Textures", project: "ctx" },
      { type: "add_deadline", title: "Montrer le terrain", date: "2026-12-01", project: "Map" },
      { type: "add_task", title: "faire un croquis", project: "ctx" },
      { type: "add_note", title: "Références", text: "Voir les captures", project: "ctx" },
    ]);
    const root = p.nodes.find((n) => n.existingId === "t-terrain")!;
    expect(root.kind).toBe("task");
    expect(made(p).map((n) => [n.kind, n.title])).toEqual([
      ["task", "Sculpter les collines"],
      ["task", "Textures"],
      ["task", "Montrer le terrain"],
      ["note", "Références"],
    ]);
    for (const n of made(p)) expect(n.parent).toBe(root.key);
    expect(made(p).find((n) => n.title === "Montrer le terrain")?.due).toBe("2026-12-01");
    expect(p.skipped).toBe(1);
    // A sub-task can stay in its task, and nowhere else.
    expect(parentChoices(p, made(p)[0]!).map((c) => c.key)).toEqual([root.key]);
  });
});

describe("telling a sub-project from a task", () => {
  it("reads an infinitive as an action, a noun group as a group of work", () => {
    for (const s of ["Dessiner le terrain", "Finir le design", "Écrire la doc", "Faire un croquis"])
      expect(looksLikeTask(s), s).toBe(true);
    for (const s of ["Gestion de la map", "Design", "Atelier bois", "Player controller", "Avenir"])
      expect(looksLikeTask(s), s).toBe(false);
  });

  it("turns a sub-project that is really one action into a task", () => {
    const p = propose("rob", [
      { type: "create_subproject", name: "Dessiner le terrain", project: "ctx" },
      { type: "create_subproject", name: "Gestion de la map", project: "ctx" },
    ]);
    expect(made(p).map((n) => [n.kind, n.title])).toEqual([
      ["sub", "Gestion de la map"],
      ["task", "Dessiner le terrain"],
    ]);
  });

  it("keeps a sub-project that other actions fill, whatever its name", () => {
    const p = propose("rob", [
      { type: "create_subproject", name: "Tester le jeu", project: "ctx" },
      { type: "add_task", title: "Inviter trois amis", project: "Tester le jeu" },
    ]);
    expect(made(p).map((n) => n.kind)).toEqual(["sub", "task"]);
  });

  it("lets the person switch a new element between sub-project and task", () => {
    let p = propose("rob", [
      { type: "create_subproject", name: "Boutique", project: "ctx" },
      { type: "create_subproject", name: "Sons", project: "ctx" },
      { type: "add_task", title: "Fixer les prix", project: "Boutique" },
    ]);
    const shop = made(p).find((n) => n.title === "Boutique")!;
    const sounds = made(p).find((n) => n.title === "Sons")!;
    expect(canSwitchKind(p, shop)).toBe(false); // it holds a task
    expect(canSwitchKind(p, sounds)).toBe(true);
    p = switchKind(p, sounds.key);
    expect(p.nodes.find((n) => n.key === sounds.key)?.kind).toBe("task");
    p = switchKind(p, sounds.key);
    expect(p.nodes.find((n) => n.key === sounds.key)?.kind).toBe("sub");
    expect(switchKind(p, shop.key)).toBe(p);
  });
});

describe("outside any context, nothing changes", () => {
  it("still requires a project on every action", () => {
    const loose = '{"actions":[{"type":"add_task","title":"Appeler Dumont"}]}';
    expect(parseActions(loose)).toMatchObject({ ok: false });
    expect(parseActions(loose, true)).toMatchObject({ ok: true });
  });
});

describe("a run inside a context", () => {
  it("tells the model the context and brings its answer back inside", async () => {
    const seen: { system: string; user: string }[] = [];
    const ask: Ask = async (messages) => {
      seen.push({ system: messages[0]?.content ?? "", user: messages[1]?.content ?? "" });
      return {
        ok: true,
        answer: JSON.stringify({
          actions: [{ type: "create_project", name: "Gestion de la map" }],
        }),
      };
    };
    const scope = scopeOf("rob");
    const r = await runAssistant({
      text: "ajoute la gestion de la map",
      workspace: scopeWorkspace(scope, NODES, EDGES),
      scope,
      today: "2026-11-11",
      ask,
    });
    expect(seen[0]?.system).toContain("contexte actif");
    expect(seen[0]?.user).toContain("« Jeu Roblox »");
    expect(seen[0]?.user).not.toContain("Site web");
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(made(r.proposal).map((n) => [n.kind, n.title])).toEqual([
        ["sub", "Gestion de la map"],
      ]);
  });
});

describe("the rest of the assistant inside a context", () => {
  it("answers questions from the element only", () => {
    const told = assistantContext(NODES, EDGES, "2026-11-11", scopeOf("map"));
    expect(told).toContain("le sous-projet « Map », dans le projet « Jeu Roblox »");
    expect(told).toContain("Dessiner le terrain");
    expect(told).not.toContain("Corriger le bug du saut");
    expect(told).not.toContain("Site web");
  });

  it("sorts ideas into the element when no model is connected", () => {
    const groups = triage("appeler Dumont\nProjet : Boutique\nfixer les prix", []);
    const inProject = triageInScope(groups, { id: "rob", name: "Jeu Roblox", kind: "project" });
    expect(inProject.every((g) => g.kind === "existing" || g.kind === "new-sub")).toBe(true);
    expect(inProject.some((g) => g.kind === "existing" && g.projectId === "rob")).toBe(true);
    const inTask = triageInScope(groups, { id: "t", name: "Dessiner", kind: "task" });
    expect(inTask).toHaveLength(1);
    expect(inTask[0]).toMatchObject({ kind: "existing", projectId: "t" });
  });
});
