"use client";

import {
  ACCESSORIES,
  availableAccessories,
  cleanOutfit,
  type Accessory,
  type Slot,
} from "@/design/mascot3d/accessories";
import { MascotHero } from "@/design/mascot3d/MascotHero";
import type { MessageKey } from "@/i18n";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { usePrefs } from "@/lib/feedback/prefs";
import { playSound } from "@/lib/feedback/sound";

const SLOTS: readonly Slot[] = ["hat", "face", "back"];

/** What it takes to unlock a piece, in a few words. */
function requirement(a: Accessory, t: (k: MessageKey, p?: Record<string, number>) => string) {
  const u = a.unlock;
  return u.kind === "level"
    ? t("acc.lock.level", { n: u.level })
    : t(u.season === "halloween" ? "acc.lock.halloween" : "acc.lock.winter", { n: u.tasks });
}

/** Pip's wardrobe: a preview, and for each place on him the pieces earned and still to earn. */
export function OutfitPicker() {
  const { t } = useI18n();
  const mascot = usePrefs((s) => s.mascot);
  const tracks = usePrefs((s) => s.mascotTracks);
  const points = usePrefs((s) => s.points);
  const seasonTasks = usePrefs((s) => s.seasonTasks);
  const outfit = usePrefs((s) => s.outfit);
  const wear = usePrefs((s) => s.wear);
  const undress = usePrefs((s) => s.undress);

  const available = availableAccessories(points, seasonTasks);
  const worn = cleanOutfit(outfit, available);

  return (
    <section aria-label={t("acc.title")} className="mt-5 flex flex-wrap items-start gap-5">
      <div className="flex flex-col items-center gap-1">
        <MascotHero kind="pip" expression="greeting" outfit={worn} size={140} track={tracks} />
        {mascot !== "pip" && (
          <p className="max-w-[160px] text-center text-[11.5px] text-fg-subtle">
            {t("acc.pipOnly")}
          </p>
        )}
      </div>
      <div className="flex min-w-[260px] flex-1 flex-col gap-4">
        <div>
          <h3 className="font-display text-[17px] font-bold">{t("acc.title")}</h3>
          <p className="text-[12.5px] text-fg-subtle">{t("acc.sub")}</p>
        </div>
        {SLOTS.map((slot) => (
          <div key={slot} className="flex flex-col gap-2">
            <span className="label">{t(`acc.slot.${slot}` as MessageKey)}</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={!worn[slot]}
                onClick={() => {
                  undress(slot);
                  playSound("drop");
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-[12.5px] font-semibold transition-colors duration-(--duration-hover)",
                  !worn[slot] ? "border-accent bg-accent-soft" : "border-border hover:bg-sunk",
                )}
              >
                {t("acc.none")}
              </button>
              {ACCESSORIES.filter((a) => a.slot === slot).map((a) => {
                const owned = available.includes(a.id);
                const on = worn[slot] === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={!owned}
                    aria-pressed={on}
                    onClick={() => {
                      wear(a.id, slot);
                      playSound("create");
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] font-semibold transition-[background-color,border-color,transform] duration-(--duration-hover)",
                      on ? "border-accent bg-accent-soft" : "border-border",
                      owned
                        ? "hover:-translate-y-px hover:bg-sunk"
                        : "cursor-not-allowed opacity-55",
                    )}
                  >
                    {t(`acc.${a.id}` as MessageKey)}
                    {!owned && (
                      <span className="num text-[10.5px] font-normal text-fg-subtle">
                        {requirement(a, t)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
