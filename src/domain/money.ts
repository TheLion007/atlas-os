import type { FxRate } from "./api-types";

/**
 * Money in one base currency using only the owner's manually entered FX rates. Nothing is
 * fetched, guessed or triangulated: if there is no rate between two currencies, the amount is
 * reported as unconvertible rather than approximated.
 */

/** The most recent rate for a pair (by `asOf`), or `undefined`. */
function latest(rates: readonly FxRate[], from: string, to: string): FxRate | undefined {
  return rates
    .filter((r) => r.from === from && r.to === to)
    .sort((a, b) => (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : 0))[0];
}

/** Converts using a direct rate, or the inverse of the opposite direction. `null` if neither. */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: readonly FxRate[],
): number | null {
  if (from === to) return amount;
  const direct = latest(rates, from, to);
  if (direct) return amount * direct.rate;
  const inverse = latest(rates, to, from);
  if (inverse) return amount / inverse.rate;
  return null;
}

export interface MoneyItem {
  amount: number;
  currency: string;
  label: string;
}

export interface MoneySum {
  total: number;
  /** Items that could not be converted, so a total is never silently incomplete. */
  unconverted: MoneyItem[];
}

export function sumInBase(
  items: readonly MoneyItem[],
  base: string,
  rates: readonly FxRate[],
): MoneySum {
  let total = 0;
  const unconverted: MoneyItem[] = [];
  for (const item of items) {
    const converted = convertAmount(item.amount, item.currency, base, rates);
    if (converted === null) unconverted.push(item);
    else total += converted;
  }
  return { total, unconverted };
}
