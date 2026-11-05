"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ObjectType } from "@/domain/enums";
import { makeT, type TFunction } from ".";
import { DEFAULT_UI_LOCALE, LOCALE_COOKIE, type Locale } from "./core";
import { createFormatters, type Formatters } from "./format";

export interface I18n {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: TFunction;
  f: Formatters;
  /** "Task" / "Tasks" in the interface language. */
  typeLabel: (type: ObjectType, plural?: boolean) => string;
}

function build(locale: Locale, setLocale: (next: Locale) => void): I18n {
  const t = makeT(locale);
  return {
    locale,
    setLocale,
    t,
    f: createFormatters(locale, t),
    typeLabel: (type, plural = false) => t(plural ? `types.${type}` : `type.${type}`),
  };
}

// Without a provider (tests, isolated components) the interface is English.
const I18nContext = createContext<I18n>(build(DEFAULT_UI_LOCALE, () => {}));

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * The interface language. The server reads it from a cookie so the first paint is already in
 * the right language; changing it writes the cookie and re-renders immediately. It is a
 * per-browser preference, like the sidebar mode, not part of the user's data.
 */
export function I18nProvider({ initial, children }: { initial: Locale; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initial);

  const setLocale = useCallback((next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    document.documentElement.lang = next;
    setLocaleState(next);
  }, []);

  const value = useMemo(() => build(locale, setLocale), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
