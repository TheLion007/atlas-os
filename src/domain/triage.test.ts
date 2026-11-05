import { describe, expect, it } from "vitest";
import { ideaLines, triage, triageCount, type TriageProject } from "./triage";

const projects: TriageProject[] = [
  {
    id: "web",
    title: "Refonte du site web",
    words: ["Corriger le bug de connexion", "Maquettes de la page tarifs"],
  },
  { id: "doc", title: "Documentation technique", words: ["Relire le chapitre API REST"] },
];

describe("automatic triage", () => {
  it("strips bullets and numbering from each line", () => {
    expect(ideaLines("- un\n* deux\n3. trois\n\n  quatre  ")).toEqual([
      "un",
      "deux",
      "trois",
      "quatre",
    ]);
  });

  it("puts a line in the project whose name or tasks it echoes, and flags the urgent ones", () => {
    const g = triage(
      "- corriger le footer du site, urgent\n- ajouter des exemples à la documentation API",
      projects,
    );
    expect(g.map((x) => x.kind)).toEqual(["existing", "existing"]);
    expect(g[0]).toMatchObject({ projectId: "web", items: [{ high: true }] });
    expect(g[1]).toMatchObject({ projectId: "doc" });
  });

  it("creates a project from 'Projet :' and keeps the lines under it when they match nothing", () => {
    const g = triage("Projet : Podcast interne\n- trouver un nom\n- acheter un micro", projects);
    expect(g).toEqual([
      {
        kind: "new-project",
        name: "Podcast interne",
        items: [
          { title: "trouver un nom", high: false },
          { title: "acheter un micro", high: false },
        ],
      },
    ]);
  });

  it("creates a sub-project under the project just announced", () => {
    const g = triage("Projet : Podcast\nSous-projet : Matériel\n- acheter un micro", projects);
    expect(g[1]).toMatchObject({ kind: "new-sub", name: "Matériel", under: "Podcast" });
    expect(triageCount(g)).toBe(1);
  });

  it("sends what fits nowhere to the inbox", () => {
    const g = triage("appeler la banque", projects);
    expect(g).toEqual([{ kind: "inbox", items: [{ title: "appeler la banque", high: false }] }]);
  });
});
