import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { livePglite, localDbDir } from "../db/pglite";
import { exportBackup, type ExportOptions } from "./export";
import { BackupError, openBackupDatabase, readBackupFile } from "./load";
import { mergeBackup, type MergeSummary } from "./merge";
import type { BackupManifest } from "./manifest";

/** One export or import at a time, with a state the page polls to draw its progress bar. */
export interface JobState {
  id: number;
  kind: "export" | "import";
  status: "running" | "done" | "error";
  phase: string;
  percent: number;
  result?: JobResult;
  error?: { code: string; message: string };
}

export interface JobResult {
  path?: string;
  bytes?: number;
  manifest?: BackupManifest;
  mode?: "replace" | "merge";
  /** The automatic copy of the current data made just before importing. */
  safetyBackup?: string;
  /** Replace: the new data is ready and takes over at the next start. */
  needsRestart?: boolean;
  summary?: MergeSummary;
}

const g = globalThis as unknown as { __atlasBackupJob?: JobState; __atlasBackupSeq?: number };

export const currentJob = (): JobState | null => g.__atlasBackupJob ?? null;

export const deviceName = (): string => process.env.ATLAS_DEVICE_NAME || hostname();
export const appVersion = (): string => process.env.ATLAS_APP_VERSION || "dev";
export const dataRoot = (): string => process.env.ATLAS_DATA_ROOT || join(localDbDir(), "..", "..");

const pad = (n: number) => String(n).padStart(2, "0");
export const dayStamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeStamp = (d = new Date()) =>
  `${dayStamp(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export const safetyBackupPath = (root: string, d = new Date()) =>
  join(root, "sauvegardes", "securite", `AtlasOS-securite-${timeStamp(d)}.atlasbackup`);

function begin(kind: JobState["kind"]): JobState {
  if (g.__atlasBackupJob?.status === "running")
    throw new BackupError("unreadable_file", "Another backup or import is already running.");
  const job: JobState = {
    id: (g.__atlasBackupSeq = (g.__atlasBackupSeq ?? 0) + 1),
    kind,
    status: "running",
    phase: "start",
    percent: 0,
  };
  g.__atlasBackupJob = job;
  return job;
}

const fail = (job: JobState, e: unknown) => {
  job.status = "error";
  job.error =
    e instanceof BackupError
      ? { code: e.code, message: e.message }
      : { code: "failed", message: (e as Error)?.message ?? String(e) };
};

export interface ExportArgs {
  path: string;
  prefs?: Record<string, string>;
  kind?: ExportOptions["kind"];
}

/** Starts an export in the background; the page polls `currentJob()`. */
export function startExport(args: ExportArgs): JobState {
  const job = begin("export");
  void (async () => {
    try {
      const pg = await livePglite();
      const r = await exportBackup(
        pg,
        {
          outPath: args.path,
          device: deviceName(),
          appVersion: appVersion(),
          prefs: args.prefs,
          kind: args.kind,
        },
        (phase, percent) => {
          job.phase = phase;
          job.percent = percent;
        },
      );
      job.result = { path: r.path, bytes: r.bytes, manifest: r.manifest };
      job.status = "done";
      job.percent = 100;
    } catch (e) {
      fail(job, e);
    }
  })();
  return job;
}

export interface ImportArgs {
  path: string;
  mode: "replace" | "merge";
  /** The current interface preferences, kept in the automatic safety copy. */
  prefs?: Record<string, string>;
}

/**
 * Imports a backup. First a safety copy of the current data is written; then either the data is
 * merged in (one transaction: all or nothing), or the new data is staged for the next start,
 * where the desktop shell swaps it in and puts the old data back if it does not come up.
 */
export function startImport(args: ImportArgs): JobState {
  const job = begin("import");
  void (async () => {
    try {
      const root = dataRoot();
      const pg = await livePglite();
      job.phase = "check";
      const loaded = readBackupFile(args.path); // validates before anything is touched
      job.phase = "safety";
      const safety = safetyBackupPath(root);
      await exportBackup(
        pg,
        {
          outPath: safety,
          device: deviceName(),
          appVersion: appVersion(),
          prefs: args.prefs,
          kind: "safety",
        },
        (_p, percent) => {
          job.percent = Math.round(percent * 0.4);
        },
      );
      job.percent = 40;
      if (args.mode === "merge") {
        job.phase = "open";
        const backup = await openBackupDatabase(loaded);
        try {
          const summary = await mergeBackup(pg, backup, (phase, percent) => {
            job.phase = phase;
            job.percent = 45 + Math.round(percent * 0.5);
          });
          job.result = { mode: "merge", safetyBackup: safety, summary };
        } finally {
          await backup.close().catch(() => undefined);
        }
      } else {
        job.phase = "stage";
        const staging = `${localDbDir()}.import-staging`;
        rmSync(staging, { recursive: true, force: true });
        mkdirSync(root, { recursive: true });
        mkdirSync(dirname(staging), { recursive: true });
        const db = await openBackupDatabase(loaded, staging);
        await db.close();
        const pending = join(root, "pending-import.json");
        writeFileSync(
          `${pending}.part`,
          JSON.stringify(
            {
              staging,
              createdAt: new Date().toISOString(),
              safetyBackup: safety,
              prefs: loaded.prefs,
              source: { device: loaded.manifest.device, exportedAt: loaded.manifest.exportedAt },
            },
            null,
            2,
          ),
        );
        renameSync(`${pending}.part`, pending);
        job.result = { mode: "replace", safetyBackup: safety, needsRestart: true };
      }
      job.status = "done";
      job.percent = 100;
    } catch (e) {
      fail(job, e);
    }
  })();
  return job;
}
