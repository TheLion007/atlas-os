"use client";

import { useCallback, useState } from "react";

export interface Size {
  width: number;
  height: number;
}

/**
 * Tracks an element's size. The first measurement arrives from the observer, so nothing is set
 * synchronously during render or in an effect. `fallback` applies until then (and in tests).
 */
export function useElementSize<T extends HTMLElement>(
  fallback: Size = { width: 960, height: 540 },
): [(node: T | null) => void, Size] {
  const [size, setSize] = useState<Size>(fallback);
  const ref = useCallback((node: T | null) => {
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      const width = Math.round(rect?.width ?? 0);
      const height = Math.round(rect?.height ?? 0);
      if (width > 0 && height > 0)
        setSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
    });
    observer.observe(node);
  }, []);
  return [ref, size];
}
