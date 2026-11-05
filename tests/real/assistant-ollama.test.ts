import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "@/domain/api-types";
import { buildProposal, buildWorkspace, type PNode, type Proposal } from "@/domain/assistant-plan";
import { runAssistant, type Ask } from "@/domain/assistant-run";
import { chat, OllamaFailure } from "@/server/ollama";

/**
 * Real run against the Ollama on this PC. Off unless ATLAS_REAL_OLLAMA is set to a list of models
 * (comma separated). Writes the per-model report to ATLAS_REAL_REPORT. Uses in-memory data only:
 * no database, nothing of the person's is read or written.
 */
const models = (process.env.ATLAS_REAL_OLLAMA ?? "")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const obj = (id: string, type: ApiObject["type"], title: string): ApiObject => ({
  id,
  type,
  title,
  status: "active",
  tags: [],
  confidence: null,
  color: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const CASE1 =
  "Crée un plan NIRYS avec mes projets Atlas OS, Nova Audio et Nimbus, et dans Atlas ajoute les sous-projets déploiement, design et promotion";
const CASE2 = [
  "finir le design du graphe dans Atlas",
  "appeler Dumont pour Nimbus",
  "mixer le morceau 3 de l'EP",
  "envoyer le devis du site vitrine à la cliente",
  "écrire la doc d'installation",
  "réserver le studio pour samedi",
].join("\n");

const projects = [
  obj("p-atlas", "project", "Atlas OS"),
  obj("p-nova", "project", "Nova Audio"),
  obj("p-nimbus", "project", "Nimbus"),
  obj("p-site", "project", "Site vitrine"),
];
const pathOf = (p: Proposal, n: PNode): string =>
  [
    ...(n.parent
      ? [
          pathOf(
            p,
            p.nodes.find((x) => x.key === n.parent)!,
          ),
        ]
      : []),
    n.title,
  ].join(" > ");

describe.skipIf(models.length === 0)("real Ollama", () => {
  const report: Record<string, unknown> = {};
  for (const model of models) {
    const ask: Ask = async (messages, opts) => {
      try {
        return { ok: true, answer: await chat(model, messages, opts) };
      } catch (e) {
        return { ok: false, code: e instanceof OllamaFailure ? e.code : "bad_response" };
      }
    };
    it(`${model}: both cases`, async () => {
      const out: Record<string, unknown> = {};
      // 1) the NIRYS sentence, empty workspace
      let t0 = Date.now();
      const r1 = await runAssistant({
        text: CASE1,
        workspace: buildWorkspace([], []),
        today: "2026-11-05",
        ask,
      });
      out.case1 = r1.ok
        ? {
            ms: Date.now() - t0,
            retries: r1.retries,
            tree: r1.proposal.nodes.map((n) => `${n.kind}: ${pathOf(r1.proposal, n)}`),
            actions: r1.actions,
          }
        : { ms: Date.now() - t0, failed: r1.code };
      // 1b) same sentence when the three projects already exist
      const edges: ApiEdge[] = [];
      t0 = Date.now();
      const r1b = await runAssistant({
        text: CASE1,
        workspace: buildWorkspace(projects, edges),
        today: "2026-11-05",
        ask,
      });
      out.case1_existing = r1b.ok
        ? {
            ms: Date.now() - t0,
            retries: r1b.retries,
            tree: r1b.proposal.nodes.map(
              (n) => `${n.kind}${n.existingId ? "*" : ""}: ${pathOf(r1b.proposal, n)}`,
            ),
          }
        : { ms: Date.now() - t0, failed: r1b.code };
      // 2) six loose tasks into four existing projects
      t0 = Date.now();
      const ws2 = buildWorkspace(projects, edges);
      const r2 = await runAssistant({ text: CASE2, workspace: ws2, today: "2026-11-05", ask });
      out.case2 = r2.ok
        ? {
            ms: Date.now() - t0,
            retries: r2.retries,
            tree: r2.proposal.nodes.map(
              (n) => `${n.kind}${n.existingId ? "*" : ""}: ${pathOf(r2.proposal, n)}`,
            ),
          }
        : { ms: Date.now() - t0, failed: r2.code };
      report[model] = out;
      expect(out).toBeTruthy();
    }, 600_000);
  }
  it("writes the report", () => {
    if (process.env.ATLAS_REAL_REPORT)
      writeFileSync(process.env.ATLAS_REAL_REPORT, JSON.stringify(report, null, 2));
    expect(buildProposal([], buildWorkspace([], [])).nodes).toEqual([]);
  });
});
