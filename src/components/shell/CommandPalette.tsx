"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { Mascot } from "@/design/Mascot";
import { usePrefs } from "@/lib/feedback/prefs";
import { Icon } from "../ui/Icon";
import { TypeGlyph } from "../ui/TypeGlyph";
import { paletteMode, type PaletteItem } from "./palette-items";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (q: string) => void;
  items: readonly PaletteItem[];
  /** The data behind results is still loading. */
  loading?: boolean;
}

/**
 * Search and act from one input. Empty: recent objects and places to go. Typing: results grouped
 * by object type. `>`: actions. Enter peeks (stays in the lens), Alt+Enter opens the object's
 * page. It is a combobox over a listbox, so it is fully keyboard and screen-reader operable.
 */
export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  items,
  loading = false,
}: CommandPaletteProps) {
  const { t } = useI18n();
  const listId = useId();
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const mode = paletteMode(query);
  const mascot = usePrefs((st) => st.mascot);

  // Keep the highlighted row valid as the list changes, and in view as it moves.
  const safeActive = items.length === 0 ? -1 : Math.min(active, items.length - 1);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${safeActive}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [safeActive]);

  const run = (item: PaletteItem | undefined, alt: boolean) => {
    if (!item) return;
    onOpenChange(false);
    item.run({ alt });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((safeActive + step + items.length) % items.length);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : Math.max(0, items.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items[safeActive], e.altKey);
    }
  };

  // Rows stay one flat, navigable sequence (by index); groups only add a heading and a wrapper.
  const groups = useMemo(() => {
    const out: { name: string; rows: { item: PaletteItem; index: number }[] }[] = [];
    items.forEach((item, index) => {
      const last = out[out.length - 1];
      if (last && last.name === item.group) last.rows.push({ item, index });
      else out.push({ name: item.group, rows: [{ item, index }] });
    });
    return out;
  }, [items]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fade-in fixed inset-0 z-[80] backdrop-blur-[6px]"
          style={{ background: "rgb(20 16 12 / 0.34)" }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className="pop-in fixed top-[11vh] left-1/2 z-[81] flex max-h-[80dvh] w-[min(660px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-[22px] border border-border-strong bg-surface shadow-pop focus:outline-none"
        >
          <Dialog.Title className="sr-only">{t("palette.title")}</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-border px-[18px] py-4">
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M11 11m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M20 20l-4.5-4.5" />
            </svg>
            <input
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={safeActive >= 0 ? `${listId}-${safeActive}` : undefined}
              aria-label={t("palette.input")}
              value={query}
              onChange={(e) => {
                onQueryChange(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={t("palette.placeholder")}
              className="min-w-0 flex-1 bg-transparent text-[17px] font-medium outline-none! placeholder:text-fg-subtle"
            />
            <span className="num rounded-[6px] bg-sunk px-[7px] py-[3px] text-[10.5px] text-fg-muted">
              {t("palette.esc")}
            </span>
          </div>

          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label={
              mode === "action-mode"
                ? t("palette.listActions")
                : mode === "recent"
                  ? t("palette.listRecent")
                  : t("palette.listResults")
            }
            className="min-h-0 grow overflow-y-auto px-2 pt-[6px] pb-[10px]"
            data-mode={mode}
          >
            {groups.map((group, gi) => (
              <li key={group.name} role="presentation">
                <div role="group" aria-labelledby={`${listId}-g-${gi}`}>
                  <p
                    id={`${listId}-g-${gi}`}
                    className="num px-[10px] pt-3 pb-[6px] text-[10.5px] font-semibold tracking-[0.08em] text-fg-subtle uppercase"
                  >
                    {group.name}
                  </p>
                  {group.rows.map(({ item, index }) => (
                    <div
                      key={item.id}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === safeActive}
                      data-index={index}
                      onMouseMove={() => setActive(index)}
                      onClick={(e) => run(item, e.altKey)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 rounded-[12px] px-[10px] py-[9px] text-left transition-colors duration-[120ms]",
                        index === safeActive ? "bg-sunk" : "bg-transparent",
                      )}
                    >
                      <span className="grid size-[30px] flex-none place-items-center rounded-[9px] bg-sunk">
                        {item.path ? (
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--color-fg-muted)"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d={item.path} />
                          </svg>
                        ) : item.mark ? (
                          "glyph" in item.mark ? (
                            <TypeGlyph type={item.mark.glyph} />
                          ) : (
                            <Icon name={item.mark.icon} className="text-fg-muted" />
                          )
                        ) : null}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-px">
                        <span className="truncate text-[14px] font-medium">{item.label}</span>
                        {item.hint && (
                          <span className="truncate text-xs text-fg-subtle">{item.hint}</span>
                        )}
                      </span>
                      {item.key && (
                        <span className="num text-[10.5px] text-fg-subtle">{item.key}</span>
                      )}
                      <span
                        aria-hidden="true"
                        className="text-[13px] text-accent-ink transition-opacity"
                        style={{ opacity: index === safeActive ? 1 : 0 }}
                      >
                        ↵
                      </span>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          {items.length === 0 && (
            <div
              role="status"
              className="flex flex-col items-center gap-[10px] p-[30px] text-[14px] text-fg-subtle"
              data-state={loading ? "loading" : "empty"}
            >
              {loading ? (
                t("palette.loading")
              ) : (
                <>
                  <Mascot kind={mascot} mood="sleep" size={60} track={false} />
                  {mode === "action-mode" ? t("palette.noAction") : t("palette.nothing")}
                </>
              )}
            </div>
          )}

          <p className="flex gap-[18px] border-t border-border bg-panel px-[18px] py-[10px] text-[11.5px] text-fg-subtle">
            <span>{t("palette.footNavigate")}</span>
            <span>{t("palette.footOpen")}</span>
            <span>{t("palette.footAssistant")}</span>
            <span className="ml-auto">{t("palette.footScreens")}</span>
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
