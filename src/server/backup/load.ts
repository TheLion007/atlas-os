import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { latestSchemaVersion, openDatabaseFromDump } from "../db/pglite";
import {
  BACKUP_FORMAT,
  DATABASE_ENTRY,
  MANIFEST_ENTRY,
  PREFS_ENTRY,
  countDatabase,
  parseManifest,
  type BackupCounts,
  type BackupManifest,
} from "./manifest";
import { ZipError, readZip } from "./zip";

/** Why a backup cannot be used, in a few codes the interface turns into plain sentences. */
export type BackupProblem =
  | "unreadable_file" // missing, locked, or not readable
  | "not_a_backup" // not a zip, or no manifest: not one of ours
  | "corrupt" // damaged: a checksum does not match
  | "newer_version" // made by a newer Atlas OS than this one
  | "unreadable_database"; // the database inside cannot be opened

export class BackupError extends Error {
  constructor(
    public readonly code: BackupProblem,
    message: string,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

export interface LoadedBackup {
  manifest: BackupManifest;
  prefs: { savedAt: string; keys: Record<string, string> };
  dump: Buffer;
  fileBytes: number;
  /** Its database is older than this version and will be brought up to date when opened. */
  needsMigration: boolean;
}

/** Reads and checks a `.atlasbackup` file without opening its database. */
export function readBackupFile(path: string): LoadedBackup {
  let buf: Buffer;
  try {
    if (statSync(path).size === 0) throw new BackupError("not_a_backup", "The file is empty.");
    buf = readFileSync(path);
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError("unreadable_file", "The file cannot be read.");
  }
  try {
    const zip = readZip(buf);
    if (!zip.has(MANIFEST_ENTRY) || !zip.has(DATABASE_ENTRY))
      throw new BackupError("not_a_backup", "This is not an Atlas OS backup.");
    let raw: unknown;
    try {
      raw = JSON.parse(zip.read(MANIFEST_ENTRY).toString("utf8"));
    } catch (e) {
      if (e instanceof ZipError) throw e;
      throw new BackupError("not_a_backup", "This is not an Atlas OS backup.");
    }
    const manifest = parseManifest(raw);
    if (!manifest) throw new BackupError("not_a_backup", "This is not an Atlas OS backup.");
    if (manifest.format > BACKUP_FORMAT || manifest.schemaVersion > latestSchemaVersion())
      throw new BackupError(
        "newer_version",
        `This backup was made by Atlas OS ${manifest.appVersion}, which is newer than this version.`,
      );
    const dump = zip.read(DATABASE_ENTRY);
    if (createHash("sha256").update(dump).digest("hex") !== manifest.databaseSha256)
      throw new BackupError("corrupt", "The database inside the backup is damaged.");
    let prefs: LoadedBackup["prefs"] = { savedAt: manifest.exportedAt, keys: {} };
    if (zip.has(PREFS_ENTRY)) {
      try {
        const p = JSON.parse(zip.read(PREFS_ENTRY).toString("utf8")) as {
          savedAt?: string;
          keys?: Record<string, unknown>;
        };
        const keys: Record<string, string> = {};
        for (const [k, v] of Object.entries(p.keys ?? {})) if (typeof v === "string") keys[k] = v;
        prefs = { savedAt: p.savedAt ?? manifest.exportedAt, keys };
      } catch {
        /* damaged preferences are not worth refusing the whole backup for */
      }
    }
    return {
      manifest,
      prefs,
      dump,
      fileBytes: buf.length,
      needsMigration: manifest.schemaVersion < latestSchemaVersion(),
    };
  } catch (e) {
    if (e instanceof BackupError) throw e;
    if (e instanceof ZipError)
      throw new BackupError(
        e.code === "not_zip" ? "not_a_backup" : "corrupt",
        e.code === "not_zip" ? "This is not an Atlas OS backup." : "The backup file is damaged.",
      );
    throw e;
  }
}

/** Opens the database of a loaded backup in memory, migrated to this version. */
export async function openBackupDatabase(b: LoadedBackup, dir?: string): Promise<PGlite> {
  try {
    return await openDatabaseFromDump(new Blob([new Uint8Array(b.dump)]), dir);
  } catch (e) {
    throw new BackupError(
      "unreadable_database",
      `The database inside the backup cannot be opened: ${(e as Error).message}`,
    );
  }
}

export interface InspectOk {
  ok: true;
  manifest: BackupManifest;
  /** Counted from the database itself, not taken on trust from the manifest. */
  counts: BackupCounts;
  fileBytes: number;
  migrated: boolean;
  preferences: number;
}
export interface InspectFailed {
  ok: false;
  code: BackupProblem;
  message: string;
}

/** Everything the person needs to see before importing: validity, version, and what is inside. */
export async function inspectBackup(path: string): Promise<InspectOk | InspectFailed> {
  try {
    const b = readBackupFile(path);
    const db = await openBackupDatabase(b);
    try {
      const counts = await countDatabase(db);
      counts.preferences = Object.keys(b.prefs.keys).length;
      return {
        ok: true,
        manifest: b.manifest,
        counts,
        fileBytes: b.fileBytes,
        migrated: b.needsMigration,
        preferences: counts.preferences,
      };
    } finally {
      await db.close().catch(() => undefined);
    }
  } catch (e) {
    if (e instanceof BackupError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: "corrupt", message: (e as Error).message };
  }
}
