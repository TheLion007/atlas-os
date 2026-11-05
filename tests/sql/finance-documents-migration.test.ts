import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, createMigratedDb, OWNER } from "./helpers";

/**
 * The Finance & Documents migrations are applied to a database that already holds data, then
 * applied a second time: nothing existing may change, and a re-run must be a no-op.
 */
const ENUMS = "20260924100000_finance_documents_enums.sql";
const TABLES = "20260924100100_finance_documents.sql";

let db: PGlite;
const DOC = "11111111-1111-4111-8111-111111111111";
const EST = "22222222-2222-4222-8222-222222222222";

beforeAll(async () => {
  // The schema as it was before this change, with existing user data in it.
  db = await createMigratedDb({ before: ENUMS });
  await db.exec(`
    insert into public.objects (id, type, title, owner_id)
      values ('${DOC}', 'document', 'Passport', '${OWNER}'),
             ('${EST}', 'estimate', 'Capital on hand', '${OWNER}');
    insert into public.document_details (id, owner_id, mime, size_bytes, issuer, storage_path)
      values ('${DOC}', '${OWNER}', 'application/pdf', 1234, 'Issuer', 'files/x/passport.pdf');
    insert into public.estimate_details (id, owner_id, amount, currency, category, data_kind)
      values ('${EST}', '${OWNER}', 109400, 'EUR', 'capital', 'actual');
  `);
  await applyMigration(db, ENUMS);
  await applyMigration(db, TABLES);
}, 60_000);

afterAll(async () => {
  await db.close();
});

const snapshot = async () => ({
  objects: (await db.query("select id, type, title, owner_id from public.objects order by id"))
    .rows,
  doc: (await db.query("select * from public.document_details")).rows,
  est: (await db.query("select * from public.estimate_details")).rows,
  rules: (await db.query("select count(*)::int as n from public.edge_rules")).rows,
  policies: (await db.query("select policyname from pg_policies order by 1")).rows,
});

describe("finance & documents migrations", () => {
  it("keep existing rows intact, filling only new columns with safe defaults", async () => {
    const { rows } = await db.query<Record<string, unknown>>(
      "select * from public.document_details where id = $1",
      [DOC],
    );
    expect(rows[0]).toMatchObject({
      mime: "application/pdf",
      size_bytes: 1234,
      issuer: "Issuer",
      storage_path: "files/x/passport.pdf",
      kind: "other",
      description: "",
      source: "",
      original_name: null,
      uploaded_at: null,
      content_text: null,
    });
    const est = await db.query<Record<string, unknown>>(
      "select * from public.estimate_details where id = $1",
      [EST],
    );
    expect(est.rows[0]).toMatchObject({
      category: "capital",
      data_kind: "actual",
      currency: "EUR",
      cost_basis: null,
      quantity: null,
      ticker: null,
      subcategory: null,
    });
    expect(Number(est.rows[0]?.amount)).toBe(109400);
  });

  it("can be applied again without error and without changing anything", async () => {
    const before = await snapshot();
    await applyMigration(db, ENUMS);
    await applyMigration(db, TABLES);
    expect(await snapshot()).toEqual(before);
  });

  it("contain no destructive statement", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const file of [ENUMS, TABLES]) {
      const sql = readFileSync(join(process.cwd(), "db", "migrations", file), "utf8")
        .split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .toLowerCase();
      expect(sql, file).not.toMatch(/\b(drop|truncate|delete\s+from|update\s+public|rename)\b/);
    }
  });
});
