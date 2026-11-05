"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { projectColor } from "@/design/palette";
import type { ProjectCard } from "@/domain/project-view";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { hrefKeepingState } from "../shell/nav";

/** A thin bar that fills with a spring when it first appears: progress you can watch arrive. */
export function ProgressBar({
  value,
  color,
  label,
  className,
}: {
  /** 0–1, or null for "nothing to measure". */
  value: number | null;
  color: string;
  label: string;
  className?: string;
}) {
  const pct = value === null ? 0 : Math.round(value * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : pct}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-sunk", className)}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-(--ease-state)"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

/**
 * One project as a card: its colour, its name, how far along it is, when it is due and what is
 * left. The whole card is the link; it lifts a little under the pointer.
 */
export function ProjectCardView({ card }: { card: ProjectCard }) {
  const { t, f } = useI18n();
  const params = useSearchParams();
  const color = projectColor(card.color, card.id);
  const late = card.daysLeft !== null && card.daysLeft < 0;
  const total = card.tasksOpen + card.tasksDone;

  return (
    <Link
      href={hrefKeepingState(`/objects/${card.id}`, params)}
      aria-label={t("proj.open", { title: card.title })}
      className="group relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-card border border-border bg-surface p-4 shadow-card transition-[transform,box-shadow] duration-(--duration-panel) ease-(--ease-spring) hover:-translate-y-1 hover:shadow-pop"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1.5"
        style={{ background: color }}
      />
      <div className="flex flex-col gap-1 pt-1">
        <h3 className="truncate text-lg leading-tight font-extrabold">{card.title}</h3>
        {card.description && (
          <p className="line-clamp-2 text-xs text-fg-muted">{card.description}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="label">{t("proj.progress")}</span>
          <span className="num text-sm font-semibold">
            {card.progress === null ? "—" : `${Math.round(card.progress * 100)} %`}
          </span>
        </div>
        <ProgressBar
          value={card.progress}
          color={color}
          label={t("proj.progressOf", { title: card.title })}
        />
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className={cn("num", late ? "font-semibold text-critical" : "text-fg-muted")}>
          {card.targetDate
            ? `${f.date(card.targetDate)} · ${
                late
                  ? t("proj.daysLate", { count: -(card.daysLeft as number) })
                  : t("proj.daysLeft", { count: card.daysLeft as number })
              }`
            : t("proj.noDate")}
        </span>
        <span className="num text-fg-muted">
          {total === 0
            ? t("proj.noTasks")
            : card.tasksOpen === 0
              ? t("proj.allDone")
              : t("proj.tasksLeft", { count: card.tasksOpen })}
          {card.tasksLate > 0 && (
            <span className="ml-2 text-critical">
              {t("proj.tasksLate", { count: card.tasksLate })}
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}

/** The grid of cards. */
export function ProjectCards({ cards }: { cards: readonly ProjectCard[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card, i) => (
        <li
          key={card.id}
          className="rise-in min-w-0"
          style={{ animationDelay: `${Math.min(i, 8) * 60}ms`, animationFillMode: "backwards" }}
        >
          <ProjectCardView card={card} />
        </li>
      ))}
    </ul>
  );
}
