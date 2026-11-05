import type { FocusSession } from "./timer";

/** Minutes of focus in a range of days (inclusive, `YYYY-MM-DD`). */
export function focusMinutes(
  sessions: readonly Pick<FocusSession, "day" | "minutes">[],
  from: string,
  to: string,
): number {
  return sessions.reduce((n, s) => (s.day >= from && s.day <= to ? n + s.minutes : n), 0);
}

/** "6 h 40", "45 min", "0 min". */
export function formatFocus(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** How dark a day's square is, 0–4, from the number of advances. */
export function monthLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  return count <= 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : count <= 8 ? 3 : 4;
}

/** Every day of the month that contains `day`, Monday-first padding in front as `null`. */
export function monthCells(day: string): (string | null)[] {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`),
  ];
}
