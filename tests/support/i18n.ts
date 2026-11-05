import { makeT, type Locale } from "@/i18n";
import { createFormatters } from "@/i18n/format";

/** A translation context for tests that call pure functions taking `{ t, f }`. */
export function i18nCtx(locale: Locale = "en") {
  const t = makeT(locale);
  return { t, f: createFormatters(locale, t), locale };
}
