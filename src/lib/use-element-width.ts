"use client";

import { useCallback, useState } from "react";

/**
 * Measures an element's width and tracks it. Used by canvases that draw at true pixel size so
 * text stays crisp. The first measurement arrives from the observer, so nothing is set
 * synchronously during render or in an effect. `fallback` applies until then (and in tests).
 */
export function useElementWidth<T extends HTMLElement>(
  fallback = 960,
): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(fallback);
  const ref = useCallback((node: T | null) => {
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    observer.observe(node);
  }, []);
  return [ref, width];
}
