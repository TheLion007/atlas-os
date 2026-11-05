import type { Authenticator } from "./auth";
import { createPgliteDb } from "./db/pglite";
import type { Db } from "./db/types";
import { localOwnerAuth } from "./local-owner";

export interface ServerContext {
  getDb(): Db;
  authenticate: Authenticator;
}

let cachedDb: Db | undefined;

const defaultContext: ServerContext = {
  getDb() {
    if (!cachedDb) {
      cachedDb = createPgliteDb();
    }
    return cachedDb;
  },
  // Single local owner, no sign-in: the app only listens on 127.0.0.1.
  authenticate: localOwnerAuth,
};

let override: ServerContext | undefined;

export function getContext(): ServerContext {
  return override ?? defaultContext;
}

/** Test seam: swap the database and authenticator. Pass `undefined` to restore defaults. */
export function setContextForTests(ctx: ServerContext | undefined): void {
  override = ctx;
}
