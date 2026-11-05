import { DEFAULT_UI_LOCALE, format, type Locale, type Params } from "./core";
import { en, fr, type MessageKey } from "./messages";

export * from "./core";
export type { MessageKey } from "./messages";

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, fr };

/** Translate a key. A key missing from a catalogue falls back to English, then to the key itself. */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const message = CATALOGS[locale][key] ?? CATALOGS[DEFAULT_UI_LOCALE][key] ?? key;
  return format(locale, message, params);
}

export type TFunction = (key: MessageKey, params?: Params) => string;

export function makeT(locale: Locale): TFunction {
  return (key, params) => translate(locale, key, params);
}

/** A key built at run time (e.g. `type.${type}`) is only accepted when it exists. */
export function hasKey(key: string): key is MessageKey {
  return key in en;
}
