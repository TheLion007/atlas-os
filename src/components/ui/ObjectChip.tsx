"use client";

import Link from "next/link";
import type { KeyboardEvent, MouseEvent } from "react";
import type { LifecycleStatus, ObjectType } from "@/domain/enums";
import { contextColorHex } from "@/design/tokens";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { TypeGlyph } from "./TypeGlyph";

export interface ChipObject {
  id: string;
  type: ObjectType;
  title: string;
  status?: LifecycleStatus;
}

interface ObjectChipProps {
  /** `null` means the reference points at an object that no longer exists (broken-ref). */
  object: ChipObject | null;
  selected?: boolean;
  /** Not touched for a long time; shown quieter. */
  stale?: boolean;
  /** Where Enter goes: "one object, one page". */
  href?: string;
  /** Click or Space: peek before commit. */
  onPeek?: (id: string) => void;
  /** Trailing detail, e.g. a date or a lag. Mono, muted. */
  meta?: string;
  /** A context colour token (e.g. a Memory's inherited project colour) — a small dot, never a
   * fill: colour marks context here, it never replaces the type glyph. */
  contextColor?: string | null;
  className?: string;
}

/**
 * The atom of the product: a type glyph and a title that stands for any object. Space (or a
 * plain click) peeks, Enter opens the object's own page. States: rest, hover, selected, stale,
 * broken-ref.
 */
export function ObjectChip({
  object,
  selected = false,
  stale = false,
  href,
  onPeek,
  meta,
  contextColor,
  className,
}: ObjectChipProps) {
  const { t } = useI18n();
  const base =
    "inline-flex max-w-full items-center gap-2 rounded-control border px-2 py-1 text-sm transition-colors duration-(--duration-hover)";

  if (object === null) {
    return (
      <span
        className={cn(base, "border-dashed border-border text-fg-muted line-through", className)}
        data-state="broken-ref"
        title={t("common.missingObjectHint")}
      >
        <span aria-hidden="true" className="num text-xs">
          ×
        </span>
        <span>{t("common.missingObject")}</span>
      </span>
    );
  }

  const state = selected ? "selected" : stale ? "stale" : "rest";
  const classes = cn(
    base,
    "min-w-0 text-left",
    selected
      ? "border-fg-muted bg-selected text-fg"
      : "border-border hover:bg-hover " + (stale ? "text-fg-muted" : "text-fg"),
    className,
  );

  const contextHex = contextColorHex(contextColor);
  const content = (
    <>
      {contextHex && (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: contextHex }}
        />
      )}
      <TypeGlyph type={object.type} />
      <span className="truncate">{object.title}</span>
      <span className="sr-only">, {t(`type.${object.type}`)}</span>
      {stale && <span className="sr-only">, {t("common.stale")}</span>}
      {meta && <span className="num shrink-0 text-xs text-fg-muted">{meta}</span>}
    </>
  );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === " " && onPeek) {
      e.preventDefault();
      onPeek(object.id);
    }
  };

  if (href) {
    const onClick = (e: MouseEvent) => {
      const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
      if (onPeek && !modified) {
        e.preventDefault();
        onPeek(object.id);
      }
    };
    return (
      <Link
        href={href}
        className={classes}
        data-state={state}
        aria-current={selected ? "true" : undefined}
        onClick={onClick}
        onKeyDown={onKeyDown}
        title={onPeek ? t("common.peekHint") : undefined}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      data-state={state}
      aria-pressed={onPeek ? selected : undefined}
      onClick={() => onPeek?.(object.id)}
      onKeyDown={onKeyDown}
      disabled={!onPeek}
    >
      {content}
    </button>
  );
}
