import { isValidIsoDate } from "@/domain/dates";

/**
 * Display formatting. Nothing here knows about a particular currency or country: currencies are
 * data, and the locale only shapes digits and month names. Numbers are always rendered with the
 * `num` class (mono, tabular) by the caller.
 */
export const DEFAULT_LOCALE = "en-GB";

export function formatMoney(
  amount: number,
  currency: string,
  opts: { locale?: string; compact?: boolean } = {},
): string {
  return new Intl.NumberFormat(opts.locale ?? DEFAULT_LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: opts.compact ? 1 : 0,
    notation: opts.compact ? "compact" : "standard",
  }).format(amount);
}

export function formatNumber(value: number, opts: { locale?: string; digits?: number } = {}) {
  return new Intl.NumberFormat(opts.locale ?? DEFAULT_LOCALE, {
    maximumFractionDigits: opts.digits ?? 0,
  }).format(value);
}

/** 0.4286 → "43%". `null` (no data) is never rendered as 0%. */
export function formatPercent(fraction: number | null, locale = DEFAULT_LOCALE): string {
  if (fraction === null) return "—";
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
    fraction,
  );
}

/** A signed change, e.g. "+12" / "−4" (true minus sign). */
export function formatDelta(
  value: number,
  opts: { digits?: number; locale?: string } = {},
): string {
  const abs = Math.abs(value).toLocaleString(opts.locale ?? DEFAULT_LOCALE, {
    maximumFractionDigits: opts.digits ?? 0,
  });
  if (value === 0) return abs;
  return `${value > 0 ? "+" : "−"}${abs}`;
}

/** "2026-09-21" → "21 Sep 2026". Dates are calendar dates, not instants: no time zone shifts. */
export function formatDate(iso: string, locale = DEFAULT_LOCALE): string {
  if (!isValidIsoDate(iso)) throw new RangeError(`Invalid ISO date: ${iso}`);
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "2031-06-30" → "2031 Q2". Used where the blueprint speaks in quarters. */
export function formatQuarter(iso: string): string {
  if (!isValidIsoDate(iso)) throw new RangeError(`Invalid ISO date: ${iso}`);
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return `${y} Q${Math.ceil(m / 3)}`;
}

/** Relative wording for an instant: "just now", "5 min ago", "3 d ago". */
export function formatAgo(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
