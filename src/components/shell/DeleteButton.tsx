"use client";

import { useObjectDeletion } from "@/client/deletion";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";

/**
 * The "Delete" button every detail panel offers for the object it shows. It does not delete by
 * itself: it starts the shared flow (confirmation with numbers when the object holds other
 * things, "Deleted · Undo" otherwise), the same as the right-click menu and the Del key.
 */
export function DeleteButton({
  id,
  className,
  block = false,
}: {
  id: string;
  className?: string;
  /** Full width, for the stacked buttons of a detail card. */
  block?: boolean;
}) {
  const { t } = useI18n();
  const deletion = useObjectDeletion();
  return (
    <button
      type="button"
      disabled={!deletion.ready}
      onClick={() => void deletion.request(id)}
      className={cn(
        "rounded-[10px] border border-border-strong bg-surface px-3 py-[5px] text-[12px] font-medium transition-[background-color,transform] hover:bg-sunk active:scale-[0.96] disabled:opacity-60",
        block && "w-full rounded-[12px] py-[10px] text-[13.5px] font-semibold",
        className,
      )}
    >
      {t("common.delete")}
    </button>
  );
}
