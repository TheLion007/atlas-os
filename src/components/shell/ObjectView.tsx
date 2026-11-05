"use client";

import { useState, type ReactNode } from "react";
import { useCreateEdge, useGraph } from "@/client/hooks";
import { contextColorHex } from "@/design/tokens";
import type { ApiObjectWithRelations } from "@/domain/api-types";
import type { ResolvedContext } from "@/domain/context-color";
import { isExample, visibleTags } from "@/domain/creation";
import type { MemoryProvenance } from "@/domain/memory";
import type { ObjectFacts } from "@/domain/object-facts";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { ConfidenceMeter } from "../ui/ConfidenceMeter";
import { Icon } from "../ui/Icon";
import { ObjectChip } from "../ui/ObjectChip";
import { ProgressRail } from "../ui/ProgressRail";
import { RelationList } from "../ui/RelationList";
import { StatusBadge } from "../ui/StatusBadge";
import { TypeGlyph } from "../ui/TypeGlyph";
import { describeFields, isConfirmed, type DataKindName } from "./object-fields";
import {
  AccountLedger,
  DocumentPreview,
  InvestmentReturn,
  isAccountLike,
  LINK_HOSTS,
  LinkControl,
  RelationsWithRemove,
} from "./object-extras";

interface ObjectViewProps {
  object: ApiObjectWithRelations;
  facts?: ObjectFacts | null;
  /** Memory only: its resolved display colour and primary/secondary project context. */
  memoryContext?: ResolvedContext | null;
  /** Memory only: why Atlas remembers it. */
  memoryProvenance?: MemoryProvenance | null;
  onPeek?: (id: string) => void;
  hrefFor?: (id: string) => string;
  /** `panel` is the 440px peek; `page` is the full object page. Same content, same renderer. */
  variant?: "panel" | "page";
  /** Edit, delete and add-to controls, supplied by the host (they need the data layer). */
  actions?: ReactNode;
}

/** Add another project as a secondary context — an `about` edge with no "primary" label, so the
 * existing primary (or the oldest edge, if none is labelled) keeps determining the colour. */
function AddContextControl({
  memoryId,
  excludeIds,
}: {
  memoryId: string;
  excludeIds: readonly string[];
}) {
  const { t } = useI18n();
  const graph = useGraph();
  const createEdge = useCreateEdge();
  const [picked, setPicked] = useState("");
  const excluded = new Set(excludeIds);
  const options = (graph.data?.nodes ?? []).filter(
    (n) =>
      (n.type === "project" || n.type === "sub_project" || n.type === "plan") &&
      !excluded.has(n.id),
  );
  if (options.length === 0) return null;

  const add = () => {
    if (!picked) return;
    createEdge.mutate(
      { kind: "about", from: memoryId, to: picked },
      { onSuccess: () => setPicked("") },
    );
  };

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="memory-add-context" className="sr-only">
        {t("memory.addContext")}
      </label>
      <select
        id="memory-add-context"
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        className="h-8 rounded-control border border-border bg-transparent px-2 text-sm"
      >
        <option value="">{t("memory.addContext")}</option>
        {options.map((n) => (
          <option key={n.id} value={n.id}>
            {n.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!picked || createEdge.isPending}
        onClick={add}
        className="inline-flex size-8 items-center justify-center rounded-control border border-border text-fg-muted transition-colors duration-(--duration-hover) hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={t("memory.addContext")}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}

/**
 * A memory's project context and provenance — "which project is this about" and "why does Atlas
 * remember this" (ADR 0002 §3, §9). Colour is read off the resolved context, never off the memory
 * itself: nothing here is duplicated presentation data.
 */
function MemorySection({
  objectId,
  context,
  provenance,
  onPeek,
  hrefFor,
}: {
  objectId: string;
  context: ResolvedContext;
  provenance: MemoryProvenance;
  onPeek?: (id: string) => void;
  hrefFor?: (id: string) => string;
}) {
  const { t } = useI18n();
  const contextIds = [context.primary, ...context.secondary].flatMap((c) => (c ? [c.id] : []));

  return (
    <>
      <Section title={t("memory.context")}>
        <div className="flex flex-wrap items-center gap-2">
          {context.primary ? (
            <ObjectChip
              object={context.primary}
              contextColor={context.primary.color}
              onPeek={onPeek}
              href={hrefFor?.(context.primary.id)}
            />
          ) : (
            <span className="text-fg-muted">{t("memory.noContext")}</span>
          )}
          {context.secondary.map((s) => (
            <ObjectChip
              key={s.id}
              object={s}
              contextColor={s.color}
              onPeek={onPeek}
              href={hrefFor?.(s.id)}
              className="opacity-75"
            />
          ))}
        </div>
        <AddContextControl memoryId={objectId} excludeIds={contextIds} />
      </Section>
      <Section title={t("memory.provenance")}>
        <div className="flex flex-col gap-2">
          <p className="text-fg-muted">{t(`memory.source.${provenance.sourceKind}`)}</p>
          {provenance.derivedFrom.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-fg-muted">{t("memory.derivedFrom")}</span>
              {provenance.derivedFrom.map((c) => (
                <ObjectChip key={c.id} object={c} onPeek={onPeek} href={hrefFor?.(c.id)} />
              ))}
            </div>
          )}
          {provenance.supportedBy.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-fg-muted">{t("memory.supportedBy")}</span>
              {provenance.supportedBy.map((c) => (
                <ObjectChip key={c.id} object={c} onPeek={onPeek} href={hrefFor?.(c.id)} />
              ))}
            </div>
          )}
        </div>
      </Section>
    </>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-[15px] font-bold">{title}</h3>
        {note && <span className="text-xs text-fg-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * One object, rendered the same way everywhere: identity, its own fields, the values derived
 * from it (labelled as computed, never stored), and its relations grouped by verb. The peek
 * panel and the object page both render this.
 */
export function ObjectView({
  object,
  facts,
  memoryContext,
  memoryProvenance,
  onPeek,
  hrefFor,
  variant = "panel",
  actions,
}: ObjectViewProps) {
  const { t, f, typeLabel } = useI18n();
  const fields = describeFields(object.type, object.details, { t, f });
  const dataKind =
    object.type === "estimate" ? (object.details?.dataKind as DataKindName | undefined) : undefined;
  const tags = visibleTags(object.tags);
  const blocked = (facts?.blockedBy.length ?? 0) > 0;

  return (
    <article className={cn("flex flex-col gap-6", variant === "page" && "max-w-3xl")}>
      <header className="flex flex-col gap-3">
        <p className="label flex items-center gap-2">
          {memoryContext?.color && (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: contextColorHex(memoryContext.color) ?? undefined }}
            />
          )}
          <TypeGlyph type={object.type} />
          {typeLabel(object.type)}
          {isExample(object) && (
            <span
              title={t("object.exampleHint")}
              className="rounded-[8px] bg-sunk px-2 py-1 text-fg-muted"
            >
              {t("common.example")}
            </span>
          )}
        </p>
        <h2
          className={cn(
            "font-display font-extrabold tracking-[-0.02em] text-balance",
            variant === "page" ? "text-[32px] leading-[1.1]" : "text-[24px] leading-[1.15]",
          )}
        >
          {object.title}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={object.status} blocked={blocked} />
          {object.confidence !== null || object.type === "estimate" ? (
            <ConfidenceMeter score={object.confidence} showLabel />
          ) : null}
          {dataKind && (
            <span className="label rounded-[8px] bg-sunk px-2 py-1">
              {t(`dataKind.${dataKind}`)}
            </span>
          )}
        </div>
        {actions}
        {dataKind && !isConfirmed(dataKind) && (
          <p className="text-xs text-fg-muted">
            {t("dataKind.notConfirmed", {
              kind: t(
                `dataKind.a${dataKind.charAt(0).toUpperCase()}${dataKind.slice(1)}` as "dataKind.aActual",
              ),
            })}
          </p>
        )}
        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <li key={t} className="label rounded-[8px] bg-sunk px-2 py-1">
                {t}
              </li>
            ))}
          </ul>
        )}
      </header>

      {object.type === "document" && (
        <Section title={t("documents.preview.title")}>
          <DocumentPreview object={object} variant={variant} />
        </Section>
      )}

      {fields.length > 0 && (
        <Section title={t("obj.details")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            {fields.map((f) => (
              <div key={f.key} className="col-span-2 grid grid-cols-subgrid">
                <dt className="text-fg-muted">{f.label}</dt>
                <dd className={cn("min-w-0 break-words whitespace-pre-line", f.mono && "num")}>
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {facts && hasFacts(facts) && (
        <Section title={t("obj.derived")} note={t("obj.derivedNote")}>
          <div className="flex flex-col gap-3">
            {facts.progress && (
              <div className="flex flex-col gap-2">
                <p className="text-fg-muted">{t("obj.progress")}</p>
                <ProgressRail
                  label={t("cc.progressOf", { title: object.title })}
                  actual={facts.progress.progress}
                />
              </div>
            )}
            {facts.riskLevel && (
              <p className="flex items-center gap-2">
                <span className="text-fg-muted">{t("obj.riskLevel")}</span>
                <span className="label rounded-[8px] bg-sunk px-2 py-1 text-fg">
                  {t(`risk.${facts.riskLevel}`)}
                </span>
              </p>
            )}
            {facts.schedule && facts.schedule.date && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-fg-muted">{t("obj.scheduled")}</span>
                <span className="num">{f.date(facts.schedule.date)}</span>
                {facts.schedule.slipDays !== null && facts.schedule.slipDays !== 0 && (
                  <span className="num text-fg-muted">
                    {t("tl.vsBaseline", {
                      delta: `${facts.schedule.slipDays > 0 ? "+" : "−"}${Math.abs(facts.schedule.slipDays)}`,
                    })}
                  </span>
                )}
              </p>
            )}
            {facts.schedule?.drivenBy && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-fg-muted">{t("obj.pushedBy")}</span>
                <ObjectChip
                  object={facts.schedule.drivenBy}
                  onPeek={onPeek}
                  href={hrefFor?.(facts.schedule.drivenBy.id)}
                />
              </div>
            )}
            {facts.blockedBy.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-fg-muted">{t("obj.blockedBy")}</p>
                <ul className="flex flex-col items-start gap-2">
                  {facts.blockedBy.map((b) => (
                    <li key={b.id} className="max-w-full">
                      <ObjectChip object={b} onPeek={onPeek} href={hrefFor?.(b.id)} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {facts.broken.length > 0 && (
              <p className="text-fg-muted">
                {t("obj.broken", { items: facts.broken.map((b) => b.title).join(", ") })}
              </p>
            )}
          </div>
        </Section>
      )}

      {object.type === "estimate" && typeof object.details?.costBasis === "number" && (
        <Section title={t("obj.derived")} note={t("obj.derivedNote")}>
          <InvestmentReturn object={object} />
        </Section>
      )}

      {object.type === "estimate" &&
        isAccountLike(object) &&
        object.relations.references.incoming.some((r) => r.label === "account") && (
          <Section title={t("finance.ledger")} note={t("obj.derivedNote")}>
            <AccountLedger object={object} />
          </Section>
        )}

      {object.type === "memory" && memoryContext && memoryProvenance && (
        <MemorySection
          objectId={object.id}
          context={memoryContext}
          provenance={memoryProvenance}
          onPeek={onPeek}
          hrefFor={hrefFor}
        />
      )}

      <Section title={t("obj.relations")}>
        {/* Undoing a link needs the data layer, same as adding one: offered only where the host
            supplies actions, so this view stays free of it otherwise. */}
        {actions ? (
          <RelationsWithRemove object={object} onPeek={onPeek} hrefFor={hrefFor} />
        ) : (
          <RelationList groups={object.relations} onPeek={onPeek} hrefFor={hrefFor} />
        )}
        {actions && LINK_HOSTS.includes(object.type) && <LinkControl object={object} />}
      </Section>

      <p className="num text-xs text-fg-muted">
        {t("obj.updated", { date: f.date(object.updatedAt.slice(0, 10)) })}
        {facts?.progress?.progress != null &&
          ` · ${t("obj.complete", { percent: f.percent(facts.progress.progress) })}`}
      </p>
    </article>
  );
}

function hasFacts(f: ObjectFacts): boolean {
  return (
    f.progress !== null ||
    f.riskLevel !== null ||
    (f.schedule?.date ?? null) !== null ||
    f.blockedBy.length > 0 ||
    f.broken.length > 0
  );
}
