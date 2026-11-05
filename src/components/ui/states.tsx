"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";

interface ChecklistItem {
  label: string;
  done: boolean;
}

interface EmptyStateProps {
  title: string;
  description?: string;
  /** Blueprint: the empty Command Center is a checklist. Done-ness is derived from data. */
  checklist?: readonly ChecklistItem[];
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, checklist, action, className }: EmptyStateProps) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-card border border-dashed border-border p-6",
        className,
      )}
      data-state="empty"
    >
      <p className="text-base font-medium">{title}</p>
      {description && <p className="max-w-prose text-fg-muted">{description}</p>}
      {checklist && (
        <ol className="flex w-full flex-col gap-2">
          {checklist.map((item) => (
            <li key={item.label} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block size-3 shrink-0 rounded-full border",
                  item.done ? "border-positive bg-positive" : "border-fg-muted",
                )}
              />
              <span className={cn(item.done && "text-fg-muted line-through")}>{item.label}</span>
              <span className="sr-only">{item.done ? t("common.doneMark") : t("common.todo")}</span>
            </li>
          ))}
        </ol>
      )}
      {action}
    </div>
  );
}

interface LoadingStateProps {
  /** Announced to assistive technology. */
  label?: string;
  lines?: number;
  className?: string;
}

/** Static placeholder blocks: nothing animates without a state change. */
export function LoadingState({ label, lines = 3, className }: LoadingStateProps) {
  const { t } = useI18n();
  const widths = ["w-full", "w-2/3", "w-1/2"];
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn("flex flex-col gap-3", className)}
      data-state="loading"
    >
      <span className="sr-only">{label ?? t("common.loading")}…</span>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn("h-3 rounded-control bg-border", widths[i % widths.length])}
        />
      ))}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title, message, onRetry, className }: ErrorStateProps) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-start gap-3 rounded-card border border-border bg-surface p-6",
        className,
      )}
      data-state="error"
    >
      <p className="flex items-center gap-2 text-base font-medium">
        <span
          aria-hidden="true"
          className="inline-block size-2 shrink-0 rounded-full bg-critical"
        />
        {title ?? t("error.generic")}
      </p>
      <p className="max-w-prose text-fg-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-control border border-border px-3 py-2 transition-colors duration-(--duration-hover) hover:bg-hover"
        >
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}
