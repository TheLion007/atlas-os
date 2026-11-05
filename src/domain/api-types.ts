import type { EdgeKind, LifecycleStatus, ObjectType, ScenarioVariant } from "./enums";

/**
 * The shapes the HTTP API returns. They live in the domain layer (pure types, no I/O) so the
 * server produces them and the UI consumes them from one definition: the UI never invents a
 * second data model. Derived values (progress, risk level, slip, blocked) are deliberately
 * absent; they are computed from these shapes by `domain/engine`.
 */

export interface ApiObject {
  id: string;
  type: ObjectType;
  title: string;
  status: LifecycleStatus;
  tags: string[];
  confidence: number | null;
  /** A design-token key (never a raw hex), or `null`. Only project/sub_project may set one
   * at launch (ADR 0002 §5) — the column is generic on the spine so that can widen later. */
  color: string | null;
  createdAt: string;
  updatedAt: string;
  /** Type-specific fields, camelCase. Present on single reads and type-filtered lists. */
  details?: Record<string, unknown>;
}

export interface RelationItem {
  edgeId: string;
  label: string | null;
  dependencyType: string | null;
  lagDays: number | null;
  object: { id: string; type: ObjectType; title: string; status: LifecycleStatus };
}

/** Relations are always grouped by edge verb, never a flat "linked items" list. */
export type RelationGroups = Record<
  EdgeKind,
  { outgoing: RelationItem[]; incoming: RelationItem[] }
>;

export interface ApiObjectWithRelations extends ApiObject {
  relations: RelationGroups;
}

export interface ObjectPage {
  items: ApiObject[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  label: string | null;
  dependencyType: string | null;
  lagDays: number | null;
  createdAt: string;
}

/** The whole live dataset: every object (with details on request) and every relation. */
export interface GraphPayload {
  nodes: ApiObject[];
  edges: ApiEdge[];
}

export type ActivityAction =
  "created" | "updated" | "deleted" | "restored" | "purged" | "related" | "unrelated";

export interface ActivityEntry {
  id: number;
  action: ActivityAction;
  at: string;
  objectId: string | null;
  edgeId: string | null;
  /** Present while the object still exists. */
  object: { type: ObjectType; title: string } | null;
  /** For updates: `{ field: { from, to } }`. */
  diff: Record<string, unknown>;
}

/** What counts as progress in the work journal. */
export type ProgressKind = "task_done" | "note_created" | "file_added";

/** One piece of progress: its day, the project it counts for, and what kind it was. */
export interface ProgressEntry {
  id: number;
  at: string;
  /** The calendar day (YYYY-MM-DD, UTC) it counts for. */
  day: string;
  projectId: string | null;
  objectId: string | null;
  kind: ProgressKind;
}

export interface FxRate {
  from: string;
  to: string;
  rate: number;
  asOf: string;
  source: string;
}

export interface AppSettings {
  /** `null` until the owner chooses one: there is no default currency. */
  baseCurrency: string | null;
  activeScenario: ScenarioVariant;
  timelineStart: string | null;
  timelineEnd: string | null;
  /** Manually maintained, each with its source. Never fetched or invented. */
  fxRates: FxRate[];
}

/** A relation created together with a new object. `in`: the new object is the target. */
export interface NewRelation {
  kind: EdgeKind;
  direction: "in" | "out";
  other: string;
  label?: string | null;
}

/**
 * A user tag from the catalogue (`tags` table). System tags (#project, #task, ...) are a
 * presentational alias over `object.type` and are never rows here (ADR 0002 §4).
 */
export interface ApiTag {
  id: string;
  name: string;
  kind: "system" | "user";
  color: string | null;
  createdAt: string;
}

/** A partial update: only the given fields change; `type` never does. */
export interface ObjectPatch {
  title?: string;
  status?: LifecycleStatus;
  tags?: string[];
  confidence?: number | null;
  color?: string | null;
  details?: Record<string, unknown>;
}

/** The outcome of changing an object's category (see `convertObjectType`): a new object, since
 *  `type` is immutable, plus what could not carry over from the original. */
export interface ConvertTypeResult {
  object: ApiObjectWithRelations;
  droppedRelations: number;
  droppedFields: string[];
}

/** An edge to create in the same step as a deletion, so what stays attached keeps a parent. */
export interface ReattachEdge {
  kind: "contains" | "references";
  from: string;
  to: string;
}

/** What deleting several objects at once did: enough to undo it, and to make it final. */
export interface DeleteReceipt {
  objectIds: string[];
  /** The live edges that went with the objects (revived by a restore). */
  edgeIds: string[];
  /** The edges created to keep what stays attached (removed by a restore). */
  addedEdgeIds: string[];
  /** The documents among the objects: their files are freed when the deletion becomes final. */
  documents: { id: string; storagePath: string | null }[];
  /** The in-memory demo source keeps copies here to restore from; the API never sets it. */
  snapshot?: { nodes: ApiObject[]; edges: ApiEdge[]; progress: ProgressEntry[] };
}
