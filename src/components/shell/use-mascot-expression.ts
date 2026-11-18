"use client";

import { useEffect, useMemo, useState } from "react";
import { availableAccessories, cleanOutfit, type Outfit } from "@/design/mascot3d/accessories";
import { readContext, type Reading } from "@/design/mascot3d/context";
import { useFeedback } from "@/lib/feedback/celebrate";
import { useMascotContext } from "@/lib/feedback/mascot-context";
import { usePrefs } from "@/lib/feedback/prefs";
import { useTimer } from "@/lib/timer-store";

/** What Pip should look like right now, read from everything the app lets him sense. */
export function useMascotExpression(): Reading {
  const mood = useFeedback((s) => s.mood);
  const thinking = useMascotContext((s) => s.thinking);
  const offline = useMascotContext((s) => s.offline);
  const idle = useMascotContext((s) => s.idle);
  const errorUntil = useMascotContext((s) => s.errorUntil);
  const greetUntil = useMascotContext((s) => s.greetUntil);
  const dizzyUntil = useMascotContext((s) => s.dizzyUntil);
  const timerRunning = useTimer((s) => s.timer.running);
  const [now, setNow] = useState(() => Date.now());

  // A timed signal (an error, the welcome) ends by itself: look again exactly when it does.
  useEffect(() => {
    const ids = [errorUntil, greetUntil, dizzyUntil]
      .map((until) => until - Date.now())
      .filter((ms) => ms > 0)
      .map((ms) => window.setTimeout(() => setNow(Date.now()), ms + 30));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [errorUntil, greetUntil, dizzyUntil]);

  return readContext({
    mood,
    now,
    errorUntil,
    greetUntil,
    dizzyUntil,
    thinking,
    timerRunning,
    offline,
    idle,
  });
}

/** What Pip is wearing: the chosen pieces, minus any that are not (or no longer) earned. */
export function useWornOutfit(): Outfit {
  const points = usePrefs((s) => s.points);
  const outfit = usePrefs((s) => s.outfit);
  const seasonTasks = usePrefs((s) => s.seasonTasks);
  return useMemo(
    () => cleanOutfit(outfit, availableAccessories(points, seasonTasks)),
    [outfit, points, seasonTasks],
  );
}
