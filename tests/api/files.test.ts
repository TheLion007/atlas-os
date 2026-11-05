import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fileRoute from "@/app/api/files/[...path]/route";
import * as files from "@/app/api/files/route";
import * as graph from "@/app/api/graph/route";
import * as objects from "@/app/api/objects/route";
import * as search from "@/app/api/search/route";
import { servingHeaders } from "@/server/files/store";
import { call, createApiHarness, type ApiHarness } from "../support/pglite-db";

/** Document files: stored per owner, served safely, and searchable through their document. */

let h: ApiHarness;
beforeAll(async () => {
  h = await createApiHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

async function upload(user: string | null, file: File): Promise<Response> {
  const form = new FormData();
  form.append("file", file, file.name);
  const headers: Record<string, string> = {};
  if (user) headers["x-test-user"] = user;
  return files.POST(
    new Request("http://localhost/api/files", { method: "POST", body: form, headers }),
  );
}

function fetchFile(user: string, storagePath: string, method: "GET" | "DELETE" = "GET") {
  const encoded = encodeURIComponent(storagePath);
  const handler = method === "GET" ? fileRoute.GET : fileRoute.DELETE;
  return handler(
    new Request(`http://localhost/api/files/${encoded}`, {
      method,
      headers: { "x-test-user": user },
    }),
    { params: Promise.resolve({ path: [encoded] }) },
  );
}

describe("POST /api/files", () => {
  it("stores a file for its owner and returns where it lives", async () => {
    const user = h.newUser();
    const res = await upload(user, new File(["hello tax"], "notes.txt", { type: "text/plain" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ sizeBytes: 9, mime: "text/plain" });
    expect(body.storagePath).toMatch(/^files\/[0-9a-f-]{36}\/notes\.txt$/);
    expect(body.checksum).toMatch(/^[0-9a-f]{64}$/);

    const got = await fetchFile(user, body.storagePath);
    expect(got.status).toBe(200);
    expect(await got.text()).toBe("hello tax");
    expect(got.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses anonymous uploads and keeps each owner's files private", async () => {
    expect((await upload(null, new File(["x"], "a.txt"))).status).toBe(401);
    const owner = h.newUser();
    const res = await upload(owner, new File(["secret"], "s.txt", { type: "text/plain" }));
    const { storagePath } = await res.json();
    expect((await fetchFile(h.newUser(), storagePath)).status).toBe(404);
  });

  it("deletes a stored file", async () => {
    const user = h.newUser();
    const { storagePath } = await (
      await upload(user, new File(["x"], "gone.pdf", { type: "application/pdf" }))
    ).json();
    expect((await fetchFile(user, storagePath, "DELETE")).status).toBe(204);
    expect((await fetchFile(user, storagePath)).status).toBe(404);
  });
});

describe("serving files safely", () => {
  it("shows PDFs, images and text inline, and makes everything else a download", () => {
    expect(servingHeaders("application/pdf", "a.pdf")["content-disposition"]).toMatch(/^inline/);
    expect(servingHeaders("image/png", "a.png")["content-type"]).toBe("image/png");
    const html = servingHeaders("text/html", "page.html");
    expect(html["content-type"]).toBe("text/plain; charset=utf-8");
    const svg = servingHeaders("image/svg+xml", "logo.svg");
    expect(svg["content-disposition"]).toMatch(/^attachment/);
    expect(svg["content-type"]).toBe("application/octet-stream");
    expect(servingHeaders("application/zip", "a.zip")["content-security-policy"]).toContain(
      "sandbox",
    );
  });
});

describe("documents on the server", () => {
  it("round-trips document metadata and finds a document by its extracted content", async () => {
    const user = h.newUser();
    const created = await call(objects.POST, "POST", "/api/objects", {
      user,
      body: {
        type: "document",
        title: "Scan 0042",
        details: {
          mime: "text/plain",
          kind: "tax",
          description: "Yearly notice",
          source: "upload",
          originalName: "scan-0042.txt",
          contentText: "Avertissement-extrait de rôle : précompte immobilier 2026",
        },
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.details).toMatchObject({ kind: "tax", description: "Yearly notice" });

    const found = await call(
      search.GET,
      "GET",
      `/api/search?q=${encodeURIComponent("precompte")}`,
      {
        user,
      },
    );
    expect(found.status).toBe(200);
    expect(found.body.results.some((r: { title: string }) => r.title === "Scan 0042")).toBe(true);
  });

  it("creates a transaction and a financial value with investment fields", async () => {
    const user = h.newUser();
    const value = await call(objects.POST, "POST", "/api/objects", {
      user,
      body: {
        type: "estimate",
        title: "ETF",
        details: {
          amount: 12000,
          currency: "EUR",
          category: "investment",
          dataKind: "actual",
          costBasis: 10000,
          ticker: "IWDA",
          quantity: 120,
          subcategory: "ETF",
        },
      },
    });
    expect(value.status, JSON.stringify(value.body)).toBe(201);
    expect(value.body.details).toMatchObject({ costBasis: 10000, ticker: "IWDA", quantity: 120 });

    const tx = await call(objects.POST, "POST", "/api/objects", {
      user,
      body: {
        type: "transaction",
        title: "ETF purchase",
        details: { date: "2026-09-05", amount: 500, currency: "EUR", kind: "investment" },
        relations: [
          { kind: "references", direction: "out", other: value.body.id, label: "account" },
        ],
      },
    });
    expect(tx.status, JSON.stringify(tx.body)).toBe(201);
    const all = await call(graph.GET, "GET", "/api/graph?details=true", { user });
    expect(
      all.body.edges.some(
        (e: { from: string; label: string }) => e.from === tx.body.id && e.label === "account",
      ),
    ).toBe(true);
  });
});
