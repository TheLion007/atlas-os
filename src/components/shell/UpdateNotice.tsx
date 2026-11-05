"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n";
import { playSound } from "@/lib/feedback/sound";
import { useUpdates } from "@/lib/use-updates";
import { Icon } from "../ui/Icon";

const button =
  "shrink-0 rounded-[9px] border border-bg/30 px-3 py-[6px] text-xs font-semibold transition-colors duration-(--duration-hover) hover:bg-bg/15 disabled:opacity-60";

/**
 * "New version available", in the desktop app only: download, then restart to install. It shows
 * while there is something to do (a version to download, a download running, an update ready) and
 * after a failed download, never after a failed check (that one is told in Settings, where it was
 * asked for). "Later" hides it for this version until the next launch.
 */
export function UpdateNotice() {
  const { t } = useI18n();
  const { state, api } = useUpdates();
  const [hidden, setHidden] = useState<string | null>(null);
  if (!state || !api) return null;
  const { status, latest } = state;
  if (!latest || !["available", "downloading", "ready"].includes(status)) return null;
  const downloadFailed = state.errorWhile === "download" && state.error !== null;
  if (hidden === latest && status === "available" && !downloadFailed) return null;

  const params = { latest, current: state.current, percent: state.percent };
  const title = status === "ready" ? t("up.ready") : t("up.available");
  const body =
    status === "downloading"
      ? t("up.downloading", params)
      : status === "ready"
        ? t("up.readyBody", params)
        : downloadFailed && state.error
          ? t(`up.err.${state.error}` as MessageKey)
          : t("up.availableBody", params);

  return (
    <aside role="status" aria-live="polite" className="pointer-events-none">
      <div className="toast-in pointer-events-auto flex items-center gap-3 rounded-[15px] bg-fg py-[11px] pr-2 pl-[11px] text-bg shadow-pop">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-accent text-base font-bold text-on-accent"
        >
          ↑
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[14px] font-semibold">{title}</span>
          <span className="text-[12px] break-words opacity-75">{body}</span>
          {status === "downloading" && (
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={state.percent}
              aria-label={t("up.downloading", params)}
              className="mt-1 block h-1 overflow-hidden rounded-full bg-bg/20"
            >
              <span
                className="block h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${state.percent}%` }}
              />
            </span>
          )}
        </span>
        {status === "available" && (
          <button
            type="button"
            className={button}
            onClick={() => {
              playSound("click");
              void api.download();
            }}
          >
            {t("up.download")}
          </button>
        )}
        {status === "ready" && (
          <button
            type="button"
            className={button}
            onClick={() => {
              playSound("click");
              void api.install();
            }}
          >
            {t("up.install")}
          </button>
        )}
        {status === "available" && (
          <button
            type="button"
            aria-label={t("up.later")}
            title={t("up.later")}
            onClick={() => setHidden(latest)}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-[9px] opacity-70 transition-opacity duration-(--duration-hover) hover:opacity-100"
          >
            <Icon name="close" />
          </button>
        )}
      </div>
    </aside>
  );
}
