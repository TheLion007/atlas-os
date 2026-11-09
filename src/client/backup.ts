"use client";

/**
 * Export and import, as the page sees them: the desktop shell chooses the files (native dialogs),
 * the local server does the work and reports its progress, which the page polls.
 */
import type { BackupCounts } from "@/server/backup/manifest";

export type { BackupCounts };

export interface BackupManifestView {
  appVersion: string;
  exportedAt: string;
  device: string;
  kind: "manual" | "auto" | "safety";
  counts: BackupCounts;
}

export type InspectResult =
  | {
      ok: true;
      manifest: BackupManifestView;
      counts: BackupCounts;
      fileBytes: number;
      migrated: boolean;
    }
  | { ok: false; code: string; message: string };

export interface MergeSummaryView {
  itemsAdded: number;
  itemsUpdated: number;
  itemsKept: number;
  skipped: number;
}

export interface JobView {
  id: number;
  kind: "export" | "import";
  status: "running" | "done" | "error";
  phase: string;
  percent: number;
  result?: {
    path?: string;
    bytes?: number;
    manifest?: BackupManifestView;
    mode?: "replace" | "merge";
    safetyBackup?: string;
    needsRestart?: boolean;
    summary?: MergeSummaryView;
  };
  error?: { code: string; message: string };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { code: string; message: string } };
  if (!res.ok && json.error)
    throw Object.assign(new Error(json.error.message), { code: json.error.code });
  return json;
}

export const inspectBackupFile = (path: string) =>
  post<InspectResult>("/api/backup/inspect", { path });
export const startExportJob = (path: string, prefs: Record<string, string>) =>
  post<JobView>("/api/backup/export", { path, prefs });
export const startImportJob = (
  path: string,
  mode: "replace" | "merge",
  prefs: Record<string, string>,
) => post<JobView>("/api/backup/import", { path, mode, prefs });

/** Polls the running job until it is done or has failed, calling `onProgress` on the way. */
export async function followJob(
  onProgress: (j: JobView) => void,
  intervalMs = 250,
): Promise<JobView> {
  for (;;) {
    const res = await fetch("/api/backup/status");
    const { job } = (await res.json()) as { job: JobView | null };
    if (job) {
      onProgress(job);
      if (job.status !== "running") return job;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** The interface preferences kept by this window (everything Atlas OS stores, but not its own sync marker). */
export function collectPrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("atlas") && !k.startsWith("atlas.sync"))
        out[k] = window.localStorage.getItem(k) ?? "";
    }
  } catch {
    /* storage blocked */
  }
  return out;
}
