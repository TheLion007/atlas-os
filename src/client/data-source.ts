import type {
  ActivityEntry,
  ApiEdge,
  ApiObject,
  ApiObjectWithRelations,
  AppSettings,
  ConvertTypeResult,
  DeleteReceipt,
  GraphPayload,
  NewRelation,
  ObjectPatch,
  ProgressEntry,
  ReattachEdge,
} from "@/domain/api-types";
import type { ObjectType } from "@/domain/enums";
import type { CreateEdgeInput, CreateObjectInput } from "@/domain/schemas";

/**
 * Everything the UI reads, as one interface. The HTTP API implements it for real use; a
 * dev-only in-memory source implements it over the fixture data. Components and hooks
 * depend on this interface only, so they cannot tell the difference and there is no second
 * data model.
 */
export interface AtlasDataSource {
  mode: "api" | "fixtures";
  /** The calendar date the UI treats as today (fixtures pin it so the demo is stable). */
  today(): string;
  /** The instant the UI treats as now, for "5 min ago" wording. */
  now(): Date;
  /** Every live object (with details) and relation. The lenses are projections of this. */
  graph(): Promise<GraphPayload>;
  /** One object with its relations grouped by verb. */
  object(id: string): Promise<ApiObjectWithRelations>;
  activity(limit?: number): Promise<ActivityEntry[]>;
  /** The work journal of the last `days` days: tasks finished, notes written, files added. */
  progress(days?: number): Promise<ProgressEntry[]>;
  settings(): Promise<AppSettings>;

  /**
   * Writes go through the same rules as the API: schema validation, the edge matrix, cycles and
   * single parents. `createObject` creates the object and its relations together.
   */
  createObject(
    input: CreateObjectInput,
    relations?: NewRelation[],
  ): Promise<ApiObjectWithRelations>;
  updateObject(id: string, patch: ObjectPatch): Promise<ApiObject>;
  /** Changes an object's category (project/sub_project/plan only). `type` is immutable, so this
   *  creates a new object and archives the original — see the result for what did not carry over. */
  convertObjectType(id: string, type: ObjectType): Promise<ConvertTypeResult>;
  deleteObject(id: string): Promise<void>;
  /**
   * Deletes several objects in one step (a project and what it holds), optionally creating the
   * edges that keep what stays attached to a parent. Nothing is left pointing at a deleted
   * object. The receipt undoes it (`restoreMany`) or makes it final (`purgeMany`).
   */
  deleteMany(input: { ids: string[]; reattach?: ReattachEdge[] }): Promise<DeleteReceipt>;
  /** Undoes a `deleteMany`: the objects, their relations and the edges it created are put back. */
  restoreMany(receipt: DeleteReceipt): Promise<void>;
  /**
   * Makes a deletion final: removes the objects for good and frees the bytes of their documents.
   * With `staleDocuments`, also frees documents deleted a while ago (an undo delay cut short by
   * closing the app).
   */
  purgeMany(input: { ids?: string[]; staleDocuments?: boolean }): Promise<void>;
  createEdge(input: CreateEdgeInput): Promise<ApiEdge>;
  deleteEdge(id: string): Promise<void>;

  /**
   * Files. A document object holds a file's metadata; the bytes live in a file store, addressed
   * by `storagePath`. `uploadFile` only stores the bytes — the caller then creates (or updates)
   * the document object, so a file is never an object of its own.
   */
  uploadFile(file: File): Promise<StoredFile>;
  /** A URL the browser can open or embed, or `null` when the file is not available here. */
  fileUrl(storagePath: string): string | null;
  /** Removes a stored file (used to clean up when creating its document fails). */
  deleteFile(storagePath: string): Promise<void>;
}

/** What the file store returns for an upload. */
export interface StoredFile {
  storagePath: string;
  sizeBytes: number;
  mime: string;
  /** SHA-256 of the bytes, hex. */
  checksum: string;
}

/** SHA-256 of a file, hex — the same digest the server computes. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export { MAX_FILE_BYTES, storagePathFor } from "@/domain/documents";
export class DataSourceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DataSourceError";
  }
}
