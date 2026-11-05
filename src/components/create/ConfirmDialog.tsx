"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useI18n } from "@/i18n/I18nProvider";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
}

/** A small confirmation for anything that removes data. Cancel is the default focus. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  busy = false,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-[60] bg-bg/80" />
        <Dialog.Content
          role="alertdialog"
          className="rise-in fixed top-1/2 left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-card border border-border bg-surface p-6 focus:outline-none"
        >
          <Dialog.Title className="text-lg font-medium">{title}</Dialog.Title>
          <Dialog.Description className="text-fg-muted">{body}</Dialog.Description>
          <div className="flex items-center justify-end gap-2">
            <Dialog.Close
              autoFocus
              className="inline-flex h-10 items-center rounded-control border border-border px-4 transition-colors duration-(--duration-hover) hover:bg-hover"
            >
              {t("common.cancel")}
            </Dialog.Close>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className="inline-flex h-10 items-center gap-2 rounded-control border border-fg px-4 transition-colors duration-(--duration-hover) hover:bg-hover disabled:opacity-60"
            >
              <span aria-hidden="true" className="inline-block size-2 rounded-full bg-critical" />
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
