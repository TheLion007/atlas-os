import { z } from "zod";
import type {
  ApiObject,
  ApiObjectWithRelations,
  ConvertTypeResult,
  ObjectPage,
  RelationGroups,
  RelationItem,
} from "@/domain/api-types";
import {
  DEPENDENCY_TYPES,
  EDGE_KINDS,
  LIFECYCLE_STATUSES,
  OBJECT_TYPES,
  type EdgeKind,
  type LifecycleStatus,
  type ObjectType,
} from "@/domain/enums";
import { CONVERTIBLE_TYPES } from "@/domain/creation";
import { isEdgeAllowed } from "@/domain/edge-rules";
import {
  createEdgeSchema,
  createObjectSchema,
  type ParsedEdgeInput,
  type ParsedObjectInput,
} from "@/domain/schemas";
import { buildSearchText } from "@/domain/search-text";
import { asOwner, toPgTextArray, type Db } from "../db/types";
import { ApiError, mapDbError, notFound } from "../errors";
import { insertEdge } from "./edges";
import { DETAIL_TABLE, JSONB_FIELDS, detailsFromRow, iso, toSnake } from "./mapping";

export type {
  ApiObject,
  ApiObjectWithRelations,
  ConvertTypeResult,
  ObjectPage,
  RelationGroups,
  RelationItem,
} from "@/domain/api-types";

// ── Request parsing ──────────────────────────────────────────────────────────────────────────

const relationInputSchema = z.object({
  kind: z.enum(EDGE_KINDS),
  /** `out`: the new object is the source (`from`). `in`: it is the target (`to`). */
  direction: z.enum(["out", "in"]).default("out"),
  other: z.uuid(),
  label: z.string().trim().max(60).nullable().default(null),
  dependencyType: z.enum(DEPENDENCY_TYPES).nullable().default(null),
  lagDays: z.number().int().nullable().default(null),
});
export type RelationInput = z.output<typeof relationInputSchema>;

function validation(message: string, issues: unknown): ApiError {
  return new ApiError(400, "validation", message, issues);
}

/** A create body is the object's fields plus optional `relations` to create with it. */
export function parseCreateObjectBody(body: unknown): {
  object: ParsedObjectInput;
  relations: RelationInput[];
} {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validation("Expected a JSON object.", []);
  }
  const { relations: rawRelations, ...rest } = body as Record<string, unknown>;
  const object = createObjectSchema.safeParse(rest);
  if (!object.success) throw validation("Invalid object.", object.error.issues);
  const relations = z
    .array(relationInputSchema)
    .max(100)
    .safeParse(rawRelations ?? []);
  if (!relations.success) throw validation("Invalid relations.", relations.error.issues);
  return { object: object.data, relations: relations.data };
}

const updateObjectSchema = z.strictObject({
  title: z.string().optional(),
  status: z.enum(LIFECYCLE_STATUSES).optional(),
  tags: z.array(z.string()).optional(),
  confidence: z.number().int().nullable().optional(),
  color: z.string().nullable().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateObjectInput = z.output<typeof updateObjectSchema>;

export function parseUpdateObjectBody(body: unknown): UpdateObjectInput {
  const parsed = updateObjectSchema.safeParse(body);
  if (!parsed.success) throw validation("Invalid update.", parsed.error.issues);
  return parsed.data;
}

const convertTypeSchema = z.strictObject({ type: z.enum(CONVERTIBLE_TYPES) });
export type ConvertTypeInput = z.output<typeof convertTypeSchema>;

export function parseConvertTypeBody(body: unknown): ConvertTypeInput {
  const parsed = convertTypeSchema.safeParse(body);
  if (!parsed.success) throw validation("Invalid category.", parsed.error.issues);
  return parsed.data;
}

export const listObjectsQuerySchema = z.object({
  type: z.enum(OBJECT_TYPES).optional(),
  status: z.enum(LIFECYCLE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListObjectsQuery = z.output<typeof listObjectsQuerySchema>;

// ── Reads ────────────────────────────────────────────────────────────────────────────────────

interface SpineRow {
  id: string;
  type: ObjectType;
  title: string;
  status: LifecycleStatus;
  tags: string[];
  confidence: number | null;
  color: string | null;
  created_at: unknown;
  updated_at: unknown;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

const SPINE_COLUMNS =
  "o.id, o.type, o.title, o.status, o.tags, o.confidence, o.color, o.created_at, o.updated_at";

const toApiObject = (r: SpineRow, withDetails: boolean): ApiObject => ({
  id: r.id,
  type: r.type,
  title: r.title,
  status: r.status,
  tags: r.tags,
  confidence: r.confidence,
  color: r.color,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  ...(withDetails && r.details ? { details: detailsFromRow(r.details) } : {}),
});

async function loadObject(
  tx: Db,
  id: string,
): Promise<ApiObject & { details: Record<string, unknown> }> {
  const rows = await tx.query<SpineRow>(
    `select ${SPINE_COLUMNS} from public.objects o where o.id = $1 and o.deleted_at is null`,
    [id],
  );
  const spine = rows[0];
  if (!spine) throw notFound();

  const table = DETAIL_TABLE[spine.type];
  const detail = await tx.query<{ d: Record<string, unknown> }>(
    `select to_jsonb(d) as d from public.${table} d where d.id = $1`,
    [id],
  );
  const details = detail[0] ? detailsFromRow(detail[0].d) : {};
  return { ...toApiObject(spine, false), details };
}

const emptyGroups = (): RelationGroups => {
  const groups = {} as RelationGroups;
  for (const kind of EDGE_KINDS) groups[kind] = { outgoing: [], incoming: [] };
  return groups;
};

async function loadRelations(tx: Db, id: string): Promise<RelationGroups> {
  const rows = await tx.query<{
    edge_id: string;
    kind: EdgeKind;
    outgoing: boolean;
    label: string | null;
    dependency_type: string | null;
    lag_days: number | null;
    other_id: string;
    other_type: ObjectType;
    other_title: string;
    other_status: LifecycleStatus;
  }>(
    `select e.id as edge_id, e.kind, (e.from_id = $1) as outgoing, e.label, e.dependency_type,
            e.lag_days, o.id as other_id, o.type as other_type, o.title as other_title,
            o.status as other_status
     from public.edges e
     join public.objects o on o.id = case when e.from_id = $1 then e.to_id else e.from_id end
     where e.deleted_at is null and o.deleted_at is null and (e.from_id = $1 or e.to_id = $1)
     order by e.kind, o.title, e.id`,
    [id],
  );
  const groups = emptyGroups();
  for (const r of rows) {
    const item: RelationItem = {
      edgeId: r.edge_id,
      label: r.label,
      dependencyType: r.dependency_type,
      lagDays: r.lag_days,
      object: { id: r.other_id, type: r.other_type, title: r.other_title, status: r.other_status },
    };
    groups[r.kind][r.outgoing ? "outgoing" : "incoming"].push(item);
  }
  return groups;
}

async function loadWithRelations(tx: Db, id: string): Promise<ApiObjectWithRelations> {
  const object = await loadObject(tx, id);
  return { ...object, relations: await loadRelations(tx, id) };
}

export async function getObject(
  db: Db,
  owner: string,
  id: string,
  opts: { expandRelations?: boolean } = {},
): Promise<ApiObject | ApiObjectWithRelations> {
  return asOwner<ApiObject | ApiObjectWithRelations>(db, owner, (tx) =>
    opts.expandRelations ? loadWithRelations(tx, id) : loadObject(tx, id),
  );
}

/** Lists objects newest-first. Details are included only when filtering to a single type. */
export async function listObjects(db: Db, owner: string, q: ListObjectsQuery): Promise<ObjectPage> {
  return asOwner(db, owner, async (tx) => {
    const where = ["o.deleted_at is null"];
    const params: unknown[] = [];
    if (q.type) {
      params.push(q.type);
      where.push(`o.type = $${params.length}::public.object_type`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`o.status = $${params.length}::public.lifecycle_status`);
    }
    const clause = where.join(" and ");

    const count = await tx.query<{ n: number }>(
      `select count(*)::int as n from public.objects o where ${clause}`,
      params,
    );

    const withDetails = q.type !== undefined;
    const table = q.type ? DETAIL_TABLE[q.type] : null;
    const rows = await tx.query<SpineRow>(
      `select ${SPINE_COLUMNS}${withDetails ? ", to_jsonb(d) as details" : ""}
       from public.objects o ${table ? `join public.${table} d on d.id = o.id` : ""}
       where ${clause}
       order by o.updated_at desc, o.id
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, q.limit, q.offset],
    );
    return {
      items: rows.map((r) => toApiObject(r, withDetails)),
      total: count[0]?.n ?? 0,
      limit: q.limit,
      offset: q.offset,
    };
  });
}

// ── Writes ───────────────────────────────────────────────────────────────────────────────────

const SAFE_COLUMN = /^[a-z][a-z0-9_]*$/;

/** Builds `[columns, placeholders, params]` for a details write from the validated details. */
function detailColumns(details: Record<string, unknown>, firstParam: number) {
  const cols: string[] = [];
  const placeholders: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(details)) {
    const col = toSnake(key);
    // Keys come from our own Zod schema, never from the request, but never trust interpolation.
    if (!SAFE_COLUMN.test(col)) throw new Error(`Unsafe column name: ${col}`);
    params.push(JSONB_FIELDS.has(key) ? JSON.stringify(value) : value);
    const n = firstParam + params.length - 1;
    cols.push(col);
    placeholders.push(JSONB_FIELDS.has(key) ? `$${n}::jsonb` : `$${n}`);
  }
  return { cols, placeholders, params };
}

async function insertDetails(
  tx: Db,
  id: string,
  owner: string,
  input: ParsedObjectInput,
): Promise<void> {
  const d = detailColumns(input.details as Record<string, unknown>, 4);
  await tx.query(
    `insert into public.${DETAIL_TABLE[input.type]} (id, type, owner_id${d.cols.map((c) => `, ${c}`).join("")})
     values ($1, $2::public.object_type, $3${d.placeholders.map((p) => `, ${p}`).join("")})`,
    [id, input.type, owner, ...d.params],
  );
}

async function updateDetails(tx: Db, id: string, input: ParsedObjectInput): Promise<void> {
  const d = detailColumns(input.details as Record<string, unknown>, 2);
  if (d.cols.length === 0) return;
  const sets = d.cols.map((c, i) => `${c} = ${d.placeholders[i]}`).join(", ");
  await tx.query(`update public.${DETAIL_TABLE[input.type]} set ${sets} where id = $1`, [
    id,
    ...d.params,
  ]);
}

async function updateSpine(tx: Db, id: string, input: ParsedObjectInput): Promise<void> {
  await tx.query(
    `update public.objects
     set title = $2, status = $3::public.lifecycle_status, tags = $4::text[],
         confidence = $5, color = $6, search_text = $7
     where id = $1 and deleted_at is null`,
    [
      id,
      input.title,
      input.status,
      toPgTextArray(input.tags),
      input.confidence,
      input.color,
      buildSearchText(input),
    ],
  );
}

/** Creates an object, its details and any relations atomically. */
export async function createObject(
  db: Db,
  owner: string,
  input: ParsedObjectInput,
  relations: readonly RelationInput[] = [],
): Promise<ApiObjectWithRelations> {
  try {
    return await asOwner(db, owner, async (tx) => {
      const rows = await tx.query<{ id: string }>(
        `insert into public.objects (type, title, status, tags, confidence, color, search_text, owner_id)
         values ($1::public.object_type, $2, $3::public.lifecycle_status, $4::text[], $5, $6, $7, $8)
         returning id`,
        [
          input.type,
          input.title,
          input.status,
          toPgTextArray(input.tags),
          input.confidence,
          input.color,
          buildSearchText(input),
          owner,
        ],
      );
      const id = (rows[0] as { id: string }).id;
      await insertDetails(tx, id, owner, input);

      for (const r of relations) {
        const edge: ParsedEdgeInput = createEdgeSchema.parse({
          kind: r.kind,
          from: r.direction === "out" ? id : r.other,
          to: r.direction === "out" ? r.other : id,
          label: r.label,
          dependencyType: r.dependencyType,
          lagDays: r.lagDays,
        });
        await insertEdge(tx, owner, edge);
      }
      return loadWithRelations(tx, id);
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

/**
 * Updates an object. The patch is merged onto the current state and re-validated as a whole, so
 * every cross-field rule (budgets, currency vs unit, closing a decision) applies exactly as on
 * creation. `type` cannot change.
 */
export async function updateObject(
  db: Db,
  owner: string,
  id: string,
  patch: UpdateObjectInput,
): Promise<ApiObjectWithRelations> {
  try {
    return await asOwner(db, owner, async (tx) => {
      const current = await loadObject(tx, id);
      const merged = {
        type: current.type,
        title: patch.title ?? current.title,
        status: patch.status ?? current.status,
        tags: patch.tags ?? current.tags,
        confidence: patch.confidence !== undefined ? patch.confidence : current.confidence,
        color: patch.color !== undefined ? patch.color : current.color,
        details: { ...current.details, ...patch.details },
      };
      const parsed = createObjectSchema.safeParse(merged);
      if (!parsed.success) throw validation("Invalid update.", parsed.error.issues);

      // The database checks "no close without a reason" from both sides, so order the writes:
      // when closing, the details (option + rationale) must land before the status flips;
      // otherwise the status goes first so a reopened decision may then clear its details.
      const closing = parsed.data.status === "done" && current.status !== "done";
      if (closing) {
        await updateDetails(tx, id, parsed.data);
        await updateSpine(tx, id, parsed.data);
      } else {
        await updateSpine(tx, id, parsed.data);
        await updateDetails(tx, id, parsed.data);
      }
      return loadWithRelations(tx, id);
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

/**
 * Changes an object's category (project/sub_project/plan only — comparable "structure"
 * containers). `objects.type` is immutable by database design (`objects_type_immutable`,
 * 20260921120100_objects_and_details.sql), so this cannot rewrite the row in place: it creates a
 * new object of the target type (title/status/tags/confidence/color carried over), maps details
 * to whatever the new type's schema has room for, recreates every live relation that is still
 * legal for the new type (pointing at the new id), then archives the original — whose remaining,
 * no-longer-legal relations are soft-deleted for free by the existing cascade-on-delete trigger.
 */
export async function convertObjectType(
  db: Db,
  owner: string,
  id: string,
  newType: ObjectType,
): Promise<ConvertTypeResult> {
  try {
    return await asOwner(db, owner, async (tx) => {
      const current = await loadObject(tx, id);
      if (!(CONVERTIBLE_TYPES as readonly ObjectType[]).includes(current.type))
        throw validation("This type cannot change category.", []);
      if (current.type === newType) throw validation("Already that category.", []);

      const sameTable = DETAIL_TABLE[current.type] === DETAIL_TABLE[newType];
      const d = current.details;
      const droppedFields: string[] = [];
      let newDetails: Record<string, unknown>;
      if (sameTable) {
        // project <-> sub_project: identical shape; only a sub-project may not carry a budget.
        newDetails = { ...d };
        if (newType === "sub_project" && d.budgetAmount !== null && d.budgetAmount !== undefined) {
          droppedFields.push("budgetAmount", "budgetCurrency");
          newDetails.budgetAmount = null;
          newDetails.budgetCurrency = null;
        }
      } else {
        // project/sub_project <-> plan: only `description` exists on both sides.
        for (const key of Object.keys(d)) if (key !== "description") droppedFields.push(key);
        newDetails = { description: (d.description as string | undefined) ?? "" };
      }

      const candidate = {
        type: newType,
        title: current.title,
        status: current.status,
        tags: current.tags,
        confidence: current.confidence,
        color: current.color,
        details: newDetails,
      };
      const parsed = createObjectSchema.safeParse(candidate);
      if (!parsed.success) throw validation("Invalid conversion.", parsed.error.issues);

      // Which of this object's live relations stay legal once its side becomes `newType`?
      const edgeRows = await tx.query<{
        id: string;
        kind: EdgeKind;
        from_id: string;
        to_id: string;
        label: string | null;
        dependency_type: string | null;
        lag_days: number | null;
        from_type: ObjectType;
        to_type: ObjectType;
      }>(
        `select e.id, e.kind, e.from_id, e.to_id, e.label, e.dependency_type, e.lag_days,
                fo.type as from_type, tob.type as to_type
         from public.edges e
         join public.objects fo on fo.id = e.from_id
         join public.objects tob on tob.id = e.to_id
         where e.deleted_at is null and (e.from_id = $1 or e.to_id = $1)`,
        [id],
      );
      const kept = edgeRows.filter((e) => {
        const fromType = e.from_id === id ? newType : e.from_type;
        const toType = e.to_id === id ? newType : e.to_type;
        return isEdgeAllowed(e.kind, fromType, toType);
      });

      const rows = await tx.query<{ id: string }>(
        `insert into public.objects (type, title, status, tags, confidence, color, search_text, owner_id)
         values ($1::public.object_type, $2, $3::public.lifecycle_status, $4::text[], $5, $6, $7, $8)
         returning id`,
        [
          parsed.data.type,
          parsed.data.title,
          parsed.data.status,
          toPgTextArray(parsed.data.tags),
          parsed.data.confidence,
          parsed.data.color,
          buildSearchText(parsed.data),
          owner,
        ],
      );
      const newId = (rows[0] as { id: string }).id;
      await insertDetails(tx, newId, owner, parsed.data);

      for (const e of kept) {
        await insertEdge(tx, owner, {
          kind: e.kind,
          from: e.from_id === id ? newId : e.from_id,
          to: e.to_id === id ? newId : e.to_id,
          label: e.label,
          dependencyType: e.dependency_type as ParsedEdgeInput["dependencyType"],
          lagDays: e.lag_days,
        });
      }

      // Archives the original; its cascade trigger soft-deletes whatever relations were not
      // recreated above.
      await tx.query("update public.objects set deleted_at = now() where id = $1", [id]);

      return {
        object: await loadWithRelations(tx, newId),
        droppedRelations: edgeRows.length - kept.length,
        droppedFields: [...new Set(droppedFields)],
      };
    });
  } catch (e) {
    throw mapDbError(e);
  }
}

/** Soft-deletes an object; its live relations are soft-deleted with it by the database. */
export async function deleteObject(db: Db, owner: string, id: string): Promise<void> {
  try {
    await asOwner(db, owner, async (tx) => {
      const rows = await tx.query(
        "update public.objects set deleted_at = now() where id = $1 and deleted_at is null returning id",
        [id],
      );
      if (rows.length === 0) throw notFound();
    });
  } catch (e) {
    throw mapDbError(e);
  }
}
