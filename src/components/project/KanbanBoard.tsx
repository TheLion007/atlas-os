"use client";

import Link from "next/link";
import { useState, type DragEvent, type KeyboardEvent } from "react";
import { BOARD_COLUMNS, type BoardCard, type BoardColumn } from "@/domain/project-view";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";

interface KanbanBoardProps {
  board: Record<BoardColumn, BoardCard[]>;
  /** Moves a task to another column. `at` is where it landed, for the celebration. */
  onMove: (id: string, to: BoardColumn, at: { x: number; y: number }) => void;
  onOpen?: (id: string) => void;
  /** Where a card leads: the task's own page. */
  hrefFor: (id: string) => string;
  /** The "+" at the head of a column. */
  onAdd: (column: BoardColumn) => void;
  /** The colour of the project, for the group tags. */
  color: string;
}

const CARD_TYPE = "application/x-atlas-task";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * The project's tasks as the design draws them: a column per stage on a dashed ground, cards with
 * a group tag, a round box to finish them, their due date. Drag a card to another column (it lifts
 * and tilts), or focus it and press ← / →. Dropping into Done is the moment of joy.
 */
export function KanbanBoard({ board, onMove, onOpen, hrefFor, onAdd, color }: KanbanBoardProps) {
  const { t, f } = useI18n();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<BoardColumn | null>(null);

  const drop = (e: DragEvent, to: BoardColumn) => {
    e.preventDefault();
    const id = e.dataTransfer.getData(CARD_TYPE) || dragging;
    setOver(null);
    setDragging(null);
    if (id) onMove(id, to, { x: e.clientX, y: e.clientY });
  };

  const key = (e: KeyboardEvent<HTMLElement>, card: BoardCard) => {
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      onOpen?.(card.id);
      return;
    }
    const i = BOARD_COLUMNS.indexOf(card.status);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : i;
    if (next === i || next < 0 || next >= BOARD_COLUMNS.length) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    onMove(card.id, BOARD_COLUMNS[next] as BoardColumn, {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    });
  };

  return (
    <div className="grid grid-cols-[repeat(3,minmax(250px,1fr))] items-start gap-[14px] overflow-x-auto pb-[6px]">
      {BOARD_COLUMNS.map((col) => (
        <section
          key={col}
          aria-label={t(`proj.column.${col}`)}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(col);
          }}
          onDragLeave={() => setOver((c) => (c === col ? null : c))}
          onDrop={(e) => drop(e, col)}
          className={cn(
            "flex min-h-[380px] flex-col gap-[9px] rounded-[18px] p-[10px] outline-2 -outline-offset-2 transition-colors duration-[250ms]",
            over === col
              ? "bg-accent-soft outline-dashed outline-accent"
              : "bg-heat-0 outline-dashed outline-transparent",
          )}
        >
          <header className="flex items-center gap-2 px-[6px] pt-1 pb-[2px]">
            <h3 className="font-display text-[14px] font-bold">{t(`proj.column.${col}`)}</h3>
            <span className="num text-[11px] text-fg-subtle">{board[col].length}</span>
            <span className="flex-1" />
            <button
              type="button"
              title={t("proj.addTask")}
              aria-label={`${t("proj.addTask")} — ${t(`proj.column.${col}`)}`}
              onClick={() => onAdd(col)}
              className="grid size-[26px] place-items-center rounded-[8px] text-fg-subtle transition-colors hover:bg-surface hover:text-fg"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </header>
          <ul className="flex flex-col gap-[9px]">
            {board[col].map((card) => (
              <li
                key={card.id}
                draggable
                tabIndex={0}
                aria-label={t("proj.cardLabel", {
                  title: card.title,
                  column: t(`proj.column.${col}`),
                })}
                onKeyDown={(e) => key(e, card)}
                onDoubleClick={() => onOpen?.(card.id)}
                onDragStart={(e) => {
                  e.dataTransfer.setData(CARD_TYPE, card.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragging(card.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setOver(null);
                }}
                className={cn(
                  "pop-in flex cursor-grab flex-col gap-[10px] rounded-[14px] border border-border bg-surface px-[13px] py-3 shadow-card transition-[transform,box-shadow,opacity] duration-[450ms] hover:-translate-y-[3px] hover:rotate-[0.5deg] hover:shadow-pop active:cursor-grabbing",
                  dragging === card.id && "rotate-2 opacity-60",
                )}
                style={{ transitionTimingFunction: SPRING }}
              >
                {card.group && (
                  <div className="flex flex-wrap gap-[5px]">
                    <span
                      className="rounded-[6px] px-2 py-[2px] text-[11px] font-semibold"
                      style={{
                        background: `color-mix(in srgb, ${color} 18%, transparent)`,
                        color: "var(--color-fg-muted)",
                      }}
                    >
                      {card.group}
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-[10px]">
                  <button
                    type="button"
                    data-sound="none"
                    aria-label={t("hm.finish")}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      onMove(card.id, col === "done" ? "active" : "done", {
                        x: r.left + r.width / 2,
                        y: r.top + r.height / 2,
                      });
                    }}
                    className={cn(
                      "mt-px grid size-[19px] flex-none place-items-center rounded-full border-[1.6px] p-0 transition-all duration-[350ms] hover:scale-[1.15] hover:border-accent",
                      col === "done"
                        ? "border-positive bg-positive"
                        : "border-fg-subtle bg-transparent",
                    )}
                    style={{ transitionTimingFunction: SPRING }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="3.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path
                        d="M5 12.5l4.5 4.5L19 7.5"
                        strokeDasharray="22"
                        strokeDashoffset={col === "done" ? 0 : 22}
                        style={{ transition: "stroke-dashoffset .3s" }}
                      />
                    </svg>
                  </button>
                  <Link
                    href={hrefFor(card.id)}
                    draggable={false}
                    className={cn(
                      "text-[14px] leading-[1.35] font-medium hover:underline",
                      col === "done" && "text-fg-muted line-through",
                    )}
                  >
                    {card.title}
                  </Link>
                </div>
                <div className="flex items-center justify-between text-[11.5px]">
                  <span
                    className={cn("font-semibold", card.late ? "text-critical" : "text-fg-subtle")}
                  >
                    {card.due ? f.date(card.due) : t("home.noDate")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
