"use client";

import type { ReactNode } from "react";
import type { RelationGroups, RelationItem } from "@/domain/api-types";
import { EDGE_KINDS, type EdgeKind } from "@/domain/enums";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { Icon } from "./Icon";
import { ObjectChip } from "./ObjectChip";

interface RelationListProps {
  groups: RelationGroups;
  onPeek?: (id: string) => void;
  /** When provided, each verb offers a control to link an existing object. */
  onAdd?: (kind: EdgeKind) => void;
  /** When provided, each relation gets its own small unlink control — for undoing a link made
   *  by mistake, never the object at the other end of it. */
  onRemove?: (edgeId: string) => void;
  /** Where Enter goes for a related object. */
  hrefFor?: (id: string) => string;
  /** Add mode: shows this slot (e.g. an object picker) under the list. */
  addSlot?: ReactNode;
  className?: string;
}

function metaFor(kind: EdgeKind, item: RelationItem): string | undefined {
  if (kind === "depends_on") {
    const lag = item.lagDays ?? 0;
    const type = item.dependencyType && item.dependencyType !== "fs" ? item.dependencyType : null;
    const parts = [lag !== 0 ? `${lag > 0 ? "+" : "−"}${Math.abs(lag)} d` : null, type];
    return parts.filter(Boolean).join(" · ") || undefined;
  }
  return item.label ?? undefined;
}

/**
 * Everything an object is connected to, grouped by edge verb, with the direction spelled out
 * ("Depends on" versus "Required by"). Empty verbs are omitted; if there are none at all, it
 * says so. States: grouped-by-verb · empty · add-mode.
 */
export function RelationList({
  groups,
  onPeek,
  hrefFor,
  onAdd,
  onRemove,
  addSlot,
  className,
}: RelationListProps) {
  const { t } = useI18n();
  const present = EDGE_KINDS.filter(
    (k) => groups[k].outgoing.length > 0 || groups[k].incoming.length > 0,
  );

  if (present.length === 0 && !onAdd && !addSlot) {
    return (
      <p className={cn("text-fg-muted", className)} data-state="empty">
        {t("rel.empty")}
      </p>
    );
  }

  return (
    <div
      className={cn("flex flex-col gap-6", className)}
      data-state={addSlot ? "add-mode" : "grouped"}
    >
      {present.map((kind) => (
        <div
          key={kind}
          role="group"
          aria-label={t(`verb.${kind}.out`)}
          className="flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="label">{t(`edge.${kind}`)}</h3>
            {onAdd && (
              <button
                type="button"
                onClick={() => onAdd(kind)}
                className="rounded-control border border-border px-2 py-1 text-xs transition-colors duration-(--duration-hover) hover:bg-hover"
              >
                {t("rel.add", { verb: t(`verb.${kind}.out`).toLowerCase() })}
              </button>
            )}
          </div>
          {(["outgoing", "incoming"] as const).map((direction) => {
            const items = groups[kind][direction];
            if (items.length === 0) return null;
            return (
              <div key={direction} className="flex flex-col gap-2">
                <p className="text-xs text-fg-muted">
                  {t(`verb.${kind}.${direction === "outgoing" ? "out" : "in"}`)}
                </p>
                <ul className="flex flex-col items-start gap-2">
                  {items.map((item) => (
                    <li key={item.edgeId} className="flex max-w-full items-center gap-1">
                      <ObjectChip
                        object={item.object}
                        href={hrefFor?.(item.object.id)}
                        onPeek={onPeek}
                        meta={metaFor(kind, item)}
                      />
                      {onRemove && (
                        <button
                          type="button"
                          onClick={() => onRemove(item.edgeId)}
                          aria-label={t("rel.remove", { title: item.object.title })}
                          title={t("rel.remove", { title: item.object.title })}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors duration-(--duration-hover) hover:bg-hover hover:text-fg"
                        >
                          <Icon name="close" size={12} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ))}
      {addSlot}
    </div>
  );
}
