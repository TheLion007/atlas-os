"use client";

import pkg from "../../../package.json";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useI18n } from "@/i18n/I18nProvider";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { MascotDock } from "./MascotDock";
import { ARTIFACT_NAV } from "./artifact-nav";
import { hrefKeepingState } from "./nav";

/** The Atlas mark: a globe in a rounded square, as in the design. */
export function Mark({ size = 19 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c3.2 3 3.2 14 0 17M12 3.5c-3.2 3-3.2 14 0 17" />
    </svg>
  );
}

interface SidebarProps {
  /** `rail` is the persistent sidebar; `drawer` is the mobile sheet. */
  variant?: "rail" | "drawer";
  onNavigate?: () => void;
}

/**
 * The 236 px sidebar of the design, and only that: the mark and name, the ten entries of the
 * artifact with their number shortcuts, and the mascot with its points at the foot. Every other
 * screen of the app is reached from the palette or from Settings, never from here.
 */
export function Sidebar({ variant = "rail", onNavigate }: SidebarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <nav
      aria-label={t("nav.primary")}
      data-sidebar="expanded"
      className={cn(
        "flex h-full w-[236px] shrink-0 flex-col gap-[18px] overflow-x-hidden overflow-y-auto border-r border-border bg-panel px-[14px] pt-5 pb-4",
        variant === "rail" && "hidden md:flex",
      )}
    >
      <div className="flex items-center gap-[10px] px-2">
        <span className="grid size-8 flex-none place-items-center rounded-[10px] bg-fg text-bg">
          <Mark />
        </span>
        <span className="flex flex-col gap-[3px]">
          <span className="font-display text-[18px] leading-none font-extrabold tracking-[-0.02em]">
            {BRAND}
          </span>
          <span className="num text-[10px] leading-none text-fg-subtle">
            {t("nav.version", { version: pkg.version })}
          </span>
        </span>
      </div>

      <ul className="flex flex-col gap-[2px]">
        {ARTIFACT_NAV.map((it) => {
          const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
          return (
            <li key={it.id}>
              <Link
                href={hrefKeepingState(it.href, params)}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-[11px] rounded-[10px] px-[10px] py-2 text-left text-[14px] font-medium transition-[background-color,transform,box-shadow] duration-[350ms] hover:translate-x-[3px] hover:bg-surface active:scale-[0.97]",
                  active ? "bg-surface text-fg shadow-card" : "text-fg-muted",
                )}
                style={{ transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)" }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={active ? "stroke-accent" : "stroke-fg-subtle"}
                >
                  <path d={it.icon} />
                </svg>
                <span className="flex-1 truncate">{t(it.label)}</span>
                <span className="num text-[10px] text-fg-subtle">{it.key}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex-1" />
      <MascotDock />
    </nav>
  );
}
