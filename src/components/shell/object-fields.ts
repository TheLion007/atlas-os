import type { EstimateUnit, ObjectType } from "@/domain/enums";
import { hasKey, type MessageKey, type TFunction } from "@/i18n";
import type { Formatters } from "@/i18n/format";
import { formatPercent } from "@/lib/format";

/**
 * How each object type's own fields read on screen. One table drives both the peek panel and
 * the full object page, so a new field is added in exactly one place. Derived values (progress,
 * risk level, slip) never appear here: they come from the engine and are shown separately.
 */
export interface FieldRow {
  key: string;
  label: string;
  value: string;
  /** Numbers, dates and amounts are set in mono. */
  mono: boolean;
}

type Details = Record<string, unknown>;

/** What a field needs to render itself in the interface language. */
export interface Ctx {
  t: TFunction;
  f: Formatters;
}
type Spec = {
  key: string;
  /** Catalogue key of the label, when it is not `field.<key>`. */
  label?: string;
  format?: (v: unknown, d: Details, c: Ctx) => string | null;
  mono?: boolean;
};

const isSet = (v: unknown): boolean => v !== null && v !== undefined && v !== "";
const s = (v: unknown): string => String(v);
const date = (v: unknown, _d: Details, c: Ctx): string | null =>
  typeof v === "string" ? c.f.date(v) : null;
const dateTime = (v: unknown, _d: Details, c: Ctx): string | null =>
  typeof v === "string" ? c.f.dateTime(v) : null;

/** A closed vocabulary value in the interface language; anything else is shown as written. */
const word =
  (prefix: string) =>
  (v: unknown, _d: Details, c: Ctx): string => {
    const key = `${prefix}.${s(v)}`;
    if (hasKey(key)) return c.t(key);
    const text = s(v).replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

function amount(_v: unknown, d: Details, c: Ctx): string | null {
  const value = d.amount;
  if (typeof value !== "number") return null;
  const unit = (d.unit as EstimateUnit | undefined) ?? "currency";
  if (unit === "percent") return `${c.f.number(value, { digits: 2 })}%`;
  if (unit === "area_m2") return `${c.f.number(value, { digits: 1 })} m²`;
  if (unit === "count") return c.f.number(value, { digits: 2 });
  const currency = typeof d.currency === "string" ? d.currency : null;
  if (!currency) return c.f.number(value);
  const suffix =
    unit === "currency_per_month"
      ? c.t("unit.perMonth")
      : unit === "currency_per_year"
        ? c.t("unit.perYear")
        : "";
  return `${c.f.money(value, currency)}${suffix}`;
}

const SPECS: Record<ObjectType, readonly Spec[]> = {
  plan: [{ key: "description" }],
  project: [
    { key: "description" },
    { key: "kind", format: word("kind") },
    { key: "priority", format: (v) => `P${s(v)}`, mono: true },
    { key: "startDate", format: date, mono: true },
    { key: "targetDate", format: date, mono: true },
    {
      key: "budgetAmount",
      format: (v, d, c) =>
        typeof v === "number" && typeof d.budgetCurrency === "string"
          ? c.f.money(v, d.budgetCurrency)
          : null,
      mono: true,
    },
  ],
  sub_project: [{ key: "description" }],
  task: [
    { key: "description" },
    { key: "due", format: date, mono: true },
    {
      key: "effort",
      format: (v, _d, c) => c.f.number(Number(v), { digits: 1 }),
      mono: true,
    },
  ],
  milestone: [
    { key: "date", format: date, mono: true },
    { key: "baselineDate", format: date, mono: true },
    {
      key: "gateCriteria",
      format: (v) =>
        Array.isArray(v) && v.length > 0
          ? v
              .map((g: { text: string; met: boolean }) => `${g.met ? "✓" : "○"} ${g.text}`)
              .join("\n")
          : null,
    },
  ],
  estimate: [
    { key: "amount", format: amount, mono: true },
    { key: "category", format: word("category") },
    { key: "subcategory" },
    {
      key: "costBasis",
      format: (v, d, c) =>
        typeof v === "number" && typeof d.currency === "string" ? c.f.money(v, d.currency) : null,
      mono: true,
    },
    { key: "ticker", mono: true },
    { key: "quantity", format: (v, _d, c) => c.f.number(Number(v), { digits: 4 }), mono: true },
    { key: "source", format: word("source") },
    { key: "asOf", format: date, mono: true },
    { key: "note" },
  ],
  scenario: [{ key: "variant", format: word("scenario") }, { key: "description" }],
  location: [
    { key: "level", format: word("level") },
    { key: "countryCode", mono: true },
    { key: "region" },
    { key: "city" },
    { key: "district" },
    { key: "addressLine" },
    {
      key: "lat",
      format: (v, d) =>
        typeof v === "number" && typeof d.lng === "number"
          ? `${v.toFixed(4)}, ${d.lng.toFixed(4)}${typeof d.coordinatesSource === "string" ? ` (${d.coordinatesSource})` : ""}`
          : null,
      mono: true,
    },
    { key: "category" },
    { key: "studiedOn", format: date, mono: true },
    { key: "verdict" },
  ],
  property: [
    { key: "stage", format: word("stage") },
    {
      key: "sizeM2",
      format: (v, _d, c) => `${c.f.number(Number(v), { digits: 1 })} m²`,
      mono: true,
    },
    { key: "beds", mono: true },
    { key: "listingRef", mono: true },
  ],
  decision: [
    { key: "question" },
    {
      key: "options",
      format: (v) =>
        Array.isArray(v) && v.length > 0
          ? v.map((o: { label: string }) => o.label).join(" · ")
          : null,
    },
    { key: "deadline", format: date, mono: true },
    {
      key: "resolvedOptionId",
      format: (v, d) => {
        const options = (d.options as { id: string; label: string }[] | undefined) ?? [];
        return options.find((o) => o.id === v)?.label ?? null;
      },
    },
    { key: "rationale" },
  ],
  risk: [
    { key: "probability", format: (v) => `${s(v)} / 5`, mono: true },
    { key: "impact", format: (v) => `${s(v)} / 5`, mono: true },
    { key: "mitigation" },
  ],
  note: [
    {
      key: "blocks",
      format: (v) =>
        Array.isArray(v) && v.length > 0
          ? v
              .map((b: { text: string }) => b.text)
              .filter(Boolean)
              .join("\n\n")
          : null,
    },
  ],
  document: [
    { key: "kind", label: "field.documentKind", format: word("documentKind") },
    { key: "description" },
    { key: "issuer" },
    { key: "validUntil", format: date, mono: true },
    { key: "originalName", mono: true },
    { key: "mime", mono: true },
    { key: "sizeBytes", format: (v, _d, c) => formatBytes(Number(v), c), mono: true },
    { key: "source", format: word("source") },
    { key: "uploadedAt", format: dateTime, mono: true },
  ],
  person: [
    { key: "role" },
    { key: "org" },
    { key: "countryCode", mono: true },
    { key: "lastContact", format: date, mono: true },
  ],
  event: [
    { key: "kind", format: word("eventKind") },
    { key: "startsAt", format: dateTime, mono: true },
    {
      key: "durationMinutes",
      format: (v, _d, c) =>
        typeof v === "number"
          ? v >= 1440
            ? c.t("field.days", { count: Math.round(v / 1440) })
            : c.t("field.minutes", { count: v })
          : null,
      mono: true,
    },
  ],
  memory: [{ key: "memoryType", format: word("memoryType") }, { key: "detail" }],
  transaction: [
    {
      key: "amount",
      format: (v, d, c) =>
        typeof v === "number" && typeof d.currency === "string" ? c.f.money(v, d.currency) : null,
      mono: true,
    },
    { key: "kind", label: "field.transactionKind", format: word("transactionKind") },
    { key: "date", label: "field.transactionDate", format: date, mono: true },
    { key: "subcategory" },
    { key: "description" },
    { key: "source", format: word("source") },
  ],
};

/** A file size in the interface language ("482 KB", "1.2 MB"). */
export function formatBytes(bytes: number, c: Pick<Ctx, "f">): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${c.f.number(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${c.f.number(bytes / (1024 * 1024), { digits: 1 })} MB`;
}

/** The visible fields of an object, in a stable order, skipping anything unset. */
export function describeFields(
  type: ObjectType,
  details: Details | undefined,
  ctx: Ctx,
): FieldRow[] {
  const d = details ?? {};
  const rows: FieldRow[] = [];
  for (const spec of SPECS[type]) {
    const raw = d[spec.key];
    if (!isSet(raw)) continue;
    const value = spec.format ? spec.format(raw, d, ctx) : s(raw);
    if (value === null || value === "") continue;
    const labelKey = spec.label ?? `field.${spec.key === "lat" ? "coordinates" : spec.key}`;
    rows.push({
      key: spec.key,
      label: hasKey(labelKey) ? ctx.t(labelKey as MessageKey) : spec.key,
      value,
      mono: spec.mono ?? false,
    });
  }
  return rows;
}

/** For estimates: the provenance kinds. Their labels are in the catalogue (`dataKind.*`). */
export type DataKindName = "actual" | "target" | "estimate" | "scenario" | "assumption";

export const isConfirmed = (dataKind: unknown): boolean => dataKind === "actual";

export { formatPercent };
