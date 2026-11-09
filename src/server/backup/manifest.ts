import type { PGlite } from "@electric-sql/pglite";

/**
 * What a `.atlasbackup` is: a zip (renamed) holding
 *   manifest.json                what it is, from where, and how much of everything
 *   database/pgdata.tar.gz       the whole database: projects, tasks, notes, work history, settings
 *                                and the documents of the Vault with their files
 *   preferences.json             the interface preferences: theme, sounds, mascot, timer, assistant
 *   documents/<name>             a readable copy of every Vault file, openable without the app
 *
 * `format` is the layout above. A newer format is refused; an older one is upgraded by the
 * functions in UPGRADES (none yet: version 1 is the first). The database inside carries its own
 * schema level, brought up to date by the migrations when it is opened.
 */
export const BACKUP_FORMAT = 1;
export const BACKUP_EXTENSION = ".atlasbackup";
export const DATABASE_ENTRY = "database/pgdata.tar.gz";
export const PREFS_ENTRY = "preferences.json";
export const MANIFEST_ENTRY = "manifest.json";

export interface BackupCounts {
  plans: number;
  projects: number;
  subProjects: number;
  tasks: number;
  milestones: number;
  decisions: number;
  risks: number;
  notes: number;
  documents: number;
  budgets: number;
  events: number;
  others: number;
  /** Relations between items. */
  links: number;
  /** Entries of the work history (the squares). */
  workHistory: number;
  /** Bytes of Vault files. */
  documentBytes: number;
  /** Interface preference entries kept in preferences.json. */
  preferences: number;
}

export interface BackupManifest {
  format: number;
  app: "Atlas OS";
  appVersion: string;
  /** The newest migration the database had when it was exported (a 14-digit stamp). */
  schemaVersion: string;
  exportedAt: string;
  device: string;
  kind: "manual" | "auto" | "safety";
  counts: BackupCounts;
  /** SHA-256 (hex) of database/pgdata.tar.gz, to catch a damaged file before importing. */
  databaseSha256: string;
}

const TYPE_KEY: Record<string, keyof BackupCounts> = {
  plan: "plans",
  project: "projects",
  sub_project: "subProjects",
  task: "tasks",
  milestone: "milestones",
  decision: "decisions",
  risk: "risks",
  note: "notes",
  document: "documents",
  estimate: "budgets",
  event: "events",
};

export const emptyCounts = (): BackupCounts => ({
  plans: 0,
  projects: 0,
  subProjects: 0,
  tasks: 0,
  milestones: 0,
  decisions: 0,
  risks: 0,
  notes: 0,
  documents: 0,
  budgets: 0,
  events: 0,
  others: 0,
  links: 0,
  workHistory: 0,
  documentBytes: 0,
  preferences: 0,
});

/** How much of everything a database holds (live items only; deleted ones do not count). */
export async function countDatabase(pg: Pick<PGlite, "query">): Promise<BackupCounts> {
  const counts = emptyCounts();
  const types = await pg.query<{ type: string; n: number }>(
    "select type::text as type, count(*)::int as n from public.objects where deleted_at is null group by type",
  );
  for (const r of types.rows) counts[TYPE_KEY[r.type] ?? "others"] += r.n;
  counts.links = (
    await pg.query<{ n: number }>(
      "select count(*)::int as n from public.edges where deleted_at is null",
    )
  ).rows[0]!.n;
  counts.workHistory = (
    await pg.query<{ n: number }>("select count(*)::int as n from public.progress_log")
  ).rows[0]!.n;
  counts.documentBytes = Number(
    (
      await pg.query<{ n: string | number }>(
        "select coalesce(sum(size_bytes), 0) as n from public.document_files",
      )
    ).rows[0]!.n,
  );
  return counts;
}

/** The total number of items a count holds (what a person thinks of as "elements"). */
export const itemTotal = (c: BackupCounts): number =>
  c.plans +
  c.projects +
  c.subProjects +
  c.tasks +
  c.milestones +
  c.decisions +
  c.risks +
  c.notes +
  c.documents +
  c.budgets +
  c.events +
  c.others;

/** Upgrades an older manifest layout to the current one (none to upgrade yet). */
const UPGRADES: Record<number, (m: Record<string, unknown>) => Record<string, unknown>> = {};

export function parseManifest(raw: unknown): BackupManifest | null {
  if (typeof raw !== "object" || raw === null) return null;
  let m = raw as Record<string, unknown>;
  let format = Number(m.format);
  if (!Number.isInteger(format) || format < 1) return null;
  while (format < BACKUP_FORMAT && UPGRADES[format]) {
    m = UPGRADES[format]!(m);
    format = Number(m.format);
  }
  if (
    m.app !== "Atlas OS" ||
    typeof m.exportedAt !== "string" ||
    typeof m.databaseSha256 !== "string"
  )
    return null;
  const counts = { ...emptyCounts(), ...((m.counts as Partial<BackupCounts>) ?? {}) };
  return {
    format,
    app: "Atlas OS",
    appVersion: String(m.appVersion ?? "?"),
    schemaVersion: String(m.schemaVersion ?? "0"),
    exportedAt: m.exportedAt,
    device: String(m.device ?? "?"),
    kind: m.kind === "auto" || m.kind === "safety" ? m.kind : "manual",
    counts,
    databaseSha256: m.databaseSha256,
  };
}
