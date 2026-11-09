"use client";

import { useEffect, useRef, useState } from "react";
import { collectPrefs } from "@/client/backup";
import { useI18n } from "@/i18n/I18nProvider";
import { desktopBridge, type AtlasData } from "@/lib/desktop";
import { useUi } from "./ui-store";

/**
 * What the desktop app's data folder asks of the shell, once, at the top of the app:
 *  - the interface preferences are mirrored in the data folder (so a second PC and a backup have
 *    them, and they survive a restart);
 *  - read-only mode (another PC has the data open) is announced and stays visible;
 *  - the outcome of an import finished at start-up is told once.
 */
export function DataHost() {
  const { t } = useI18n();
  const pushToast = useUi((s) => s.pushToast);
  const data: AtlasData | null =
    typeof window === "undefined" ? null : (desktopBridge()?.data ?? null);
  const [readOnly, setReadOnly] = useState(false);
  const last = useRef<string>("");

  useEffect(() => {
    const d = data;
    if (!d) return;
    let live = true;
    void d.info().then((i) => live && setReadOnly(i.readOnly));
    void d.importNotice().then((n) => {
      if (!live || !n) return;
      if (n.ok) pushToast(t("md.import.applied", { path: n.safetyBackup ?? "" }));
      else if (n.reason === "did_not_start")
        pushToast(t("md.import.rolledBack", { path: n.safetyBackup ?? "" }));
    });
    return () => {
      live = false;
    };
    // once, at start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the preferences: saved to the data folder shortly after they change
  useEffect(() => {
    if (!data || readOnly) return;
    const save = () => {
      const keys = collectPrefs();
      const json = JSON.stringify(keys);
      if (json === last.current) return;
      last.current = json;
      void data.savePrefs(keys).then((savedAt) => {
        if (savedAt) {
          try {
            window.localStorage.setItem("atlas.sync.applied", savedAt);
          } catch {
            /* storage blocked */
          }
        }
      });
    };
    const timer = window.setInterval(save, 5000);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", save);
    save();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", save);
    };
  }, [data, readOnly]);

  if (!readOnly) return null;
  return (
    <aside
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-[68px] left-1/2 z-[78] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2"
    >
      <p className="toast-in pointer-events-auto rounded-[15px] bg-fg px-4 py-[11px] text-[13px] font-semibold text-bg shadow-pop">
        {t("md.ro.banner")}
      </p>
    </aside>
  );
}
