import type { ApiEdge } from "@/domain/api-types";
import { createEdgeSchema, type ParsedEdgeInput } from "@/domain/schemas";
import { asOwner, type Db } from "../db/types";
import { ApiError, mapDbError, notFound } from "../errors";
import { iso } from "./mapping";

interface EdgeRow {
  id: string;
  kind: ApiEdge["kind"];
  from_id: string;
  to_id: string;
  label: string | null;
  dependency_type: string | null;
  lag_days: number | null;
  created_at: unknown;
  [key: string]: unknown;
}

const EDGE_COLUMNS = "id, kind, from_id, to_id, label, dependency_type, lag_days, created_at";

const toApiEdge = (r: EdgeRow): ApiEdge => ({
  id: r.id,
  kind: r.kind,
  from: r.from_id,
  to: r.to_id,
  label: r.label,
  dependencyType: r.dependency_type,
  lagDays: r.lag_days,
  createdAt: iso(r.created_at),
});

/** Inserts one edge inside an existing transaction. The database enforces every invariant. */
export async function insertEdge(tx: Db, owner: string, e: ParsedEdgeInput): Promise<ApiEdge> {
  const rows = await tx.query<EdgeRow>(
    `insert into public.edges (kind, from_id, to_id, label, dependency_type, lag_days, owner_id)
     values ($1::public.edge_kind, $2, $3, $4, $5::public.dependency_type, $6, $7)
     returning ${EDGE_COLUMNS}`,
    [e.kind, e.from, e.to, e.label, e.dependencyType, e.lagDays, owner],
  );
  return toApiEdge(rows[0] as EdgeRow);
}

export function parseCreateEdgeBody(body: unknown): ParsedEdgeInput {
  const parsed = createEdgeSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "validation", "Invalid relation.", parsed.error.issues);
  }
  return parsed.data;
}

export async function createEdge(db: Db, owner: string, e: ParsedEdgeInput): Promise<ApiEdge> {
  try {
    return await asOwner(db, owner, (tx) => insertEdge(tx, owner, e));
  } catch (err) {
    throw mapDbError(err);
  }
}

/** Soft-deletes a relation. The slot is freed so the same relation can be re-created later. */
export async function deleteEdge(db: Db, owner: string, id: string): Promise<void> {
  try {
    await asOwner(db, owner, async (tx) => {
      const rows = await tx.query(
        "update public.edges set deleted_at = now() where id = $1 and deleted_at is null returning id",
        [id],
      );
      if (rows.length === 0) throw notFound("Relation");
    });
  } catch (err) {
    throw mapDbError(err);
  }
}
