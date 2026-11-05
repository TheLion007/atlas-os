/**
 * Interface language: pure, framework-free. Only the Atlas OS interface is translated; object
 * titles and everything a user writes are data and never pass through here.
 */
export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_UI_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "atlas.locale";

/** Language names are shown in their own language, whatever the interface language is. */
export const LOCALE_NAME: Record<Locale, string> = { en: "English", fr: "Français" };

/** The BCP 47 tag used for dates, numbers and currencies. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", fr: "fr-FR" };

export function parseLocale(value: string | null | undefined): Locale {
  return LOCALES.find((l) => l === value) ?? DEFAULT_UI_LOCALE;
}

export type Params = Readonly<Record<string, string | number>>;

/**
 * Looks a message up and fills `{name}` placeholders. A message written `"one | other"` is a
 * plural: the form is chosen from `params.count` by the language's own plural rules (French
 * treats 0 as singular, English does not).
 */
export function format(locale: Locale, message: string, params?: Params): string {
  let text = message;
  if (message.includes(" | ") && params && typeof params.count === "number") {
    const forms = message.split(" | ");
    const category = new Intl.PluralRules(INTL_LOCALE[locale]).select(params.count);
    text = (category === "one" ? forms[0] : (forms[1] ?? forms[0])) as string;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export type Catalog = Readonly<Record<string, string>>;

/**
 * The placeholder names in a message, sorted. Used by the catalogue test to prove French and
 * English carry the same variables.
 */
export function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();
}
