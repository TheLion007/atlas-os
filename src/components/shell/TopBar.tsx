"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { usePrefs } from "@/lib/feedback/prefs";
import { Icon } from "../ui/Icon";
import { titleKeyForPath } from "./nav";
import { useUi } from "./ui-store";

/** ⌘ on Apple platforms, Ctrl elsewhere. Only used for the hint, never for behaviour. */
function useModKey(): string {
  return useSyncExternalStore(
    () => () => {},
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"),
    () => "Ctrl",
  );
}

const SOUND_ON = "M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12";
const SOUND_OFF = "M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6";
const SUN =
  "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4";
const MOON = "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z";
const SPARK =
  "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z";

const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

function Glyph({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * The 64 px top bar of the design: where you are ("Atlas / Home"), the search that opens the
 * palette, the sound and theme switches, and the assistant.
 */
export function TopBar() {
  const { t } = useI18n();
  const pathname = usePathname();
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const setAssistantOpen = useUi((s) => s.setAssistantOpen);
  const setNavOpen = useUi((s) => s.setNavOpen);
  const soundOn = usePrefs((s) => s.soundOn);
  const theme = usePrefs((s) => s.theme);
  const setPrefs = usePrefs((s) => s.set);
  const mod = useModKey();
  const systemDark = useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia("(prefers-color-scheme: dark)");
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  const dark = theme === "dark" || (theme === "system" && systemDark);
  const key = titleKeyForPath(pathname);

  const square =
    "grid size-[38px] place-items-center rounded-[11px] border border-border bg-surface text-fg-muted transition-transform duration-[350ms] active:scale-90";

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border pr-6 pl-4 md:pl-8">
      <button
        type="button"
        aria-label={t("nav.open")}
        className={cn(square, "md:hidden")}
        onClick={() => setNavOpen(true)}
      >
        <Icon name="menu" />
      </button>

      <div className="flex flex-none items-baseline gap-2 whitespace-nowrap">
        <span className="text-[13px] text-fg-subtle">{t("top.crumbRoot")}</span>
        <span className="text-[13px] text-fg-subtle">/</span>
        <h1 className="font-display text-base font-bold">{key ? t(key) : BRAND}</h1>
      </div>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label={t("topbar.search")}
        aria-keyshortcuts="Control+K Meta+K"
        className="mx-auto flex max-w-[460px] min-w-0 flex-[1_1_auto] cursor-text items-center gap-[10px] rounded-[12px] border border-border bg-surface py-[9px] pr-[10px] pl-[14px] text-[13.5px] text-fg-subtle transition-[box-shadow,border-color] duration-[250ms] hover:border-border-strong hover:shadow-glow"
      >
        <Icon name="search" />
        <span className="flex-1 truncate text-left">{t("top.searchLong")}</span>
        <span className="num hidden rounded-[6px] bg-sunk px-[7px] py-[3px] text-[10.5px] text-fg-muted md:inline">
          {mod} K
        </span>
      </button>

      <div className="flex flex-none items-center gap-[6px]">
        <button
          type="button"
          title={t("feel.sound")}
          aria-label={t("feel.sound")}
          aria-pressed={soundOn}
          onClick={() => setPrefs({ soundOn: !soundOn })}
          className={cn(square, "hover:-translate-y-0.5")}
          style={{ transitionTimingFunction: SPRING }}
        >
          <Glyph d={soundOn ? SOUND_ON : SOUND_OFF} />
        </button>
        <button
          type="button"
          title={t("feel.theme")}
          aria-label={t("feel.theme")}
          onClick={() => setPrefs({ theme: dark ? "light" : "dark" })}
          className={cn(square, "hover:-translate-y-0.5 hover:-rotate-12")}
          style={{ transitionTimingFunction: SPRING }}
        >
          <Glyph d={dark ? SUN : MOON} />
        </button>
        <button
          type="button"
          onClick={() => setAssistantOpen(true)}
          aria-label={t("topbar.assistant")}
          aria-keyshortcuts="Control+J Meta+J"
          className="flex h-[38px] items-center gap-2 rounded-[11px] border-0 bg-fg pr-[14px] pl-[11px] text-[13.5px] font-semibold whitespace-nowrap text-bg transition-[transform,box-shadow] duration-[350ms] hover:-translate-y-0.5 hover:shadow-pop active:scale-95"
          style={{ transitionTimingFunction: SPRING }}
        >
          <Glyph d={SPARK} size={17} />
          <span className="hidden sm:inline">{t("top.assistantShort")}</span>
          <span className="num hidden text-[10px] opacity-60 md:inline">{mod} J</span>
        </button>
      </div>
    </header>
  );
}
