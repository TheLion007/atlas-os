"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { Icon } from "../ui/Icon";
import { useUi, type Toast } from "./ui-store";

const LIFETIME_MS = 6000;

function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useI18n();
  const dismiss = useUi((s) => s.dismissToast);
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, dismiss]);
  return (
    <li className="toast-in flex min-w-[280px] items-center gap-3 rounded-[15px] bg-fg py-[11px] pr-2 pl-[11px] text-bg shadow-pop">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-accent text-base font-bold text-on-accent"
      >
        ✓
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="min-w-0 text-[14px] font-semibold break-words">{toast.text}</span>
        {toast.points !== undefined && (
          <span className="text-[12px] opacity-70">
            {t("feel.points", { points: toast.points })}
          </span>
        )}
      </span>
      {toast.points !== undefined && (
        <span className="num shrink-0 rounded-[8px] bg-bg/15 px-2 py-1 text-[13px] font-semibold">
          +{toast.points}
        </span>
      )}
      {toast.action && (
        <Link
          href={toast.action.href}
          onClick={() => dismiss(toast.id)}
          className="shrink-0 rounded-[9px] border border-bg/30 px-2 py-1 text-xs font-semibold transition-colors duration-(--duration-hover) hover:bg-bg/15"
        >
          {toast.action.label}
        </Link>
      )}
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={() => dismiss(toast.id)}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-[9px] opacity-70 transition-opacity duration-(--duration-hover) hover:opacity-100"
      >
        <Icon name="close" />
      </button>
    </li>
  );
}

/** Confirmations for what just happened. Polite, brief, and never blocking. */
export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  return (
    <ol
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[80] flex w-[calc(100%-2rem)] max-w-sm flex-col items-end gap-[10px] md:right-6 md:bottom-6 [&>li]:pointer-events-auto"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </ol>
  );
}
