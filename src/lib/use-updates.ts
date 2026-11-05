"use client";

import { useEffect, useState } from "react";
import { desktopBridge, type AtlasUpdates, type UpdateState } from "./desktop";

/**
 * The update state of the desktop app, kept live. `state` is `null` on the web, in development and
 * before the first answer: whoever shows something about updates shows nothing then (no dead
 * control).
 */
export function useUpdates(): { state: UpdateState | null; api: AtlasUpdates | null } {
  const api = desktopBridge()?.updates ?? null;
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!api) return;
    let live = true;
    void api.state().then((s) => live && setState(s));
    const stop = api.onState((s) => live && setState(s));
    return () => {
      live = false;
      stop();
    };
  }, [api]);
  return { state: state?.supported ? state : null, api };
}
