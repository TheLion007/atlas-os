import { formatDate, formatDelta, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { INTL_LOCALE, type Locale } from "./core";
import type { TFunction } from ".";

/**
 * Locale-bound formatting: dates, numbers, money and relative time in the interface language.
 * Currencies are data and never assumed; the locale only shapes digits, separators and words.
 */
export function createFormatters(locale: Locale, t: TFunction) {
  const intl = INTL_LOCALE[locale];
  return {
    date: (iso: string) => formatDate(iso, intl),
    money: (amount: number, currency: string, opts: { compact?: boolean } = {}) =>
      formatMoney(amount, currency, { locale: intl, ...opts }),
    number: (value: number, opts: { digits?: number } = {}) =>
      formatNumber(value, { locale: intl, ...opts }),
    percent: (fraction: number | null) => formatPercent(fraction, intl),
    delta: (value: number, opts: { digits?: number } = {}) =>
      formatDelta(value, { locale: intl, ...opts }),
    /** "in 14 d", "today", "3 d overdue" — or `null` when there is no date. */
    relativeDay: (days: number | null): string | null => {
      if (days === null) return null;
      if (days === 0) return t("rel.today");
      return days > 0 ? t("rel.inDays", { count: days }) : t("rel.overdueDays", { count: -days });
    },
    /** "just now", "5 min ago" for an instant. */
    ago: (iso: string, now: Date): string => {
      const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
      if (seconds < 45) return t("ago.now");
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return t("ago.minutes", { count: minutes });
      const hours = Math.round(minutes / 60);
      if (hours < 24) return t("ago.hours", { count: hours });
      return t("ago.days", { count: Math.round(hours / 24) });
    },
    /** "2026-09" → "September 2026". */
    monthYear: (key: string): string =>
      new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${key}-01T00:00:00Z`),
      ),
    /** "2026-09" → "Sep". */
    monthShort: (key: string): string =>
      new Intl.DateTimeFormat(intl, { month: "short", timeZone: "UTC" }).format(
        new Date(`${key}-01T00:00:00Z`),
      ),
    /** An ISO instant → "21 Sep 2026, 09:30 UTC". */
    dateTime: (iso: string): string | null => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime())
        ? null
        : `${formatDate(d.toISOString().slice(0, 10), intl)}, ${d.toISOString().slice(11, 16)} UTC`;
    },
  };
}

export type Formatters = ReturnType<typeof createFormatters>;
