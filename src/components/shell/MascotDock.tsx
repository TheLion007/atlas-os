"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { availableAccessories, levelOf, POINTS_PER_LEVEL } from "@/design/mascot3d/accessories";
import type { Reason } from "@/design/mascot3d/context";
import { MascotHero } from "@/design/mascot3d/MascotHero";
import type { MessageKey } from "@/i18n";
import { useI18n } from "@/i18n/I18nProvider";
import { useFeedback } from "@/lib/feedback/celebrate";
import { usePrefs } from "@/lib/feedback/prefs";
import { ALL_NAV, isActive } from "./nav";
import { useMascotExpression, useWornOutfit } from "./use-mascot-expression";
import { useUi } from "./ui-store";

/** What the mascot says about what it senses (nothing while you work: it keeps quiet). */
const CONTEXT_LINE: Partial<Record<Reason, MessageKey>> = {
  error: "mascot.ctx.error",
  greeting: "mascot.ctx.greeting",
  dizzy: "mascot.ctx.dizzy",
  thinking: "mascot.ctx.thinking",
  offline: "mascot.ctx.offline",
};

/**
 * The mascot, living at the foot of the sidebar. It reads the app (see `useMascotExpression`):
 * it greets you on arrival, sleeps when you are offline or leave it alone, looks worried at an
 * error, thinks while the assistant does, works while a session runs and cheers when something
 * is finished. It also wears what you have unlocked. Collapsed, it is just the creature.
 */
export function MascotDock() {
  const { t } = useI18n();
  const pathname = usePathname();
  const on = usePrefs((s) => s.mascotOn);
  const kind = usePrefs((s) => s.mascot);
  const tracks = usePrefs((s) => s.mascotTracks);
  const points = usePrefs((s) => s.points);
  const seasonTasks = usePrefs((s) => s.seasonTasks);
  const say = useFeedback((s) => s.say);
  const pushToast = useUi((s) => s.pushToast);
  const { expression, reason } = useMascotExpression();

  const available = useMemo(() => availableAccessories(points, seasonTasks), [points, seasonTasks]);
  const worn = useWornOutfit();

  // A new piece of clothing was earned: say so, once, never for what was already owned.
  const [ready, setReady] = useState(() => usePrefs.persist.hasHydrated());
  useEffect(() => {
    if (ready) return;
    return usePrefs.persist.onFinishHydration(() => setReady(true));
  }, [ready]);
  const owned = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (owned.current === null) {
      owned.current = new Set(available);
      return;
    }
    const fresh = available.filter((id) => !owned.current?.has(id));
    owned.current = new Set(available);
    const first = fresh[0];
    if (first) {
      pushToast(t("acc.unlocked", { name: t(`acc.${first}` as MessageKey) }));
      useFeedback.getState().react("cheer", t("acc.unlockedLine"));
    }
  }, [available, ready, pushToast, t]);

  if (!on) return null;
  const here = ALL_NAV.find((n) => n.ready && isActive(n, pathname));
  const contextual = CONTEXT_LINE[reason];
  const line =
    say ??
    (contextual
      ? t(contextual)
      : reason === "idle-sleep"
        ? "…"
        : here
          ? t(`mascot.line.${here.id}` as MessageKey)
          : null);
  // The flat mascots (and the 3D one where WebGL is missing) only know four moods.
  const mood =
    expression === "sleeping"
      ? "sleep"
      : expression === "dancing"
        ? "cheer"
        : expression === "happy"
          ? "happy"
          : "idle";

  const level = levelOf(points);
  const pct = ((points % POINTS_PER_LEVEL) / POINTS_PER_LEVEL) * 100;

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
        <MascotHero
          kind={kind}
          mood={mood}
          expression={expression}
          outfit={worn}
          size={72}
          track={tracks}
        />
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
