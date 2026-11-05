import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import {
  buildProposal,
  buildWorkspace,
  chunkText,
  countProposal,
  moveNode,
  parseActions,
  setChecked,
  setTitle,
  stepsOf,
  withExisting,
  type Workspace,
} from "./assistant-plan";
import { runAssistant, type Ask } from "./assistant-run";

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

const world = (): Workspace =>
  buildWorkspace(
    [
      obj("a", "project", "Atlas OS"),
      obj("n", "project", "Nimbus"),
      obj("t1", "task", "Appeler Dumont"),
      obj("s1", "sub_project", "Design"),
    ],
    [edge("a", "s1"), edge("n", "t1")],
  );

describe("strict validation of the model's answer", () => {
  it("accepts a clean answer, a fenced one and a bare array", () => {
    const a = '{"actions":[{"type":"create_plan","name":"NIRYS"}]}';
    expect(parseActions(a)).toMatchObject({ ok: true });
    expect(parseActions("```json\n" + a + "\n```")).toMatchObject({ ok: true });
    expect(parseActions('Voici : [{"type":"create_plan","name":"X"}] voilà')).toMatchObject({
      ok: true,
    });
  });
  it("turns nulls and empty strings into absent fields", () => {
    const r = parseActions(
      '{"actions":[{"type":"add_task","title":"a","project":"b","due":null,"category":""}]}',
    );
    expect(r).toMatchObject({ ok: true, actions: [{ type: "add_task", title: "a" }] });
  });
  it("refuses unknown types, missing fields and invented dates, with a reason", () => {
    expect(parseActions('{"actions":[{"type":"explode"}]}')).toMatchObject({ ok: false });
    expect(parseActions('{"actions":[{"type":"add_task","title":"a"}]}')).toMatchObject({
      ok: false,
    });
    const bad = parseActions(
      '{"actions":[{"type":"add_deadline","title":"a","project":"b","date":"demain"}]}',
    );
    expect(bad.ok).toBe(false);
    expect(parseActions("pas du json")).toEqual({ ok: false, reason: expect.any(String) });
  });
});

describe("the proposal", () => {
  it("never trusts an identifier: an unknown project becomes a creation", () => {
    const p = buildProposal(
      [{ type: "add_task", title: "finir le design", project: "pr99" }],
      world(),
    );
    const project = p.nodes.find((n) => n.kind === "project");
    expect(project).toMatchObject({ existingId: null, title: "À classer" });
    expect(countProposal(p).create).toBe(2);
  });

  it("reuses an existing project by alias, exact name or a single near name", () => {
    const ws = world();
    const p = buildProposal(
      [
        { type: "add_task", title: "Finir le graphe", project: "pr1" },
        { type: "add_task", title: "Test", project: "atlas os" },
        { type: "add_task", title: "Autre", project: "Atlas" },
      ],
      ws,
    );
    expect(p.nodes.filter((n) => n.kind === "project")).toHaveLength(1);
    expect(p.nodes.find((n) => n.kind === "project")?.existingId).toBe("a");
    expect(countProposal(p).create).toBe(3);
  });

  it("does not duplicate a project, a sub-project or an open task that exists", () => {
    const p = buildProposal(
      [
        { type: "create_project", name: "nimbus" },
        { type: "create_subproject", name: "Design", project: "Atlas OS" },
        { type: "add_task", title: "appeler dumont", project: "Nimbus" },
      ],
      world(),
    );
    expect(countProposal(p).create).toBe(0);
    expect(p.skipped).toBe(1);
  });

  it("builds the NIRYS plan: new plan, mixed new and existing projects, sub-projects", () => {
    const p = buildProposal(
      [
        { type: "create_plan", name: "NIRYS" },
        { type: "create_project", name: "Atlas OS", plan: "NIRYS" },
        { type: "create_project", name: "Nova Audio", plan: "NIRYS", category: "Audio" },
        { type: "create_project", name: "Nimbus", plan: "NIRYS" },
        { type: "create_subproject", name: "Déploiement", project: "Atlas" },
        { type: "create_subproject", name: "Promotion", project: "Atlas" },
      ],
      world(),
    );
    const c = countProposal(p);
    expect(c.byKind).toMatchObject({ plan: 1, project: 1, sub: 2 });
    expect(c.attach).toBe(2); // Atlas OS and Nimbus move into the new plan
    const steps = stepsOf(p);
    expect(steps[0]).toMatchObject({ op: "create", node: { kind: "plan" } });
    expect(steps.filter((s) => s.op === "attach")).toHaveLength(2);
  });

  it("lets the person untick, rename and move before anything is made", () => {
    let p = buildProposal(
      [
        { type: "create_project", name: "Cuisine" },
        { type: "create_project", name: "Jardin" },
        { type: "add_task", title: "Acheter peinture", project: "Cuisine" },
      ],
      world(),
    );
    const task = p.nodes.find((n) => n.kind === "task")!;
    const garden = p.nodes.find((n) => n.title === "Jardin")!;
    p = moveNode(p, task.key, garden.key);
    expect(p.nodes.find((n) => n.key === task.key)?.parent).toBe(garden.key);
    p = setTitle(p, task.key, "Acheter de la peinture");
    p = setChecked(p, garden.key, false);
    expect(countProposal(p).create).toBe(1); // only Cuisine: Jardin and its task are off
    const ws = world();
    const moved = withExisting(p, ws, "a")!;
    p = moveNode(moved.proposal, task.key, moved.key);
    expect(stepsOf(p).some((s) => s.node.key === task.key)).toBe(true);
    // A task can't become a child of a task, nor a project of a sub-project.
    expect(moveNode(p, garden.key, task.key)).toEqual(p);
  });
});

describe("cutting a long text", () => {
  it("keeps short text whole and cuts long text between paragraphs", () => {
    expect(chunkText("a\nb\nc")).toEqual(["a\nb\nc"]);
    const para = "x".repeat(800);
    const parts = chunkText(`${para}\n\n${para}\n\n${para}`, 1_800);
    expect(parts).toHaveLength(2);
    expect(parts.every((x) => x.length <= 1_800)).toBe(true);
  });
  it("cuts a single huge paragraph at sentences", () => {
    const parts = chunkText("Une phrase. ".repeat(400), 500);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.every((x) => x.length <= 500)).toBe(true);
  });
});

describe("a run against a stand-in for Ollama", () => {
  const good = JSON.stringify({ actions: [{ type: "create_plan", name: "NIRYS" }] });

  it("asks once more, with the reason, when the answer is invalid", async () => {
    const seen: string[] = [];
    const ask: Ask = async (messages) => {
      seen.push(messages.at(-1)?.content ?? "");
      return { ok: true, answer: seen.length === 1 ? "oups" : good };
    };
    const r = await runAssistant({
      text: "plan NIRYS",
      workspace: world(),
      today: "2026-11-05",
      ask,
    });
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatch(/invalide/);
    if (r.ok) expect(r.retries).toBe(1);
  });

  it("gives up with 'weak' after a second invalid answer", async () => {
    const ask: Ask = async () => ({ ok: true, answer: "{}" });
    const r = await runAssistant({ text: "x", workspace: world(), today: "2026-11-05", ask });
    expect(r).toEqual({ ok: false, code: "weak" });
  });

  it("says 'empty' when the model understood and found nothing", async () => {
    const ask: Ask = async () => ({ ok: true, answer: '{"actions":[]}' });
    const r = await runAssistant({ text: "bonjour", workspace: world(), today: "2026-11-05", ask });
    expect(r).toEqual({ ok: false, code: "empty" });
  });

  it("works piece by piece on a big text and stops when interrupted", async () => {
    const calls: number[] = [];
    const ask: Ask = async () => {
      calls.push(1);
      return {
        ok: true,
        answer: '{"actions":[{"type":"add_task","title":"t","project":"Atlas OS"}]}',
      };
    };
    const text = Array.from({ length: 4 }, (_, i) => `${"mot ".repeat(200)}${i}`).join("\n\n");
    const ctl = new AbortController();
    const progress: number[] = [];
    const r = await runAssistant({
      text,
      workspace: world(),
      today: "2026-11-05",
      ask,
      chunkSize: 900,
      signal: ctl.signal,
      onProgress: (d) => {
        progress.push(d);
        if (d === 1) ctl.abort();
      },
    });
    expect(r).toEqual({ ok: false, code: "cancelled" });
    expect(calls).toHaveLength(1);
    expect(progress.at(-1)).toBe(1);
  });

  it("only ever talks to the injected model (nothing else is called)", async () => {
    let n = 0;
    const ask: Ask = async () => (n++, { ok: true, answer: good });
    await runAssistant({ text: "x", workspace: world(), today: "2026-11-05", ask });
    expect(n).toBe(1);
  });
});
