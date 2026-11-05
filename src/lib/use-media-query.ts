"use client";

import { useSyncExternalStore } from "react";

/** Tailwind's breakpoints, as media queries, for behaviour CSS alone cannot express. */
export const BREAKPOINT = {
  md: "(min-width: 768px)",
  xl: "(min-width: 1280px)",
} as const;

/** Subscribes to a media query. Server and first client render report `false`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
