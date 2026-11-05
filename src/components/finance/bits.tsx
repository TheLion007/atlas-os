"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { DataKind } from "@/domain/enums";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "../ui/Icon";

/**
 * What a figure is — actual, target, estimate, scenario or assumption — as a small mono tag
 * next to it. An actual reads in full ink; anything else is quieter and outlined dashed, so a
 * projection can never pass for a fact at a glance (and the word says it, not only the style).
 */
export function DataKindBadge({ kind, className }: { kind: DataKind; className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "label inline-flex shrink-0 items-center rounded-control border px-1 leading-4",
        kind === "actual" ? "border-border text-fg" : "border-dashed border-fg-muted text-fg-muted",
        className,
      )}
    >
      {t(`dataKind.${kind}`)}
    </span>
  );
}

export const primaryButton =
  "inline-flex h-10 items-center gap-2 rounded-[12px] bg-fg px-4 text-[13.5px] font-semibold text-bg transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-px active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60";
export const secondaryButton =
  "inline-flex h-10 items-center gap-2 rounded-[12px] border border-border-strong bg-surface px-4 text-[13.5px] font-semibold text-fg transition-[background-color,transform] duration-300 ease-(--ease-spring) hover:bg-sunk active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60";
export const selectClass =
  "h-9 rounded-[11px] border border-border-strong bg-surface px-2 text-[13px] text-fg";

export interface MenuItem {
  key: string;
  label: string;
  hint?: string;
  onSelect: () => void;
}

/** A button that opens a short list of actions. Closes on choice, Escape or a click outside. */
export function ActionMenu({
  label,
  icon = "plus",
  items,
  primary = true,
}: {
  label: string;
  icon?: IconName;
  items: readonly MenuItem[];
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={primary ? primaryButton : secondaryButton}
      >
        <Icon name={icon} />
        {label}
        <Icon name="chevronDown" />
      </button>
      {open && (
        <ul
          role="menu"
          className="absolute left-0 z-30 mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col rounded-card border border-border bg-surface p-1 sm:right-0 sm:left-auto"
        >
          {items.map((item) => (
            <li key={item.key} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className="flex w-full flex-col items-start gap-1 rounded-control px-3 py-2 text-left transition-colors duration-(--duration-hover) hover:bg-hover"
              >
                <span>{item.label}</span>
                {item.hint && <span className="text-xs text-fg-muted">{item.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A quiet notice line (a warning is never colour-only: it carries its text). */
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warn";
}) {
  return (
    <p className="flex items-start gap-2 rounded-control border border-border px-3 py-2 text-sm text-fg-muted">
      <span
        aria-hidden="true"
        className={cn(
          "mt-2 inline-block size-2 shrink-0 rounded-full",
          tone === "warn" ? "bg-critical" : "bg-fg-muted",
        )}
      />
      <span>{children}</span>
    </p>
  );
}

/** Segmented view switch, as in Memory. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-full bg-sunk p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors duration-(--duration-hover)",
            value === o.value ? "bg-surface text-fg shadow-card" : "text-fg-subtle hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
