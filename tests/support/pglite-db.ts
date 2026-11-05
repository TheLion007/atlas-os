import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { setContextForTests } from "@/server/context";
import type { Db, Row } from "@/server/db/types";
import { createMigratedDb } from "../sql/helpers";

type Runner = Pick<PGlite, "query">;

function wrap(run: Runner, root: PGlite, inTransaction: boolean): Db {
  return {
    async query<T extends Row = Row>(text: string, params: readonly unknown[] = []) {
      const result = await run.query(text, params as unknown[]);
      return result.rows as unknown as T[];
    },
    async transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R> {
      if (inTransaction) return fn(wrap(run, root, true));
      return root.transaction(async (tx) => fn(wrap(tx, root, true)));
    },
  };
}

export const pgliteDb = (pg: PGlite): Db => wrap(pg, pg, false);

export interface ApiHarness {
  pg: PGlite;
  db: Db;
  /** A fresh owner id, so tests never see each other's data. */
  newUser(): string;
  close(): Promise<void>;
}

/**
 * Boots a migrated in-process database and points the API at it. Requests authenticate through
 * an `x-test-user` header; a request without it is unauthenticated.
 */
export async function createApiHarness(): Promise<ApiHarness> {
  const pg = await createMigratedDb();
  const db = pgliteDb(pg);
  setContextForTests({
    getDb: () => db,
    authenticate: async (req) => req.headers.get("x-test-user"),
  });
  return {
    pg,
    db,
    newUser: () => randomUUID(),
    async close() {
      setContextForTests(undefined);
      await pg.close();
    },
  };
}

type Handler = (
  req: Request,
  ctx?: { params?: Promise<Record<string, string>> },
) => Promise<Response>;

export interface CallOptions {
  user?: string | null;
  body?: unknown;
  /** Raw body, for testing malformed JSON. */
  rawBody?: string;
  id?: string;
}

/** Invokes a route handler exactly as Next.js would: a real `Request`, params as a promise. */
export async function call(
  handler: Handler,
  method: string,
  path: string,
  opts: CallOptions = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (opts.user) headers["x-test-user"] = opts.user;
  const hasBody = opts.body !== undefined || opts.rawBody !== undefined;
  if (hasBody) headers["content-type"] = "application/json";
  const req = new Request(`http://localhost${path}`, {
    method,
    headers,
    body: hasBody ? (opts.rawBody ?? JSON.stringify(opts.body)) : undefined,
  });
  const res = await handler(
    req,
    opts.id ? { params: Promise.resolve({ id: opts.id }) } : undefined,
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
