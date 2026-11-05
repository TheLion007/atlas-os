/**
 * The only database surface the server layer depends on. Production uses `postgres` (see
 * ./postgres.ts); tests use PGlite (tests/support/pglite-db.ts). Keeping it this small is what
 * lets the same services run against both.
 */
export type Row = Record<string, unknown>;

export interface Db {
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Runs `fn` atomically. Called on a transaction, it joins that transaction. */
  transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R>;
}

/**
 * Runs `fn` in a transaction acting as `ownerId`: the session switches to the `authenticated`
 * role with that user's id, so row-level security enforces isolation in the database itself
 * (not only through query filters) and `auth.uid()` defaults work.
 */
export async function asOwner<R>(db: Db, ownerId: string, fn: (tx: Db) => Promise<R>): Promise<R> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
    await tx.query("set local role authenticated");
    return fn(tx);
  });
}

/** Encodes strings as a Postgres text[] literal, for use with a `$n::text[]` cast. */
export function toPgTextArray(values: readonly string[]): string {
  const escaped = values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `{${escaped.join(",")}}`;
}
