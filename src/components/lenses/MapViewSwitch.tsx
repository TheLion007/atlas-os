"use client";

import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";

export type MapView = "territory" | "globe" | "flat";

/**
 * A discreet switch between the Map (the default) and the two geographic views, the 3D globe and
 * the world map. Small, quiet, and never the first thing you see.
 */
export function MapViewSwitch({
  view,
  onChange,
  className,
}: {
  view: MapView;
  onChange: (v: MapView) => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("map2.view")}
      className={cn("flex items-center gap-1 text-[11px] text-fg-subtle", className)}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {(["territory", "globe", "flat"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={cn(
            "rounded-[8px] px-2 py-1 transition-colors duration-(--duration-hover) hover:text-fg",
            view === v && "bg-sunk text-fg",
          )}
        >
          {t(`map2.view.${v}`)}
        </button>
      ))}
    </div>
  );
}
