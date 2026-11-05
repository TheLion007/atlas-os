"use client";

import type { LifecycleStatus } from "@/domain/enums";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";

interface StatusBadgeProps {
  status: LifecycleStatus;
  /** Derived, never stored: this object waits on an unfinished predecessor. */
  blocked?: boolean;
  className?: string;
}

/**
 * Lifecycle status as a small mono label with a mark. Status colour lives on the mark only (the
 * text stays neutral), because the critical colour is just under AA contrast for small text on
 * the surface. "Blocked" is derived from dependencies and takes precedence over "active".
 */
export function StatusBadge({ status, blocked = false, className }: StatusBadgeProps) {
  const { t } = useI18n();
  const shown = blocked && (status === "draft" || status === "active");
  const text = shown ? t("status.blocked") : t(`status.${status}`);

  const mark = shown
    ? "bg-critical"
    : status === "done"
      ? "bg-positive"
      : status === "active"
        ? "bg-fg"
        : "border border-fg-muted";

  return (
    <span
      className={cn("label inline-flex items-center gap-2", className)}
      data-status={shown ? "blocked" : status}
    >
      <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", mark)} />
      <span className={cn(status === "dropped" && !shown && "line-through")}>{text}</span>
    </span>
  );
}
