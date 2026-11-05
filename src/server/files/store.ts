import { createHash, randomUUID } from "node:crypto";
import { asOwner, type Db } from "../db/types";
import { MAX_FILE_BYTES, storagePathFor } from "@/domain/documents";
import { ApiError } from "../errors";

export { MAX_FILE_BYTES };

/**
 * Where document files live. The document *object* (metadata, relations, search) is on the
 * spine; this only stores and returns bytes, addressed by the document's `storagePath`.
 *
 * The default store keeps bytes in the owner-only `document_files` table, so uploads work with
 * nothing but the database already configured. Any object store (Supabase Storage, S3…) can
 * implement the same interface and replace it in `getFileStore()` without touching the API,
 * the documents or the UI.
 */
export interface StoredFileInfo {
  storagePath: string;
  sizeBytes: number;
  mime: string;
  checksum: string;
}

export interface FileStore {
  put(
    owner: string,
    file: { name: string; mime: string; bytes: Uint8Array },
  ): Promise<StoredFileInfo>;
  get(owner: string, storagePath: string): Promise<{ mime: string; bytes: Uint8Array } | null>;
  remove(owner: string, storagePath: string): Promise<void>;
}

export function createDbFileStore(db: Db): FileStore {
  return {
    async put(owner, file) {
      if (file.bytes.byteLength > MAX_FILE_BYTES)
        throw new ApiError(413, "too_large", "This file is larger than 25 MB.");
      const storagePath = storagePathFor(randomUUID(), file.name);
      const checksum = createHash("sha256").update(file.bytes).digest("hex");
      const mime = file.mime.trim() || "application/octet-stream";
      await asOwner(db, owner, (tx) =>
        tx.query(
          `insert into public.document_files (storage_path, mime, size_bytes, checksum, bytes)
           values ($1, $2, $3, $4, $5)`,
          [storagePath, mime.slice(0, 120), file.bytes.byteLength, checksum, file.bytes],
        ),
      );
      return { storagePath, sizeBytes: file.bytes.byteLength, mime, checksum };
    },

    async get(owner, storagePath) {
      const rows = await asOwner(db, owner, (tx) =>
        tx.query<{ mime: string; bytes: Uint8Array }>(
          "select mime, bytes from public.document_files where storage_path = $1",
          [storagePath],
        ),
      );
      const row = rows[0];
      return row ? { mime: row.mime, bytes: new Uint8Array(row.bytes) } : null;
    },

    async remove(owner, storagePath) {
      await asOwner(db, owner, (tx) =>
        tx.query("delete from public.document_files where storage_path = $1", [storagePath]),
      );
    },
  };
}

/**
 * The response headers for serving a stored file. Only formats a browser renders harmlessly are
 * shown inline (PDF, raster images, plain text — text always as `text/plain`); everything else,
 * including HTML and SVG, is a download, so an uploaded file can never run script on this origin.
 */
export function servingHeaders(mime: string, name: string): Record<string, string> {
  const m = mime.toLowerCase();
  const inline =
    m === "application/pdf" ||
    (m.startsWith("image/") && m !== "image/svg+xml") ||
    m.startsWith("text/") ||
    m === "application/json";
  const contentType =
    m.startsWith("text/") || m === "application/json" ? "text/plain; charset=utf-8" : m;
  const filename = encodeURIComponent(name);
  return {
    "content-type": inline ? contentType : "application/octet-stream",
    "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
    "x-content-type-options": "nosniff",
    "content-security-policy":
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    "cache-control": "private, max-age=300",
  };
}
