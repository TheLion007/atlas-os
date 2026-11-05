"use client";

import { useEffect } from "react";
import { useFeedback } from "@/lib/feedback/celebrate";
import { usePrefs, type SoundKind } from "@/lib/feedback/prefs";
import { playSound } from "@/lib/feedback/sound";

const INTERACTIVE =
  'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], input[type="checkbox"], input[type="radio"], summary';

/** Which sound a click earns: a box ticking is not a button pressing. */
function soundFor(el: Element): SoundKind | null {
  const own = el.getAttribute("data-sound");
  if (own === "none") return null;
  if (own) return own as SoundKind;
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio"))
    return "check";
  if (el.getAttribute("role") === "switch" || el.getAttribute("aria-pressed") !== null)
    return "check";
  return "click";
}

/**
 * Applies the viewer's feel preferences to the page and renders the confetti: the theme and
 * motion switches on <html>, the click sounds for every interactive element, and the particles
 * in flight. Mounted once, by the Shell.
 */
export function FeedbackLayer() {
  const theme = usePrefs((s) => s.theme);
  const motion = usePrefs((s) => s.motion);
  const pair = usePrefs((s) => s.pair);
  const confetti = useFeedback((s) => s.confetti);

  useEffect(() => {
    void usePrefs.persist.rehydrate();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      root.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.pair = pair;
  }, [pair]);

  useEffect(() => {
    document.documentElement.dataset.motion = motion ? "on" : "off";
  }, [motion]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest(INTERACTIVE);
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true")
        return;
      const kind = soundFor(el);
      if (kind) playSound(kind);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[90] overflow-hidden">
      {confetti.map((p) => (
        <i
          key={p.id}
          className="absolute block"
          style={
            {
              left: p.x,
              top: p.y,
              width: p.w,
              height: p.w * 1.6,
              background: p.c,
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              "--r": `${p.r}deg`,
              animation: "confetti 1s cubic-bezier(0.2, 0.7, 0.4, 1) forwards",
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
