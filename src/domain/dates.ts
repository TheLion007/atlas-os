/**
 * Calendar-date helpers on ISO `YYYY-MM-DD` strings, computed in UTC so results never depend on
 * the machine's time zone or on "now". The domain layer never reads the clock.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const back = new Date(Date.UTC(y, mo - 1, d));
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d;
}

function toMs(value: string): number {
  if (!isValidIsoDate(value)) throw new RangeError(`Invalid ISO date: ${value}`);
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function addDays(value: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`Day offset must be an integer: ${days}`);
  return new Date(toMs(value) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / MS_PER_DAY);
}

export function maxDate(a: string, b: string): string {
  return toMs(a) >= toMs(b) ? a : b;
}
