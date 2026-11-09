import { createHash } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { latestSchemaVersion } from "../db/pglite";
import {
  BACKUP_FORMAT,
  DATABASE_ENTRY,
  MANIFEST_ENTRY,
  PREFS_ENTRY,
  countDatabase,
  type BackupManifest,
} from "./manifest";
import { buildZip, type ZipEntryInput } from "./zip";

export type ProgressFn = (phase: string, percent: number) => void;

export interface ExportOptions {
  outPath: string;
  device: string;
  appVersion: string;
  /** The interface preferences kept by the page (theme, sounds, mascot, timer, assistant…). */
  prefs?: Record<string, string>;
  kind?: BackupManifest["kind"];
  now?: Date;
}

const sanitize = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 120) || "document";

/** A readable name for each Vault file inside the backup, never twice the same. */
function documentNames(rows: { storage_path: string; original_name: string | null }[]): string[] {
  const used = new Set<string>();
  return rows.map((r) => {
    const base = sanitize(r.original_name || r.storage_path.split("/").pop() || "document");
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      const dot = base.lastIndexOf(".");
      name = dot > 0 ? `${base.slice(0, dot)} (${i})${base.slice(dot)}` : `${base} (${i})`;
    }
    used.add(name.toLowerCase());
    return `documents/${name}`;
  });
}

/**
 * Writes a `.atlasbackup`: the whole database (documents and their files included), a readable
 * copy of the Vault files, the preferences and a manifest. The file appears only when complete
 * (it is written beside its final name, then renamed), so a failure never leaves half a backup.
 */
export async function exportBackup(
  pg: PGlite,
  o: ExportOptions,
  progress: ProgressFn = () => undefined,
): Promise<{ path: string; bytes: number; manifest: BackupManifest }> {
  progress("count", 3);
  const counts = await countDatabase(pg);
  counts.preferences = Object.keys(o.prefs ?? {}).length;

  progress("database", 8);
  const dump = await pg.dumpDataDir("gzip");
  const dbBytes = Buffer.from(await dump.arrayBuffer());
  const databaseSha256 = createHash("sha256").update(dbBytes).digest("hex");

  progress("documents", 40);
  const files = await pg.query<{
    storage_path: string;
    bytes: Uint8Array;
    original_name: string | null;
  }>(
    `select f.storage_path, f.bytes, d.original_name
       from public.document_files f
       left join public.document_details d on d.storage_path = f.storage_path
       left join public.objects ob on ob.id = d.id and ob.deleted_at is null
      where d.id is null or ob.id is not null
      order by f.storage_path`,
  );
  const names = documentNames(files.rows);
  const entries: ZipEntryInput[] = [];
  files.rows.forEach((r, i) => {
    entries.push({ name: names[i]!, data: Buffer.from(r.bytes) });
  });
  progress("documents", 70);

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    app: "Atlas OS",
    appVersion: o.appVersion,
    schemaVersion: latestSchemaVersion(),
    exportedAt: (o.now ?? new Date()).toISOString(),
    device: o.device,
    kind: o.kind ?? "manual",
    counts,
    databaseSha256,
  };
  progress("zip", 78);
  const zip = buildZip([
    { name: MANIFEST_ENTRY, data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
    { name: DATABASE_ENTRY, data: dbBytes, compress: false },
    {
      name: PREFS_ENTRY,
      data: Buffer.from(
        JSON.stringify({ savedAt: manifest.exportedAt, keys: o.prefs ?? {} }, null, 2),
        "utf8",
      ),
    },
    ...entries,
  ]);
  progress("write", 92);
  mkdirSync(dirname(o.outPath), { recursive: true });
  const part = `${o.outPath}.part`;
  try {
    writeFileSync(part, zip);
    renameSync(part, o.outPath);
  } catch (e) {
    rmSync(part, { force: true });
    throw e;
  }
  progress("done", 100);
  return { path: o.outPath, bytes: zip.length, manifest };
}
