import { describe, expect, it } from "vitest";
import type { ApiEdge, ApiObject } from "./api-types";
import {
  buildDocumentRows,
  DEFAULT_DOCUMENT_FILTERS,
  documentFormat,
  filterDocumentRows,
  matchDocument,
  previewKind,
  sortDocumentRows,
  storagePathFor,
  titleFromFileName,
} from "./documents";
import { linkPlan } from "./linking";
import { createObjectSchema } from "./schemas";
import { buildSearchText } from "./search-text";

const obj = (over: Partial<ApiObject> & Pick<ApiObject, "id" | "type" | "title">): ApiObject => ({
  status: "active",
  tags: [],
  confidence: null,
  color: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});
const edge = (kind: ApiEdge["kind"], from: string, to: string): ApiEdge => ({
  id: `${from}-${kind}-${to}`,
  kind,
  from,
  to,
  label: null,
  dependencyType: null,
  lagDays: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

function world() {
  const nodes = [
    obj({ id: "p", type: "project", title: "Nirys" }),
    obj({ id: "m", type: "memory", title: "Borland tax obligations" }),
    obj({ id: "e", type: "transaction", title: "Tax payment" }),
    obj({
      id: "d1",
      type: "document",
      title: "Borland tax notice",
      tags: ["tax", "atlas:example"],
      updatedAt: "2026-03-01T00:00:00.000Z",
      details: {
        mime: "application/pdf",
        kind: "tax",
        sizeBytes: 2000,
        storagePath: "files/1/notice.pdf",
        description: "Yearly notice",
        contentText: null,
      },
    }),
    obj({
      id: "d2",
      type: "document",
      title: "Notes 2026",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      details: {
        mime: "text/plain",
        sizeBytes: 90,
        storagePath: "files/2/notes.txt",
        contentText: "Le précompte immobilier est dû en juin.",
      },
    }),
    obj({
      id: "d3",
      type: "document",
      title: "Brand guide",
      status: "dropped",
      details: { mime: "image/png", sizeBytes: 50_000 },
    }),
  ];
  const edges = [
    edge("references", "d1", "p"),
    edge("supported_by", "m", "d1"),
    edge("references", "d1", "e"),
  ];
  return { nodes, edges, rows: buildDocumentRows(nodes, edges) };
}

describe("document metadata", () => {
  it("creates a document with structured metadata; the file's text is null until extracted", () => {
    const parsed = createObjectSchema.parse({
      type: "document",
      title: "Invoice",
      details: { mime: "application/pdf", kind: "invoice", sizeBytes: 1200, source: "upload" },
    });
    expect(parsed.details).toMatchObject({
      mime: "application/pdf",
      kind: "invoice",
      sizeBytes: 1200,
      source: "upload",
      contentText: null,
      storagePath: null,
    });
  });

  it("derives the format from the mime type, then the extension", () => {
    expect(documentFormat("application/pdf")).toBe("pdf");
    expect(documentFormat("image/jpeg")).toBe("image");
    expect(
      documentFormat("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe("spreadsheet");
    expect(documentFormat("application/octet-stream", "deck.pptx")).toBe("presentation");
    expect(documentFormat("application/octet-stream", "mystery.bin")).toBe("other");
  });

  it("previews only what a browser shows harmlessly", () => {
    expect(previewKind("pdf", "application/pdf")).toBe("pdf");
    expect(previewKind("image", "image/png")).toBe("image");
    expect(previewKind("image", "image/svg+xml")).toBe("none");
    expect(previewKind("spreadsheet", "text/csv")).toBe("none");
  });

  it("indexes description, kind and extracted content for server search", () => {
    const parsed = createObjectSchema.parse({
      type: "document",
      title: "Scan",
      details: { mime: "text/plain", description: "Yearly", kind: "tax", contentText: "précompte" },
    });
    const text = buildSearchText(parsed);
    expect(text).toContain("Yearly");
    expect(text).toContain("tax");
    expect(text).toContain("précompte");
  });

  it("makes safe storage paths and tidy titles from file names", () => {
    expect(storagePathFor("abc", "Précompte 2026 (final).pdf")).toBe(
      "files/abc/Precompte-2026-final-.pdf",
    );
    expect(storagePathFor("abc", "///")).toBe("files/abc/file");
    expect(titleFromFileName("tax_notice_2026.pdf")).toBe("tax notice 2026");
  });
});

describe("document rows and relations", () => {
  it("reads its project, memory and finance relations from ordinary edges", () => {
    const { rows } = world();
    const d1 = rows.find((r) => r.id === "d1")!;
    expect(d1.projects.map((p) => p.title)).toEqual(["Nirys"]);
    expect(d1.memories.map((m) => m.title)).toEqual(["Borland tax obligations"]);
    expect(d1.finance.map((f) => f.title)).toEqual(["Tax payment"]);
    expect(d1.tags).toEqual(["tax"]); // reserved tags stay hidden
    expect(d1).toMatchObject({ format: "pdf", hasFile: true, contentIndexed: false });
    expect(rows.find((r) => r.id === "d2")).toMatchObject({ contentIndexed: true, projects: [] });
  });

  it("has no rows, and filters to nothing, when there are no documents", () => {
    expect(buildDocumentRows([], [])).toEqual([]);
    expect(filterDocumentRows([], DEFAULT_DOCUMENT_FILTERS)).toEqual([]);
  });
});

describe("search and filters", () => {
  const { nodes, rows } = world();
  const contentOf = (id: string) =>
    (nodes.find((n) => n.id === id)?.details?.contentText as string | null) ?? null;
  const search = (query: string, extra = {}) =>
    filterDocumentRows(rows, { ...DEFAULT_DOCUMENT_FILTERS, query, ...extra }, contentOf).map(
      (r) => r.id,
    );

  it("finds by name, tag, project, kind and description", () => {
    expect(search("notice")).toEqual(["d1"]);
    expect(search("tax")).toEqual(["d1"]);
    expect(search("nirys")).toEqual(["d1"]);
    expect(search("yearly")).toEqual(["d1"]);
  });

  it("finds by content only where text was extracted, and says so", () => {
    expect(search("precompte")).toEqual(["d2"]);
    const d2 = rows.find((r) => r.id === "d2")!;
    expect(matchDocument(d2, "precompte", contentOf("d2"))).toBe("content");
    expect(matchDocument(d2, "notes", contentOf("d2"))).toBe("title");
    // A PDF with no extracted text is never "found in its content".
    const d1 = rows.find((r) => r.id === "d1")!;
    expect(matchDocument(d1, "juin", null)).toBeNull();
  });

  it("filters by project, kind, format and archived status", () => {
    expect(search("", { projectId: "p" })).toEqual(["d1"]);
    expect(search("", { projectId: "none" })).toEqual(["d2"]);
    expect(search("", { kind: "tax" })).toEqual(["d1"]);
    expect(search("", { format: "text" })).toEqual(["d2"]);
    expect(search("")).not.toContain("d3");
    expect(search("", { status: "all" })).toContain("d3");
  });

  it("sorts by update, creation, name and size", () => {
    expect(sortDocumentRows(rows, "name").map((r) => r.title)).toEqual([
      "Borland tax notice",
      "Brand guide",
      "Notes 2026",
    ]);
    expect(sortDocumentRows(rows, "size")[0]?.id).toBe("d3");
    expect(sortDocumentRows(rows, "updated")[0]?.id).toBe("d2");
  });
});

describe("linking", () => {
  const doc = { id: "d", type: "document" as const };
  it("backs a memory with a document", () => {
    expect(linkPlan(doc, { id: "m", type: "memory" })).toEqual({
      kind: "supported_by",
      from: "m",
      to: "d",
    });
  });
  it("makes a financial value the value of a project or a transaction", () => {
    expect(linkPlan({ id: "e", type: "estimate" }, { id: "p", type: "project" })).toEqual({
      kind: "estimates",
      from: "e",
      to: "p",
    });
    expect(linkPlan({ id: "t", type: "transaction" }, { id: "e", type: "estimate" })?.kind).toBe(
      "estimates",
    );
  });
  it("references a document from a project, an expense or an investment", () => {
    expect(linkPlan(doc, { id: "p", type: "project" })).toEqual({
      kind: "references",
      from: "d",
      to: "p",
    });
    expect(linkPlan(doc, { id: "e", type: "estimate" })?.kind).toBe("references");
    expect(linkPlan(doc, { id: "t", type: "transaction" })?.kind).toBe("references");
  });
  it("relates a memory to what it is about", () => {
    expect(linkPlan({ id: "m", type: "memory" }, { id: "g", type: "estimate" })?.kind).toBe(
      "about",
    );
    expect(linkPlan(doc, doc)).toBeNull();
  });
});
