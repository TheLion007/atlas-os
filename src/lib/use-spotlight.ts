import type { PointerEvent } from "react";

/**
 * Feeds the `spotlight` utility (globals.css): stores the pointer position inside the element
 * as `--sx` / `--sy`, so a soft glow follows the cursor across a card. Pure CSS does the rest;
 * touch and keyboard users simply never see the glow.
 */
export function spotlightMove(e: PointerEvent<HTMLElement>): void {
  if (e.pointerType === "touch") return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--sx", `${e.clientX - r.left}px`);
  el.style.setProperty("--sy", `${e.clientY - r.top}px`);
}
