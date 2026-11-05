"use client";

import { useMemo, useState } from "react";
import {
  describeWriteError,
  useCreateEdge,
  useDeleteEdge,
  useFiles,
  useGraph,
} from "@/client/hooks";
import type { ApiObjectWithRelations } from "@/domain/api-types";
import { documentFormat, previewKind } from "@/domain/documents";
import { OBJECT_TYPES, type ObjectType, type TransactionKind } from "@/domain/enums";
import { financeRole } from "@/domain/finance";
import { LINKABLE_TYPES, linkPlan } from "@/domain/linking";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { Icon } from "../ui/Icon";
import { RelationList } from "../ui/RelationList";

const str = (d: Record<string, unknown> | undefined, k: string): string | null => {
  const v = d?.[k];
  return typeof v === "string" && v !== "" ? v : null;
};

const smallButton =
  "inline-flex h-8 items-center gap-2 rounded-control border border-border px-3 text-sm text-fg-muted transition-colors duration-(--duration-hover) hover:bg-hover hover:text-fg";

/**
 * The document's file, shown the way its format allows: a PDF in the browser's own viewer, an
 * image as an image, text as text. Anything else shows its facts and a download. A document
 * recorded without its file says so — nothing pretends to be there.
 */
export function DocumentPreview({
  object,
  variant,
}: {
  object: ApiObjectWithRelations;
  variant: "panel" | "page";
}) {
  const { t } = useI18n();
  const files = useFiles();
  const d = object.details;
  const mime = str(d, "mime") ?? "application/octet-stream";
  const name = str(d, "originalName") ?? object.title;
  const format = documentFormat(mime, name);
  const kind = previewKind(format, mime);
  const url = files.url(str(d, "storagePath"));
  const text = str(d, "contentText");
  const tall = variant === "page" ? "h-[70vh]" : "h-96";

  if (!str(d, "storagePath"))
    return <p className="text-sm text-fg-muted">{t("documents.preview.noFile")}</p>;
  if (!url) return <p className="text-sm text-fg-muted">{t("documents.preview.unavailable")}</p>;

  return (
    <div className="flex flex-col gap-3">
      {kind === "pdf" && (
        <iframe
          src={url}
          title={t("documents.preview.of", { title: object.title })}
          className={cn("w-full rounded-control border border-border bg-surface", tall)}
        />
      )}
      {kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- a private blob/API URL, not a static asset
        <img
          src={url}
          alt={object.title}
          className="max-h-[70vh] w-full rounded-control border border-border object-contain"
        />
      )}
      {kind === "text" && (
        <pre
          className={cn(
            "overflow-auto rounded-control border border-border p-3 text-xs whitespace-pre-wrap",
            variant === "page" ? "max-h-[70vh]" : "max-h-96",
          )}
        >
          {text ?? t("documents.preview.textNotRead")}
        </pre>
      )}
      {kind === "none" && (
        <p className="text-sm text-fg-muted">
          {t("documents.preview.none", { format: t(`documents.format.${format}` as never) })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <a href={url} target="_blank" rel="noreferrer" className={smallButton}>
          <Icon name="external" />
          {t("documents.open")}
        </a>
        <a href={url} download={name} className={smallButton}>
          <Icon name="download" />
          {t("documents.download")}
        </a>
      </div>
      <p className="text-xs text-fg-muted">
        {text !== null ? t("documents.content.indexed") : t("documents.content.notIndexed")}
      </p>
    </div>
  );
}

/** Object types that get the generic "Link to…" control on their detail view — every type, so
 *  anything in Atlas can be related to anything else the same easy way. */
export const LINK_HOSTS: readonly ObjectType[] = OBJECT_TYPES;

/**
 * Relates this object to another existing one. The person picks *what*; the relation kind
 * follows from the two types (`linkPlan`): a memory backed by a document, a value of a project,
 * a document about an expense…
 */
export function LinkControl({ object }: { object: ApiObjectWithRelations }) {
  const { t, f, typeLabel } = useI18n();
  const graph = useGraph();
  const createEdge = useCreateEdge();
  const [picked, setPicked] = useState("");
  const [error, setError] = useState<string | null>(null);
  const linked = useMemo(() => {
    const ids = new Set<string>([object.id]);
    for (const group of Object.values(object.relations))
      for (const item of [...group.outgoing, ...group.incoming]) ids.add(item.object.id);
    return ids;
  }, [object]);
  // Objects that already sit at a place: linking one of these to a second location is a
  // relationship between two places (an arc on the globe), not a relocation.
  const alreadyLocated = useMemo(() => {
    const ids = new Set<string>();
    for (const e of graph.data?.edges ?? []) if (e.kind === "located_at") ids.add(e.from);
    return (id: string) => ids.has(id);
  }, [graph.data]);
  const options = useMemo(
    () =>
      (graph.data?.nodes ?? [])
        .filter(
          (n) =>
            LINKABLE_TYPES.includes(n.type) &&
            !linked.has(n.id) &&
            linkPlan(object, n, { alreadyLocated }) !== null,
        )
        .sort(
          (a, b) =>
            LINKABLE_TYPES.indexOf(a.type) - LINKABLE_TYPES.indexOf(b.type) ||
            a.title.localeCompare(b.title),
        ),
    [graph.data, linked, object, alreadyLocated],
  );
  if (options.length === 0) return null;
  const byType = new Map<ObjectType, typeof options>();
  for (const o of options) byType.set(o.type, [...(byType.get(o.type) ?? []), o]);

  const add = () => {
    const other = options.find((o) => o.id === picked);
    if (!other) return;
    const plan = linkPlan(object, other, { alreadyLocated });
    if (!plan) return;
    setError(null);
    createEdge.mutate(
      { kind: plan.kind, from: plan.from, to: plan.to, label: plan.label ?? null },
      {
        onSuccess: () => setPicked(""),
        onError: (e) => setError(describeWriteError(e, t)),
      },
    );
  };

  const id = `link-${object.id}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          {t("link.label")}
        </label>
        <select
          id={id}
          value={picked}
          onChange={(e) => setPicked(e.target.value)}
          className="h-8 min-w-0 grow rounded-control border border-border bg-transparent px-2 text-sm"
        >
          <option value="">{t("link.label")}</option>
          {[...byType.entries()].map(([type, list]) => (
            <optgroup key={type} label={typeLabel(type, true)}>
              {list.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                  {/* Transactions often share a name ("Groceries"): the date tells them apart. */}
                  {n.type === "transaction" && typeof n.details?.date === "string"
                    ? ` · ${f.date(n.details.date)}`
                    : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          disabled={!picked || createEdge.isPending}
          onClick={add}
          aria-label={t("link.add")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-control border border-border text-fg-muted transition-colors duration-(--duration-hover) hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="plus" />
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-fg">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The relations list with its unlink control. Split out from `ObjectView` so the delete-edge
 * mutation (and the data layer it needs) is only ever mounted where a host actually supplies
 * `actions` — the same gate `LinkControl` uses to add a link in the first place.
 */
export function RelationsWithRemove({
  object,
  onPeek,
  hrefFor,
}: {
  object: ApiObjectWithRelations;
  onPeek?: (id: string) => void;
  hrefFor?: (id: string) => string;
}) {
  const { t } = useI18n();
  const deleteEdge = useDeleteEdge();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <RelationList
        groups={object.relations}
        onPeek={onPeek}
        hrefFor={hrefFor}
        onRemove={(edgeId) => {
          setError(null);
          deleteEdge.mutate(edgeId, { onError: (e) => setError(describeWriteError(e, t)) });
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-fg">
          {error}
        </p>
      )}
    </div>
  );
}

/** An investment's return, computed from its value and invested capital (never stored). */
export function InvestmentReturn({ object }: { object: ApiObjectWithRelations }) {
  const { t, f } = useI18n();
  const d = object.details;
  const amount = typeof d?.amount === "number" ? d.amount : null;
  const cost = typeof d?.costBasis === "number" ? d.costBasis : null;
  const currency = str(d, "currency");
  if (amount === null || cost === null || !currency) return null;
  const gain = amount - cost;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-fg-muted">{t("finance.return")}</span>
      <span className="num">
        {gain >= 0 ? "+" : "−"}
        {f.money(Math.abs(gain), currency)}
      </span>
      {cost !== 0 && (
        <span className="num text-fg-muted">
          {gain >= 0 ? "+" : "−"}
          {f.percent(Math.abs(gain / cost))}
        </span>
      )}
    </p>
  );
}

/** An Estimate playing the role of an account — cash, an investment holding, a liability — the
 *  kinds of value a transaction can name as "the account it moved through" (see
 *  `domain/finance.ts#financeRole`). */
export function isAccountLike(object: Pick<ApiObjectWithRelations, "details">): boolean {
  const role = financeRole(object);
  return role === "cash" || role === "investment" || role === "liability";
}

interface LedgerEntry {
  id: string;
  title: string;
  date: string;
  kind: TransactionKind;
  amount: number;
  currency: string | null;
}

/**
 * An account's real activity: every transaction linked to it as its account (never one merely
 * related to it some other way), oldest first, with a running balance that starts from the
 * account's own recorded amount and moves with each income or expense dated after its "as of"
 * date. Transfers, investments and withdrawals did move through this account and are shown, but
 * are not counted — the same rule `domain/finance.ts#monthlyFlows` uses for the rest of Finance.
 */
export function AccountLedger({ object }: { object: ApiObjectWithRelations }) {
  const { t, f } = useI18n();
  const graph = useGraph();
  const d = object.details;
  const balance = typeof d?.amount === "number" ? d.amount : null;
  const currency = str(d, "currency");
  const asOf = str(d, "asOf");

  const entries = useMemo(() => {
    const byId = new Map((graph.data?.nodes ?? []).map((n) => [n.id, n]));
    const out: LedgerEntry[] = [];
    for (const item of object.relations.references.incoming) {
      if (item.label !== "account") continue;
      const n = byId.get(item.object.id);
      if (!n || n.type !== "transaction") continue;
      const nd = n.details;
      const amount = typeof nd?.amount === "number" ? nd.amount : null;
      const date = typeof nd?.date === "string" ? nd.date : null;
      if (amount === null || !date) continue;
      out.push({
        id: n.id,
        title: n.title,
        date,
        kind: (typeof nd?.kind === "string" ? nd.kind : "expense") as TransactionKind,
        amount,
        currency: typeof nd?.currency === "string" ? nd.currency : null,
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  }, [graph.data, object.relations]);

  if (balance === null || entries.length === 0) return null;

  const counts = (e: LedgerEntry) =>
    e.currency === currency &&
    (e.kind === "income" || e.kind === "expense") &&
    e.date > (asOf ?? "");
  const delta = entries.reduce(
    (s, e) => (counts(e) ? s + (e.kind === "income" ? e.amount : -e.amount) : s),
    0,
  );
  const tracked = balance + delta;
  const otherCurrency = entries.filter((e) => currency && e.currency !== currency).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-fg-muted">{t("finance.trackedBalance")}</span>
        <span className="num">{currency ? f.money(tracked, currency) : f.number(tracked)}</span>
      </p>
      <p className="text-xs text-fg-muted">{t("finance.trackedBalanceHint")}</p>
      <ul className="flex flex-col gap-1">
        {entries.map((e) => {
          const counted = counts(e);
          const sign = e.kind === "income" ? "+" : e.kind === "expense" ? "−" : "";
          return (
            <li
              key={e.id}
              className={cn(
                "flex items-center justify-between gap-3 text-sm",
                !counted && "text-fg-muted",
              )}
            >
              <span className="min-w-0 truncate">
                {f.date(e.date)} · {e.title}
              </span>
              <span className="num shrink-0">
                {sign}
                {e.currency ? f.money(e.amount, e.currency) : f.number(e.amount)}
              </span>
            </li>
          );
        })}
      </ul>
      {otherCurrency > 0 && (
        <p className="text-xs text-fg-muted">
          {t("finance.ledgerOtherCurrency", { count: otherCurrency })}
        </p>
      )}
    </div>
  );
}
