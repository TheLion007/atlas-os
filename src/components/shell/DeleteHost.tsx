"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { useObjectDeletion } from "@/client/deletion";
import { useGraph } from "@/client/hooks";
import { planDeletion, presentCounts } from "@/domain/deletion";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n";
import { useDeletion } from "@/lib/deletion-store";
import { playSound } from "@/lib/feedback/sound";
import { usePeek } from "@/lib/url-state";
import { Icon } from "../ui/Icon";
import { hrefKeepingState } from "./nav";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const OBJECT_PATH = new RegExp(`^/objects/(${UUID})(?:/|$)`, "i");

/** True while the person is typing: no shortcut may act then. */
const typing = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  return (
    node.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(node.tagName) ||
    node.getAttribute?.("role") === "textbox"
  );
};

/** The object a right-click landed on: the link to it, or an element that carries its id. */
function objectAt(target: EventTarget | null): string | null {
  const el = (target as HTMLElement | null)?.closest?.<HTMLElement>("[data-object-id], a[href]");
  if (!el) return null;
  const tagged = el.getAttribute("data-object-id");
  if (tagged) return tagged;
  const href = el.getAttribute("href");
  if (!href) return null;
  try {
    const m = OBJECT_PATH.exec(new URL(href, window.location.origin).pathname);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

/**
 * Everything about deleting, mounted once in the shell: the confirmation that says exactly what
 * goes (with numbers), the "Deleted · Undo" banner, the right-click menu, and the keys (Del on
 * the open item, Ctrl+Z to undo a deletion that is still undoable).
 */
export function DeleteHost() {
  return (
    <>
      <DeleteKeys />
      <DeleteMenu />
      <DeleteConfirm />
    </>
  );
}

function DeleteKeys() {
  const del = useObjectDeletion();
  const [peekId] = usePeek();
  const ref = useRef({ del, peekId });
  useEffect(() => {
    ref.current = { del, peekId };
  });

  // Documents deleted in an earlier session whose undo delay was cut short are freed now.
  useEffect(() => {
    if (del.ready) del.freeStale();
    // once, when the source is ready
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [del.ready]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e.target)) return;
      const { del: d, peekId: peeked } = ref.current;
      const store = useDeletion.getState();
      if (e.key === "Delete" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        // Not while a dialog is open (the confirmation itself, the create form…).
        if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        const m = OBJECT_PATH.exec(window.location.pathname);
        const id = peeked ?? (m ? m[1]! : null) ?? store.selection;
        if (!id) return;
        e.preventDefault();
        void d.request(id);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "z" &&
        store.pending.length > 0
      ) {
        e.preventDefault();
        void d.undo(store.pending[store.pending.length - 1]!.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

function DeleteMenu() {
  const { t } = useI18n();
  const menu = useDeletion((s) => s.menu);
  const openMenu = useDeletion((s) => s.openMenu);
  const del = useObjectDeletion();
  const router = useRouter();
  const params = useSearchParams();
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (typing(e.target)) return;
      const id = objectAt(e.target);
      if (!id) return;
      e.preventDefault();
      openMenu({ id, x: e.clientX, y: e.clientY });
    };
    // The graph draws on a canvas: it announces the node under the pointer itself.
    const onCanvas = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; x: number; y: number }>).detail;
      if (d) openMenu(d);
    };
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("atlas:object-menu", onCanvas);
    return () => {
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("atlas:object-menu", onCanvas);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!menu) return;
    first.current?.focus();
    const close = () => openMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu, openMenu]);

  if (!menu) return null;
  const item =
    "flex w-full items-center justify-between gap-6 rounded-[9px] px-3 py-[7px] text-left text-[13px] transition-colors duration-(--duration-hover) hover:bg-hover focus-visible:bg-hover";
  const left = Math.min(menu.x, window.innerWidth - 200);
  const top = Math.min(menu.y, window.innerHeight - 100);
  return (
    <>
      <div
        className="fixed inset-0 z-[88]"
        onPointerDown={() => openMenu(null)}
        aria-hidden="true"
      />
      <div
        role="menu"
        aria-label={t("rm.menu")}
        style={{ left, top }}
        className="rise-in fixed z-[89] min-w-[180px] rounded-[13px] border border-border bg-surface p-1 shadow-pop"
      >
        <button
          ref={first}
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            playSound("click");
            router.push(hrefKeepingState(`/objects/${menu.id}`, params));
            openMenu(null);
          }}
        >
          {t("rm.menu.open")}
        </button>
        <button
          type="button"
          role="menuitem"
          className={item}
          onClick={() => {
            const id = menu.id;
            openMenu(null);
            void del.request(id);
          }}
        >
          <span>{t("rm.menu.delete")}</span>
          <span className="num rounded-[6px] bg-sunk px-[6px] py-[2px] text-[10.5px] text-fg-muted">
            {t("rm.menu.key")}
          </span>
        </button>
      </div>
    </>
  );
}

function DeleteConfirm() {
  const { t, locale } = useI18n();
  const id = useDeletion((s) => s.confirmId);
  const ask = useDeletion((s) => s.askConfirm);
  const graph = useGraph();
  const del = useObjectDeletion();
  const plan = useMemo(
    () => (id && graph.data ? planDeletion(graph.data.nodes, graph.data.edges, id) : null),
    [id, graph.data],
  );
  const parent = useMemo(
    () => (plan?.parentId ? (graph.data?.nodes.find((n) => n.id === plan.parentId) ?? null) : null),
    [plan, graph.data],
  );
  if (!plan) return null;
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
    presentCounts(plan.counts).map(({ key, count }) => t(`rm.n.${key}` as MessageKey, { count })),
  );
  const total = 1 + plan.extra;
  const go = async (mode: "all" | "keep") => {
    ask(null);
    await del.perform(plan, mode);
  };
  return (
    <Dialog.Root open onOpenChange={(v) => !v && ask(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-[60] bg-bg/80" />
        <Dialog.Content
          role="alertdialog"
          className="rise-in fixed top-1/2 left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-card border border-border bg-surface p-6 focus:outline-none"
        >
          <Dialog.Title className="text-lg font-medium">
            {t("rm.title", { title: plan.root.title })}
          </Dialog.Title>
          <Dialog.Description className="text-fg-muted">
            {t("rm.contains", { title: plan.root.title, list })} {t("rm.contains.single")}
          </Dialog.Description>
          {plan.documents.length > 0 && (
            <p className="rounded-[12px] bg-sunk px-3 py-2 text-[12.5px] text-fg-muted">
              {t("rm.docsFinal")}
            </p>
          )}
          {plan.canKeepChildren && (
            <p className="text-[12.5px] text-fg-muted">
              {parent ? t("rm.keepOnlyUp", { parent: parent.title }) : t("rm.keepOnlyAlone")}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Dialog.Close
              autoFocus
              className="inline-flex h-10 items-center rounded-control border border-border px-4 transition-colors duration-(--duration-hover) hover:bg-hover"
            >
              {t("common.cancel")}
            </Dialog.Close>
            {plan.canKeepChildren && (
              <button
                type="button"
                onClick={() => void go("keep")}
                className="inline-flex h-10 items-center rounded-control border border-border px-4 transition-colors duration-(--duration-hover) hover:bg-hover"
              >
                {t("rm.keepOnly")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void go("all")}
              className="inline-flex h-10 items-center gap-2 rounded-control border border-fg px-4 transition-colors duration-(--duration-hover) hover:bg-hover"
            >
              <span aria-hidden="true" className="inline-block size-2 rounded-full bg-critical" />
              {t("rm.deleteAll", { count: total })}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** "Deleted · Undo": visible for a few seconds after each deletion, newest first. */
export function DeleteBanner() {
  const { t } = useI18n();
  const pending = useDeletion((s) => s.pending);
  const del = useObjectDeletion();
  if (pending.length === 0) return null;
  const last = pending[pending.length - 1]!;
  return (
    <aside role="status" aria-live="polite" className="pointer-events-none">
      <div
        key={last.key}
        className="toast-in pointer-events-auto flex items-center gap-3 rounded-[15px] bg-fg py-[11px] pr-2 pl-[11px] text-bg shadow-pop"
      >
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-bg/15 text-base"
        >
          <Icon name="minus" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="min-w-0 text-[14px] font-semibold break-words">
            {last.count > 1
              ? t("rm.deletedMany", { title: last.title, count: last.count - 1 })
              : t("rm.deleted", { title: last.title })}
          </span>
          {last.hasDocuments && <span className="text-[12px] opacity-75">{t("rm.final")}</span>}
        </span>
        <button
          type="button"
          onClick={() => void del.undo(last.key)}
          className="shrink-0 rounded-[9px] border border-bg/30 px-3 py-[6px] text-xs font-semibold transition-colors duration-(--duration-hover) hover:bg-bg/15"
        >
          {t("rm.undo")}
        </button>
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={() => del.dismiss(last.key)}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-[9px] opacity-70 transition-opacity duration-(--duration-hover) hover:opacity-100"
        >
          <Icon name="close" />
        </button>
      </div>
    </aside>
  );
}
