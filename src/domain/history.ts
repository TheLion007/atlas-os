import type { ProgressEntry } from "./api-types";

/**
 * The Work History, derived from the progress journal: a grid of days (one square each), how
 * the work spreads over projects, runs of consecutive days and personal records. Pure functions
 * over the journal; nothing here is stored.
 */

const MS_DAY = 86_400_000;

export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Monday = 0 … Sunday = 6. */
export const weekdayOf = (iso: string): number =>
  (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7;

const inScope = (e: ProgressEntry, projectId?: string | null): boolean =>
  projectId === undefined || projectId === null || e.projectId === projectId;

/** Progress per day, optionally for one project. */
export function dayCounts(
  entries: readonly ProgressEntry[],
  projectId?: string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) if (inScope(e, projectId)) out.set(e.day, (out.get(e.day) ?? 0) + 1);
  return out;
}

export type Level = 0 | 1 | 2 | 3 | 4;

/** How dark a square is: relative to the busiest day, in four steps above "nothing". */
export function levelOf(count: number, max: number): Level {
  if (count <= 0 || max <= 0) return 0;
  const r = count / max;
  return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4;
}

export interface GridCell {
  day: string;
  count: number;
  level: Level;
  /** After today: drawn faint and not interactive. */
  future: boolean;
  isToday: boolean;
}

export interface YearGrid {
  /** One column per week (Monday first), seven cells each. */
  columns: GridCell[][];
  /** Where a month starts: the column it first appears in, and its month number (0–11). */
  months: { column: number; month: number }[];
  max: number;
}

/** The last `weeks` weeks ending with the current one, as a grid of days. */
export function yearGrid(
  entries: readonly ProgressEntry[],
  today: string,
  weeks = 53,
  projectId?: string | null,
): YearGrid {
  const counts = dayCounts(entries, projectId);
  const monday = addDays(today, -weekdayOf(today));
  const start = addDays(monday, -(weeks - 1) * 7);
  let max = 0;
  for (const [day, n] of counts) if (day >= start && day <= today) max = Math.max(max, n);
  const columns: GridCell[][] = [];
  const months: YearGrid["months"] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const col: GridCell[] = [];
    for (let d = 0; d < 7; d++) {
      const day = addDays(start, w * 7 + d);
      const count = counts.get(day) ?? 0;
      col.push({
        day,
        count,
        level: levelOf(count, max),
        future: day > today,
        isToday: day === today,
      });
    }
    columns.push(col);
    const month = new Date(`${(col[0] as GridCell).day}T12:00:00Z`).getUTCMonth();
    if (month !== lastMonth) {
      months.push({ column: w, month });
      lastMonth = month;
    }
  }
  // A month label needs about three columns of room: drop one that the next month would cover.
  const spaced = months.filter(
    (m, i) =>
      i === months.length - 1 || (months[i + 1] as { column: number }).column - m.column >= 3,
  );
  return { columns, months: spaced, max };
}

export interface Streaks {
  /** Days in a row ending today (or yesterday, while today is still empty). */
  current: number;
  longest: number;
  /** The last day of the longest run. */
  longestEnd: string | null;
}

export function streaks(entries: readonly ProgressEntry[], today: string): Streaks {
  const days = [...new Set(entries.map((e) => e.day))].sort();
  let longest = 0;
  let longestEnd: string | null = null;
  let run = 0;
  let prev: string | null = null;
  for (const day of days) {
    run =
      prev !== null && Math.round((Date.parse(day) - Date.parse(prev)) / MS_DAY) === 1
        ? run + 1
        : 1;
    if (run > longest) {
      longest = run;
      longestEnd = day;
    }
    prev = day;
  }
  const set = new Set(days);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (set.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest, longestEnd };
}

export function bestDay(
  entries: readonly ProgressEntry[],
  projectId?: string | null,
): { day: string; count: number } | null {
  let best: { day: string; count: number } | null = null;
  for (const [day, count] of dayCounts(entries, projectId))
    if (!best || count > best.count || (count === best.count && day > best.day))
      best = { day, count };
  return best;
}

/** The busiest Monday-to-Sunday week. */
export function bestWeek(
  entries: readonly ProgressEntry[],
  projectId?: string | null,
): { start: string; count: number } | null {
  const weeks = new Map<string, number>();
  for (const e of entries) {
    if (!inScope(e, projectId)) continue;
    const start = addDays(e.day, -weekdayOf(e.day));
    weeks.set(start, (weeks.get(start) ?? 0) + 1);
  }
  let best: { start: string; count: number } | null = null;
  for (const [start, count] of weeks)
    if (!best || count > best.count || (count === best.count && start > best.start))
      best = { start, count };
  return best;
}

export interface ProjectShare {
  projectId: string | null;
  count: number;
}

/** How the work spreads over projects, biggest first (entries with no project last). */
export function byProject(entries: readonly ProgressEntry[], since?: string): ProjectShare[] {
  const out = new Map<string | null, number>();
  for (const e of entries) {
    if (since && e.day < since) continue;
    out.set(e.projectId, (out.get(e.projectId) ?? 0) + 1);
  }
  return [...out.entries()]
    .map(([projectId, count]) => ({ projectId, count }))
    .sort((a, b) => (a.projectId === null ? 1 : b.projectId === null ? -1 : b.count - a.count));
}

/** What happened on one day, newest first. */
export function entriesOn(
  entries: readonly ProgressEntry[],
  day: string,
  projectId?: string | null,
): ProgressEntry[] {
  return entries
    .filter((e) => e.day === day && inScope(e, projectId))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
}

export function activeDays(entries: readonly ProgressEntry[], since?: string): number {
  return new Set(entries.filter((e) => !since || e.day >= since).map((e) => e.day)).size;
}
