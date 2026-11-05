import type { ActivityEntry } from "@/domain/api-types";
import { isValidIsoDate } from "@/domain/dates";
import { hasKey, type TFunction } from "@/i18n";
import type { Formatters } from "@/i18n/format";

/** Plain-language wording for the activity feed, from the audit log's field-level diffs. */
export interface Ctx {
  t: TFunction;
  f: Formatters;
}

/** "target_date" / "targetDate" → "target date". */
export function humanize(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

const camel = (key: string): string => key.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

/** A field's name in the interface language, when the catalogue knows it. */
function fieldName(field: string, { t }: Ctx): string {
  if (field === "status") return t("form.status").toLowerCase();
  if (field === "title") return t("form.title").toLowerCase();
  const key = `field.${camel(field)}`;
  return hasKey(key) ? t(key).toLowerCase() : humanize(field);
}

function formatValue(v: unknown, ctx: Ctx): string {
  if (v === null || v === undefined || v === "") return ctx.t("activity.none");
  if (typeof v === "number") return ctx.f.number(v, { digits: 2 });
  if (typeof v === "string") {
    if (isValidIsoDate(v)) return ctx.f.date(v);
    const status = `status.${v}`;
    return hasKey(status) ? ctx.t(status).toLowerCase() : v;
  }
  return "…";
}

export interface ActivityLine {
  verb: string;
  /** What changed, e.g. "status: active → done". */
  detail: string | null;
}

const MAX_FIELDS = 2;

export function describeActivity(a: ActivityEntry, ctx: Ctx): ActivityLine {
  const { t } = ctx;
  const verb = t(`activity.${a.action}`);
  if (a.action === "related" || a.action === "unrelated") {
    const kind = typeof a.diff.kind === "string" ? a.diff.kind : null;
    const key = `edge.${kind}`;
    return { verb, detail: kind ? (hasKey(key) ? t(key) : humanize(kind)) : null };
  }
  if (a.action !== "updated") return { verb, detail: null };

  const parts: string[] = [];
  for (const [field, change] of Object.entries(a.diff)) {
    if (parts.length >= MAX_FIELDS) break;
    if (typeof change !== "object" || change === null || !("from" in change) || !("to" in change))
      continue;
    const c = change as { from: unknown; to: unknown };
    parts.push(`${fieldName(field, ctx)}: ${formatValue(c.from, ctx)} → ${formatValue(c.to, ctx)}`);
  }
  const more = Object.keys(a.diff).length - MAX_FIELDS;
  return {
    verb,
    detail:
      parts.length === 0
        ? null
        : parts.join(" · ") + (more > 0 ? ` · ${t("activity.more", { count: more })}` : ""),
  };
}
