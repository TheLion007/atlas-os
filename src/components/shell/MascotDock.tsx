"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Mascot } from "@/design/Mascot";
import type { MessageKey } from "@/i18n";
import { useI18n } from "@/i18n/I18nProvider";
import { useFeedback } from "@/lib/feedback/celebrate";
import { usePrefs } from "@/lib/feedback/prefs";
import { ALL_NAV, isActive } from "./nav";

const SLEEP_AFTER_MS = 90_000;

/**
 * The mascot, living at the foot of the sidebar: it comments on the screen you are on, cheers
 * when something is finished (see `celebrate`), and falls asleep when you leave it alone.
 * Collapsed, it is just the creature, without the speech bubble.
 */
export function MascotDock() {
  const { t } = useI18n();
  const pathname = usePathname();
  const on = usePrefs((s) => s.mascotOn);
  const kind = usePrefs((s) => s.mascot);
  const tracks = usePrefs((s) => s.mascotTracks);
  const points = usePrefs((s) => s.points);
  const mood = useFeedback((s) => s.mood);
  const say = useFeedback((s) => s.say);
  const [asleep, setAsleep] = useState(false);

  useEffect(() => {
    let timer = window.setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
    const wake = () => {
      setAsleep(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setAsleep(true), SLEEP_AFTER_MS);
    };
    window.addEventListener("pointermove", wake, { passive: true });
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  if (!on) return null;
  const here = ALL_NAV.find((n) => n.ready && isActive(n, pathname));
  const line = say ?? (asleep ? "…" : here ? t(`mascot.line.${here.id}` as MessageKey) : null);
  const shown = asleep && mood === "idle" ? "sleep" : mood;

  const level = Math.floor(points / 200) + 1;
  const pct = ((points % 200) / 200) * 100;

  return (
    <div className="flex flex-col gap-3">
      {line && (
        <p
          role="status"
          aria-live="polite"
          className="pop-in relative rounded-[14px] border border-border bg-surface px-[13px] py-[11px] text-[12.5px] leading-[1.45] text-fg-muted shadow-card text-pretty"
        >
          {line}
          <span
            aria-hidden="true"
            className="absolute -bottom-[6px] left-[26px] size-[11px] rotate-45 border-r border-b border-border bg-surface"
          />
        </p>
      )}
      <div className="flex items-end gap-3 px-1">
        <Mascot kind={kind} mood={shown} size={58} track={tracks} />
        <div className="flex flex-1 flex-col gap-[6px] pb-[6px]">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-[15px] font-bold">
              {t("dock.points", { n: points })}
            </span>
            <span className="num text-[10px] text-fg-subtle">{t("dock.level", { n: level })}</span>
          </div>
          <div className="h-[5px] overflow-hidden rounded-[5px] bg-sunk">
            <div
              className="h-full rounded-[5px] bg-accent transition-[width] duration-[800ms]"
              style={{
                width: `${pct}%`,
                transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
