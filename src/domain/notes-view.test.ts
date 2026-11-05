import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import { groupNotes, noteBlocks, noteExcerpt, noteLinks, summarizeNote } from "./notes-view";

const obj = (id: string, type: ApiObject["type"], title: string, details?: object): ApiObject => ({
  id,
  type,
  title,
  status: "active",
  tags: [],
  confidence: null,
  color: null,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: `2026-10-0${id.length}T00:00:00Z`,
  details: details as Record<string, unknown>,
});
const edge = (kind: ApiEdge["kind"], from: string, to: string): ApiEdge => ({
  id: `${from}-${to}`,
  kind,
  from,
  to,
  label: null,
  dependencyType: null,
  lagDays: null,
  createdAt: "",
});

const blocks = [
  { id: "1", type: "heading", text: "Principes" },
  {
    id: "2",
    type: "paragraph",
    text: "Une action par page. Un contraste AA. Pas de carrousel. Et le reste.",
  },
];
const nodes = [
  obj("p", "project", "Refonte"),
  obj("n1", "note", "Principes", { blocks }),
  obj("n2", "note", "Idées en vrac", { blocks: [{ id: "1", type: "list", text: "Un truc" }] }),
  obj("n3", "note", "Autre", { blocks: [] }),
];
const edges = [edge("references", "n1", "p"), edge("references", "n3", "n1")];

describe("notes view", () => {
  it("reads blocks defensively", () => {
    expect(
      noteBlocks(obj("x", "note", "t", { blocks: [null, { type: "nope", text: 4 }] })),
    ).toEqual([{ id: "2", type: "paragraph", text: "" }]);
  });

  it("excerpts the first prose, skipping headings", () => {
    expect(noteExcerpt(noteBlocks(nodes[1] as ApiObject))).toMatch(/^Une action par page/);
  });

  it("sums up in three sentences", () => {
    expect(summarizeNote(noteBlocks(nodes[1] as ApiObject))).toBe(
      "Une action par page. Un contraste AA. Pas de carrousel.",
    );
  });

  it("groups global notes first, then by project, and filters by text", () => {
    const g = groupNotes(nodes, edges, "", "Globales");
    expect(g.map((x) => x.label)).toEqual(["Globales", "Refonte"]);
    expect(g[1]?.notes.map((n) => n.id)).toEqual(["n1"]);
    expect(
      groupNotes(nodes, edges, "carrousel", "G").flatMap((x) => x.notes.map((n) => n.id)),
    ).toEqual(["n1"]);
  });

  it("lists outgoing links and the notes that mention it", () => {
    const l = noteLinks(nodes[1] as ApiObject, nodes, edges);
    expect(l.out.map((x) => x.id)).toEqual(["p"]);
    expect(l.back.map((x) => x.id)).toEqual(["n3"]);
  });
});
