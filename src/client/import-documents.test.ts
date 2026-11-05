import { describe, expect, it, vi } from "vitest";
import { buildFinanceModel } from "@/domain/finance";
import { buildDocumentRows } from "@/domain/documents";
import { buildFixtureData, emptyFixtureData } from "@/seed/fixtures";
import { seedId } from "@/seed/seed-types";
import { createFixtureSource } from "./fixture-source";
import { guessKind, importDocument } from "./import-documents";
import { exampleSeed } from "@tests/fixtures/example-seed";

const now = new Date("2026-09-21T09:00:00Z");

describe("importing a document", () => {
  it("stores the file, creates its document, and reads plain text for content search", async () => {
    const source = createFixtureSource(emptyFixtureData(exampleSeed()));
    const file = new File(["Précompte immobilier : 1 240 EUR"], "precompte-2026.txt", {
      type: "text/plain",
    });
    const doc = await importDocument(source, file, { now, tags: ["tax"] });
    expect(doc.type).toBe("document");
    expect(doc.title).toBe("precompte-2026");
    expect(doc.tags).toEqual(["tax"]);
    expect(doc.details).toMatchObject({
      mime: "text/plain",
      originalName: "precompte-2026.txt",
      source: "upload",
      kind: "tax",
      contentText: "Précompte immobilier : 1 240 EUR",
      uploadedAt: now.toISOString(),
    });
    expect(doc.details?.sizeBytes).toBe(
      new TextEncoder().encode("Précompte immobilier : 1 240 EUR").length,
    );
    expect(doc.details?.checksum).toMatch(/^[0-9a-f]{64}$/);
    // The object is findable through the shared graph like everything else.
    const { nodes, edges } = await source.graph();
    expect(buildDocumentRows(nodes, edges).map((r) => r.id)).toEqual([doc.id]);
  });

  it("never pretends to have read a PDF", async () => {
    const source = createFixtureSource(emptyFixtureData(exampleSeed()));
    const pdf = new File(["%PDF-1.4 …"], "notice.pdf", { type: "application/pdf" });
    const doc = await importDocument(source, pdf, { now });
    expect(doc.details?.contentText).toBeNull();
  });

  it("relates it to its project", async () => {
    const data = buildFixtureData(exampleSeed());
    const source = createFixtureSource(data);
    const project = seedId("p_ironfield");
    const doc = await importDocument(
      source,
      new File(["x"], "lease.pdf", { type: "application/pdf" }),
      {
        now,
        projectId: project,
      },
    );
    expect(doc.relations.references.outgoing.map((r) => r.object.id)).toEqual([project]);
    expect(doc.details?.kind).toBe("contract");
  });

  it("relates it to a plan just as readily as a project — it is a plain reference", async () => {
    const data = buildFixtureData(exampleSeed());
    const source = createFixtureSource(data);
    const plan = seedId("pl_dorsel");
    const doc = await importDocument(
      source,
      new File(["x"], "programme.pdf", { type: "application/pdf" }),
      { now, projectId: plan },
    );
    expect(doc.relations.references.outgoing.map((r) => r.object.id)).toEqual([plan]);
  });

  it("removes the stored file again when the document cannot be created", async () => {
    const source = createFixtureSource(emptyFixtureData(exampleSeed()));
    const remove = vi.spyOn(source, "deleteFile");
    const file = new File(["x"], "orphan.pdf", { type: "application/pdf" });
    await expect(
      importDocument(source, file, { now, projectId: "00000000-0000-4000-8000-000000000999" }),
    ).rejects.toThrow();
    expect(remove).toHaveBeenCalledTimes(1);
    expect((await source.graph()).nodes).toHaveLength(0);
  });

  it("guesses a kind from the file name only as a suggestion", () => {
    expect(guessKind("Facture-2026-03.pdf")).toBe("invoice");
    expect(guessKind("bail_appartement.pdf")).toBe("contract");
    expect(guessKind("holiday.jpg")).toBe("other");
  });
});

describe("the fixture file store", () => {
  it("preloads the files behind seeded documents", () => {
    const data = buildFixtureData(exampleSeed());
    const source = createFixtureSource(data);
    const notice = data.nodes.find((n) => n.id === seedId("doc_tax"));
    const path = notice?.details?.storagePath as string;
    expect(path).toMatch(/^files\//);
    expect(data.files?.some((f) => f.path === path && f.text.startsWith("%PDF-1.4"))).toBe(true);
    // In Node there is no object-URL support: the store says "not available", never a broken URL.
    const url = source.fileUrl(path);
    expect(url === null || typeof url === "string").toBe(true);
    expect(source.fileUrl("files/missing/x.pdf")).toBeNull();
  });

  it("deletes a document object, and its links with it", async () => {
    const source = createFixtureSource(buildFixtureData(exampleSeed()));
    const id = seedId("doc_tax");
    await source.deleteObject(id);
    const { nodes, edges } = await source.graph();
    expect(nodes.some((n) => n.id === id)).toBe(false);
    expect(edges.some((e) => e.from === id || e.to === id)).toBe(false);
  });
});

describe("financial objects through the data source", () => {
  const input = async (source: ReturnType<typeof createFixtureSource>) => {
    const { nodes, edges } = await source.graph();
    const settings = await source.settings();
    return buildFinanceModel({
      nodes,
      edges,
      baseCurrency: settings.baseCurrency,
      fxRates: settings.fxRates,
      scenario: "base",
      today: source.today(),
    });
  };

  it("creates, edits and deletes a value; every total follows", async () => {
    const source = createFixtureSource(buildFixtureData(exampleSeed()));
    const before = (await input(source)).summary.netWorth.value ?? 0;
    const car = await source.createObject({
      type: "estimate",
      title: "Car",
      status: "active",
      tags: [],
      confidence: null,
      details: { amount: 12000, currency: "EUR", category: "asset", dataKind: "actual" },
    });
    expect((await input(source)).summary.netWorth.value).toBeCloseTo(before + 12000, 6);
    await source.updateObject(car.id, { details: { amount: 9000 } });
    expect((await input(source)).summary.netWorth.value).toBeCloseTo(before + 9000, 6);
    await source.deleteObject(car.id);
    expect((await input(source)).summary.netWorth.value).toBeCloseTo(before, 6);
  });

  it("records a transaction through an account", async () => {
    const source = createFixtureSource(buildFixtureData(exampleSeed()));
    const account = seedId("e_current");
    const tx = await source.createObject(
      {
        type: "transaction",
        title: "Dentist",
        status: "active",
        tags: [],
        confidence: null,
        details: {
          date: "2026-09-18",
          amount: 85,
          currency: "EUR",
          kind: "expense",
          subcategory: "Health",
        },
      },
      [{ kind: "references", direction: "out", other: account, label: "account" }],
    );
    const model = await input(source);
    const row = model.transactions.find((r) => r.id === tx.id);
    expect(row).toMatchObject({ amount: 85, kind: "expense", account: { id: account } });
  });
});
