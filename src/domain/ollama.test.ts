import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import {
  assistantContext,
  isOllamaErrorCode,
  ollamaState,
  pickModel,
  pullCommand,
  RECOMMENDED,
} from "./ollama";

const m = (name: string) => ({ name, sizeBytes: 1 });

describe("local assistant detection", () => {
  it("tells the three situations apart", () => {
    expect(ollamaState(undefined)).toBe("off");
    expect(ollamaState({ reachable: false, models: [] })).toBe("off");
    expect(ollamaState({ reachable: true, models: [] })).toBe("no-model");
    expect(ollamaState({ reachable: true, models: [m("llama3.2:3b")] })).toBe("ready");
  });

  it("offers the two models of the tutorial, with their commands", () => {
    expect(RECOMMENDED.map((r) => pullCommand(r.model))).toEqual([
      "ollama pull llama3.2:3b",
      "ollama pull qwen2.5:7b",
    ]);
  });

  it("keeps the chosen model while it is installed, else falls back sensibly", () => {
    const models = [m("mistral:7b"), m("qwen2.5:7b"), m("llama3.2:3b")];
    expect(pickModel(models, "mistral:7b")).toBe("mistral:7b");
    // The chosen one was removed: a recommended model, small first.
    expect(pickModel(models, "gone:1b")).toBe("llama3.2:3b");
    expect(pickModel([m("mistral:7b")], null)).toBe("mistral:7b");
    expect(pickModel([], "x")).toBeNull();
  });

  it("recognises the error codes the bridge sends", () => {
    expect(isOllamaErrorCode("timeout")).toBe(true);
    expect(isOllamaErrorCode("nope")).toBe(false);
    expect(isOllamaErrorCode(undefined)).toBe(false);
  });
});

describe("what the model is told", () => {
  const obj = (
    id: string,
    type: ApiObject["type"],
    title: string,
    details = {},
    status = "active",
  ): ApiObject =>
    ({
      id,
      type,
      title,
      status,
      tags: [],
      confidence: null,
      color: null,
      createdAt: "",
      updatedAt: "",
      details,
    }) as ApiObject;
  const nodes = [
    obj("p", "project", "Refonte du site", { targetDate: "2026-12-01" }),
    obj("t1", "task", "Maquettes", { due: "2026-11-03" }),
    obj("t2", "task", "Sans date"),
    obj("t3", "task", "Fini", {}, "done"),
  ];
  const edges: ApiEdge[] = ["t1", "t2", "t3"].map((to) => ({
    id: to,
    kind: "contains",
    from: "p",
    to,
    label: null,
    dependencyType: null,
    lagDays: null,
    createdAt: "",
  }));

  it("summarises projects and open tasks, in French, from the person's own data", () => {
    const c = assistantContext(nodes, edges, "2026-11-01");
    expect(c).toContain("Date du jour : 2026-11-01.");
    expect(c).toContain("Refonte du site");
    expect(c).toContain("échéance 2026-12-01");
    expect(c).toContain("- Maquettes (pour le 2026-11-03)");
    expect(c).toContain("- Sans date");
    expect(c).not.toContain("Fini");
  });

  it("says so when there is nothing", () => {
    const c = assistantContext([], [], "2026-11-01");
    expect(c).toContain("(aucun projet)");
    expect(c).toContain("(aucune)");
  });
});
