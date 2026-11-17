"use client";

import { useEffect } from "react";
import { useMascotContext } from "@/lib/feedback/mascot-context";

/** The mascot falls asleep after this long without a key or a mouse movement. */
const SLEEP_AFTER_MS = 90_000;
/** Shaking the pointer: this many sharp reversals within this window makes him dizzy. */
const SHAKE_FLIPS = 7;
const SHAKE_WINDOW_MS = 900;
const SHAKE_MIN_STEP = 14;

/**
 * Listens for what the mascot should notice and writes it to the mascot's context: the welcome
 * (once per launch), going offline and back, being left alone, and a pointer shaken about.
 * Renders nothing; mounted once, in the shell.
 */
export function MascotSignals() {
  useEffect(() => {
    const ctx = useMascotContext.getState();
    ctx.setOffline(!navigator.onLine);
    ctx.greet();

    const off = () => useMascotContext.getState().setOffline(true);
    const on = () => {
      const c = useMascotContext.getState();
      c.setOffline(false);
      c.greet();
    };
    window.addEventListener("offline", off);
    window.addEventListener("online", on);

    let sleepTimer = window.setTimeout(
      () => useMascotContext.getState().setIdle(true),
      SLEEP_AFTER_MS,
    );
    let lastX = 0;
    let lastDir = 0;
    let flips: number[] = [];
    const touch = () => {
      const c = useMascotContext.getState();
      if (c.idle) {
        c.setIdle(false);
        c.greet();
      }
      window.clearTimeout(sleepTimer);
      sleepTimer = window.setTimeout(
        () => useMascotContext.getState().setIdle(true),
        SLEEP_AFTER_MS,
      );
    };
    const onMove = (e: PointerEvent) => {
      touch();
      const dx = e.clientX - lastX;
      if (Math.abs(dx) < SHAKE_MIN_STEP) return;
      lastX = e.clientX;
      const dir = Math.sign(dx);
      if (lastDir && dir !== lastDir) {
        const now = performance.now();
        flips = [...flips.filter((t) => now - t < SHAKE_WINDOW_MS), now];
        if (flips.length >= SHAKE_FLIPS) {
          flips = [];
          useMascotContext.getState().flagDizzy();
        }
      }
      lastDir = dir;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("keydown", touch);
    window.addEventListener("pointerdown", touch);
    return () => {
      window.clearTimeout(sleepTimer);
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("pointerdown", touch);
    };
  }, []);
  return null;
}
