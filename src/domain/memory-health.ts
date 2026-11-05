import { diffDays } from "./dates";
import type { MemoryRow } from "./memory-model";

/**
 * Memory health flags (ADR 0002 §22, brief §14): deterministic signals surfaced for the user to
 * review, never a decision Atlas makes for them. In particular, a "possible contradiction" is a
 * structural heuristic (same project, same type, overlapping tags) — a prompt to look, not a
 * verdict. Nothing here archives, merges or deletes anything.
 */

export type MemoryHealthKind =
  "duplicate" | "low_confidence" | "stale" | "orphaned" | "unused" | "possible_contradiction";

export interface MemoryHealthFlag {
  kind: MemoryHealthKind;
  memoryIds: string[];
}

const STALE_DAYS = 180;

const normalizedTitle = (r: MemoryRow): string =>
  r.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Pure, deterministic health analysis over the memories already in view (e.g. after filtering
 * to one project) — never over the whole graph implicitly, so it stays fast at any scale. */
export function analyzeMemoryHealth(rows: readonly MemoryRow[], today: string): MemoryHealthFlag[] {
  const live = rows.filter((r) => r.status !== "dropped");
  const flags: MemoryHealthFlag[] = [];

  // Duplicate: same type, near-identical title.
  const byTypeAndTitle = new Map<string, string[]>();
  for (const r of live) {
    const key = `${r.memoryType}:${normalizedTitle(r)}`;
    byTypeAndTitle.set(key, [...(byTypeAndTitle.get(key) ?? []), r.id]);
  }
  for (const ids of byTypeAndTitle.values())
    if (ids.length > 1) flags.push({ kind: "duplicate", memoryIds: ids });

  const lowConfidence = live
    .filter((r) => r.confidenceBand === "low" || r.confidenceBand === "unset")
    .map((r) => r.id);
  if (lowConfidence.length > 0) flags.push({ kind: "low_confidence", memoryIds: lowConfidence });

  const stale = live
    .filter((r) => diffDays(r.updatedAt.slice(0, 10), today) >= STALE_DAYS)
    .map((r) => r.id);
  if (stale.length > 0) flags.push({ kind: "stale", memoryIds: stale });

  const orphaned = live.filter((r) => r.relationshipCount === 0).map((r) => r.id);
  if (orphaned.length > 0) flags.push({ kind: "orphaned", memoryIds: orphaned });

  // "unused" (never retrieved, via memory_details.last_accessed_at) is deliberately not computed
  // here yet: nothing writes that column until the retrieval engine is wired to a real consumer
  // (ADR 0002 §7), so every memory would read as "unused" and the flag would be noise, not
  // signal. The kind stays in the union — the architecture is ready — and starts firing the
  // moment last_accessed_at carries real data, with no change needed here beyond reading it.

  // Possible contradiction: same primary project, same type, sharing a tag — a heuristic, never
  // a semantic judgement. Flagged in pairs so the user can compare them side by side.
  const contradictionIds = new Set<string>();
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i] as MemoryRow;
      const b = live[j] as MemoryRow;
      if (a.memoryType !== b.memoryType) continue;
      if (!a.primary || !b.primary || a.primary.id !== b.primary.id) continue;
      if (!a.tags.some((t) => b.tags.includes(t))) continue;
      if (a.id === b.id) continue;
      contradictionIds.add(a.id);
      contradictionIds.add(b.id);
    }
  }
  if (contradictionIds.size > 0)
    flags.push({ kind: "possible_contradiction", memoryIds: [...contradictionIds] });

  return flags;
}
