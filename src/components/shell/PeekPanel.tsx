"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, type KeyboardEvent, type ReactNode } from "react";
import { describeError, useGraph, useObject } from "@/client/hooks";
import { resolveMemoryContext } from "@/domain/context-color";
import { memoryProvenance } from "@/domain/memory";
import { deriveFacts } from "@/domain/object-facts";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { BREAKPOINT, useMediaQuery } from "@/lib/use-media-query";
import { usePeek } from "@/lib/url-state";
import { Icon } from "../ui/Icon";
import { ErrorState, LoadingState } from "../ui/states";
import { hrefKeepingState } from "./nav";
import { ObjectActions } from "./ObjectActions";
import { ObjectView } from "./ObjectView";
import { useUi } from "./ui-store";
import { useSearchParams } from "next/navigation";

export type PeekMode = "peek" | "pinned" | "editing";

interface PeekPanelProps {
  /** Docked beside the content (wide screens) or a sheet over it. */
  docked: boolean;
  /** peek: transient · pinned: stays until closed · editing: the panel is being edited. */
  mode?: PeekMode;
  /** Accessible name of the panel: the object's title. */
  title: string;
  onClose: () => void;
  /** Provided only where pinning is offered (docked). */
  onTogglePin?: () => void;
  children: ReactNode;
}

function Header({
  mode,
  onClose,
  onTogglePin,
}: Pick<PeekPanelProps, "mode" | "onClose" | "onTogglePin">) {
  const { t } = useI18n();
  const current = mode ?? "peek";
  const btn =
    "inline-flex size-8 items-center justify-center rounded-control text-fg-muted transition-colors duration-(--duration-hover) hover:bg-hover hover:text-fg";
  return (
    <div className="flex h-(--topbar-h) shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <p className="label">{t(`peek.mode.${current}`)}</p>
      <div className="flex items-center gap-1">
        {onTogglePin && (
          <button
            type="button"
            className={cn(btn, current === "pinned" && "bg-selected text-fg")}
            aria-pressed={current === "pinned"}
            aria-label={t("peek.pin")}
            title={t("peek.pinHint")}
            onClick={onTogglePin}
          >
            <Icon name="pin" />
          </button>
        )}
        <button type="button" className={btn} aria-label={t("peek.close")} onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}

/**
 * The 440px right sheet. On wide screens it is docked and the content makes room; below that it
 * is a modal sheet (focus stays inside, Escape closes). States: closed (not rendered) · open
 * (transient, Escape closes) · pinned (Escape does not) · editing (labelled as such).
 */
export function PeekPanel({
  docked,
  mode = "peek",
  title,
  onClose,
  onTogglePin,
  children,
}: PeekPanelProps) {
  const { t } = useI18n();
  if (docked) {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mode !== "pinned") onClose();
    };
    return (
      <aside
        aria-label={t("peek.label", { title })}
        data-state={mode}
        onKeyDown={onKeyDown}
        className="hidden h-full w-(--peek-w) shrink-0 flex-col border-l border-border bg-surface xl:flex"
      >
        <Header mode={mode} onClose={onClose} onTogglePin={onTogglePin} />
        <div className="grow overflow-y-auto p-6">{children}</div>
      </aside>
    );
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fade-in fixed inset-0 z-40 backdrop-blur-[3px]"
          style={{ background: "rgb(20 16 12 / 0.22)" }}
        />
        <Dialog.Content
          data-state={mode}
          className="sheet-right fixed inset-y-0 right-0 z-50 flex w-full max-w-(--peek-w) flex-col border-l border-border-strong bg-surface shadow-pop focus:outline-none"
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {t("peek.details", { title })}
          </Dialog.Description>
          <Header mode={mode} onClose={onClose} />
          <div className="grow overflow-y-auto p-4 md:p-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Wires the panel to the URL (`?peek=`), the data source and the engine. */
export function PeekHost() {
  const { t } = useI18n();
  const [id, setId] = usePeek();
  const params = useSearchParams();
  const wide = useMediaQuery(BREAKPOINT.xl);
  const pinned = useUi((s) => s.peekPinned);
  const setPinned = useUi((s) => s.setPeekPinned);
  const pushRecent = useUi((s) => s.pushRecent);

  const object = useObject(id);
  const graph = useGraph();
  const facts = useMemo(
    () => (id && graph.data ? deriveFacts(id, graph.data.nodes, graph.data.edges) : null),
    [id, graph.data],
  );
  const memoryContext = useMemo(
    () => (id && graph.data ? resolveMemoryContext(id, graph.data.nodes, graph.data.edges) : null),
    [id, graph.data],
  );
  const memProvenance = useMemo(
    () => (id && graph.data ? memoryProvenance(id, graph.data.nodes, graph.data.edges) : null),
    [id, graph.data],
  );

  useEffect(() => {
    if (id && object.data) pushRecent(id);
  }, [id, object.data, pushRecent]);

  if (!id) return null;

  const close = () => setId(null);
  const title = object.data?.title ?? t("peek.object");
  const hrefFor = (target: string) => hrefKeepingState(`/objects/${target}`, params);

  return (
    <PeekPanel
      docked={wide}
      mode={wide && pinned ? "pinned" : "peek"}
      title={title}
      onClose={close}
      onTogglePin={wide ? () => setPinned(!pinned) : undefined}
    >
      {object.isPending ? (
        <LoadingState label={t("peek.loading")} lines={5} />
      ) : object.isError ? (
        <ErrorState
          {...(object.error && "status" in object.error && object.error.status === 404
            ? { title: t("error.notFound"), message: t("error.objectGone") }
            : describeError(object.error, t))}
          onRetry={() => void object.refetch()}
        />
      ) : (
        <ObjectView
          object={object.data}
          facts={facts}
          memoryContext={memoryContext}
          memoryProvenance={memProvenance}
          onPeek={setId}
          hrefFor={hrefFor}
          variant="panel"
          actions={<ObjectActions object={object.data} />}
        />
      )}
    </PeekPanel>
  );
}
