/**
 * One area of the catalogue, English and French side by side. The French object must have exactly
 * the same keys as the English one (a missing or extra key is a compile error), so a translation
 * can never be forgotten. Terminology is centralised here: refine a word once, it changes everywhere.
 */
export function area<const E extends Record<string, string>>(en: E, fr: Record<keyof E, string>) {
  return { en, fr } as const;
}
