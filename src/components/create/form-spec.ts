import type { ApiObject, NewRelation } from "@/domain/api-types";
import { relationForChild, type CreatableType } from "@/domain/creation";
import {
  COMMON_CURRENCIES,
  CURRENCY_UNITS,
  DATA_KINDS,
  DATA_SOURCES,
  DOCUMENT_KINDS,
  ESTIMATE_CATEGORIES,
  ESTIMATE_UNITS,
  LIFECYCLE_STATUSES,
  LOCATION_LEVELS,
  EVENT_KINDS,
  MEMORY_TYPES,
  OBJECT_TYPES,
  TRANSACTION_KINDS,
  type EstimateUnit,
  type MemorySourceKind,
  type ObjectType,
} from "@/domain/enums";
import { createObjectSchema, type CreateObjectInput } from "@/domain/schemas";
import { isValidIsoDate } from "@/domain/dates";
import type { MessageKey } from "@/i18n";

/**
 * What each creatable type asks for, as data. One table drives the create dialog, the edit
 * dialog and their validation, so a field is added in exactly one place. Values are held as
 * strings while typing and converted to the API's shapes by `buildObject`, which then runs the
 * same Zod schema the server does.
 */
export type FieldKind =
  | "text"
  | "textarea"
  | "date"
  | "datetime"
  | "number"
  | "select"
  | "tags"
  /** Free text with suggestions (any value is accepted: a currency code, a category…). */
  | "combo"
  /** One existing object of the `accepts` types, stored as its id in a detail field. */
  | "object";

export interface FieldSpec {
  name: string;
  label: MessageKey;
  kind: FieldKind;
  required?: boolean;
  options?: readonly { value: string; label: MessageKey }[];
  hint?: MessageKey;
  /** Two short fields can share a row. */
  half?: boolean;
  step?: string;
  /** For `combo`: values offered as written; any other value is accepted too. */
  suggestions?: readonly string[];
  /** For `object`: the types the picker lists. */
  accepts?: readonly ObjectType[];
}

export type RelationField = "parent" | "location" | "scenario" | "account" | "plan";

export interface RelationSpec {
  name: RelationField;
  label: MessageKey;
  hint?: MessageKey;
  /** Types the picker lists. */
  accepts: readonly ObjectType[];
}

const STATUS_OPTIONS = LIFECYCLE_STATUSES.map((s) => ({
  value: s,
  label: `status.${s}` as MessageKey,
}));

const NAME = (label: MessageKey): FieldSpec => ({
  name: "title",
  label,
  kind: "text",
  required: true,
});
const STATUS: FieldSpec = {
  name: "status",
  label: "form.status",
  kind: "select",
  options: STATUS_OPTIONS,
  half: true,
};
const TAGS: FieldSpec = { name: "tags", label: "form.tags", kind: "tags", hint: "form.tagsHint" };
const ABOUT: FieldSpec = { name: "description", label: "form.description", kind: "textarea" };

const ANY_PARENT: readonly ObjectType[] = OBJECT_TYPES.filter(
  (t) => t !== "scenario" && t !== "estimate",
);
const PROJECTISH: readonly ObjectType[] = ["project", "sub_project"];
/** Spending/holding categories offered first; any other word is accepted. */
export const SUBCATEGORY_SUGGESTIONS = [
  "Salary",
  "Housing",
  "Food",
  "Transport",
  "Subscriptions",
  "Business",
  "Investments",
  "Taxes",
  "Utilities",
  "Health",
  "Personal",
  "Travel",
  "Other",
] as const;

const SOURCE: FieldSpec = {
  name: "source",
  label: "form.source",
  kind: "select",
  half: true,
  options: [
    { value: "", label: "form.sourceUnset" },
    ...DATA_SOURCES.map((v) => ({ value: v, label: `source.${v}` as MessageKey })),
  ],
};
const CURRENCY: FieldSpec = {
  name: "currency",
  label: "form.currency",
  kind: "combo",
  half: true,
  suggestions: COMMON_CURRENCIES,
  hint: "form.currencyHint",
};
const SUBCATEGORY: FieldSpec = {
  name: "subcategory",
  label: "form.subcategory",
  kind: "combo",
  half: true,
  suggestions: SUBCATEGORY_SUGGESTIONS,
};

const LOCATION_REL: RelationSpec = {
  name: "location",
  label: "form.location",
  accepts: ["location"],
};

export const FIELDS: Record<CreatableType, readonly FieldSpec[]> = {
  plan: [NAME("form.name"), ABOUT, STATUS, TAGS],
  project: [
    NAME("form.name"),
    ABOUT,
    STATUS,
    { name: "startDate", label: "form.startDate", kind: "date", half: true },
    { name: "targetDate", label: "form.targetDate", kind: "date", half: true },
    TAGS,
  ],
  sub_project: [
    NAME("form.name"),
    ABOUT,
    STATUS,
    { name: "startDate", label: "form.startDate", kind: "date", half: true },
    { name: "targetDate", label: "form.targetDate", kind: "date", half: true },
    TAGS,
  ],
  task: [
    NAME("form.name"),
    ABOUT,
    STATUS,
    { name: "due", label: "form.dueDate", kind: "date", half: true },
    TAGS,
  ],
  milestone: [
    NAME("form.name"),
    { name: "date", label: "form.milestoneDate", kind: "date", half: true },
    STATUS,
    TAGS,
  ],
  decision: [
    NAME("form.name"),
    { name: "question", label: "form.question", kind: "textarea" },
    { name: "deadline", label: "form.decideBy", kind: "date", half: true },
    STATUS,
    TAGS,
  ],
  risk: [
    NAME("form.name"),
    {
      name: "probability",
      label: "form.probability",
      kind: "select",
      required: true,
      half: true,
      options: [1, 2, 3, 4, 5].map((n) => ({
        value: String(n),
        label: `form.scale.${n}` as MessageKey,
      })),
    },
    {
      name: "impact",
      label: "form.impact",
      kind: "select",
      required: true,
      half: true,
      options: [1, 2, 3, 4, 5].map((n) => ({
        value: String(n),
        label: `form.scale.${n}` as MessageKey,
      })),
    },
    { name: "mitigation", label: "form.mitigation", kind: "textarea" },
    STATUS,
    TAGS,
  ],
  note: [NAME("form.title"), { name: "body", label: "form.body", kind: "textarea" }, TAGS],
  property: [
    NAME("form.name"),
    { name: "sizeM2", label: "form.sizeM2", kind: "number", half: true, step: "any" },
    { name: "beds", label: "form.beds", kind: "number", half: true, step: "1" },
    STATUS,
    TAGS,
  ],
  location: [
    NAME("form.placeName"),
    {
      name: "level",
      label: "form.level",
      kind: "select",
      half: true,
      options: LOCATION_LEVELS.filter((l) => l !== "planet").map((l) => ({
        value: l,
        label: `level.${l}` as MessageKey,
      })),
    },
    {
      name: "countryCode",
      label: "form.countryCode",
      kind: "text",
      half: true,
      hint: "form.countryHint",
    },
    { name: "lat", label: "form.lat", kind: "number", half: true, step: "any" },
    {
      name: "lng",
      label: "form.lng",
      kind: "number",
      half: true,
      step: "any",
      hint: "form.coordsHint",
    },
    TAGS,
  ],
  person: [
    NAME("form.name"),
    { name: "role", label: "form.role", kind: "text", half: true },
    { name: "org", label: "form.org", kind: "text", half: true },
    TAGS,
  ],
  event: [
    NAME("form.name"),
    {
      name: "kind",
      label: "form.eventKind",
      kind: "select",
      half: true,
      options: EVENT_KINDS.map((k) => ({ value: k, label: `eventKind.${k}` as MessageKey })),
    },
    { name: "startsAt", label: "form.startsAt", kind: "datetime", required: true, half: true },
    STATUS,
    TAGS,
  ],
  estimate: [
    NAME("form.name"),
    {
      name: "amount",
      label: "form.amount",
      kind: "number",
      required: true,
      half: true,
      step: "any",
    },
    CURRENCY,
    {
      name: "unit",
      label: "form.unit",
      kind: "select",
      half: true,
      options: ESTIMATE_UNITS.map((u) => ({ value: u, label: `unitName.${u}` as MessageKey })),
    },
    {
      name: "dataKind",
      label: "form.dataKind",
      kind: "select",
      half: true,
      hint: "form.dataKindHint",
      options: DATA_KINDS.map((k) => ({ value: k, label: `dataKind.${k}` as MessageKey })),
    },
    {
      name: "category",
      label: "form.financeCategory",
      kind: "select",
      half: true,
      options: ESTIMATE_CATEGORIES.map((c) => ({
        value: c,
        label: `category.${c}` as MessageKey,
      })),
    },
    SUBCATEGORY,
    { name: "asOf", label: "form.asOf", kind: "date", half: true },
    SOURCE,
    {
      name: "costBasis",
      label: "form.costBasis",
      kind: "number",
      half: true,
      step: "any",
      hint: "form.costBasisHint",
    },
    { name: "ticker", label: "form.ticker", kind: "text", half: true },
    { name: "quantity", label: "form.quantity", kind: "number", half: true, step: "any" },
    { name: "confidence", label: "form.confidence", kind: "number", half: true, step: "1" },
    {
      name: "scenarioId",
      label: "form.scenario",
      kind: "object",
      accepts: ["scenario"],
      hint: "form.scenarioValueHint",
    },
    { name: "note", label: "form.note", kind: "textarea" },
    TAGS,
  ],
  transaction: [
    NAME("form.name"),
    {
      name: "amount",
      label: "form.amount",
      kind: "number",
      required: true,
      half: true,
      step: "any",
    },
    { ...CURRENCY, required: true },
    {
      name: "kind",
      label: "form.transactionKind",
      kind: "select",
      half: true,
      options: TRANSACTION_KINDS.map((k) => ({
        value: k,
        label: `transactionKind.${k}` as MessageKey,
      })),
    },
    { name: "date", label: "form.transactionDate", kind: "date", required: true, half: true },
    SUBCATEGORY,
    SOURCE,
    { name: "description", label: "form.description", kind: "textarea" },
    TAGS,
  ],
  document: [
    NAME("form.title"),
    {
      name: "kind",
      label: "form.documentKind",
      kind: "select",
      half: true,
      options: DOCUMENT_KINDS.map((k) => ({ value: k, label: `documentKind.${k}` as MessageKey })),
    },
    SOURCE,
    { name: "issuer", label: "form.issuer", kind: "text", half: true },
    { name: "validUntil", label: "form.validUntil", kind: "date", half: true },
    { name: "description", label: "form.description", kind: "textarea" },
    TAGS,
  ],
  memory: [
    NAME("form.statement"),
    {
      name: "memoryType",
      label: "form.memoryType",
      kind: "select",
      half: true,
      options: MEMORY_TYPES.map((m) => ({ value: m, label: `memoryType.${m}` as MessageKey })),
    },
    { name: "confidence", label: "form.confidence", kind: "number", half: true, step: "1" },
    { name: "detail", label: "field.detail", kind: "textarea" },
    STATUS,
    TAGS,
  ],
};

export const RELATIONS: Record<CreatableType, readonly RelationSpec[]> = {
  plan: [],
  project: [
    {
      name: "parent",
      label: "form.parentProject",
      hint: "form.parentProjectHint",
      accepts: PROJECTISH,
    },
    LOCATION_REL,
    { name: "scenario", label: "form.scenario", hint: "form.scenarioHint", accepts: ["scenario"] },
    { name: "plan", label: "form.plan", hint: "form.planHint", accepts: ["plan"] },
  ],
  sub_project: [{ name: "parent", label: "form.parentProject", accepts: PROJECTISH }, LOCATION_REL],
  task: [{ name: "parent", label: "form.belongsTo", accepts: PROJECTISH }],
  milestone: [{ name: "parent", label: "form.belongsTo", accepts: PROJECTISH }],
  decision: [{ name: "parent", label: "form.belongsTo", accepts: PROJECTISH }],
  risk: [{ name: "parent", label: "form.belongsTo", accepts: PROJECTISH }],
  note: [{ name: "parent", label: "form.about", accepts: ANY_PARENT }],
  property: [{ name: "parent", label: "form.belongsTo", accepts: PROJECTISH }, LOCATION_REL],
  location: [
    {
      name: "parent",
      label: "form.insidePlace",
      hint: "form.insidePlaceHint",
      accepts: ["location"],
    },
  ],
  person: [{ name: "parent", label: "form.about", accepts: ANY_PARENT }],
  event: [{ name: "parent", label: "form.belongsTo", accepts: PROJECTISH }, LOCATION_REL],
  memory: [
    {
      name: "parent",
      label: "form.primaryContext",
      hint: "form.primaryContextHint",
      // A memory's context can be a project, sub-project or plan (context-color.ts's
      // COLOR_CONTEXT_TYPES) — deliberately not the shared PROJECTISH constant, which other
      // types reuse for actual nesting/parenting, where a plan is never a valid parent.
      accepts: [...PROJECTISH, "plan"],
    },
  ],
  estimate: [
    {
      name: "parent",
      label: "form.valueOf",
      hint: "form.valueOfHint",
      accepts: ["project", "sub_project", "property", "location", "person", "event"],
    },
  ],
  transaction: [
    { name: "account", label: "form.account", hint: "form.accountHint", accepts: ["estimate"] },
    {
      name: "parent",
      label: "form.relatedTo",
      accepts: ["project", "sub_project", "property", "event", "person"],
    },
  ],
  document: [{ name: "parent", label: "form.belongsTo", accepts: PROJECTISH }],
};

// ── Values ───────────────────────────────────────────────────────────────────────────────────

export interface FormValues {
  fields: Record<string, string>;
  relations: Partial<Record<RelationField, string>>;
}

export interface CreateContext {
  parent?: Pick<ApiObject, "id" | "type"> | null;
  coords?: { lat: number; lng: number } | null;
  preset?: Readonly<Record<string, string>>;
}

const DEFAULTS: Record<string, string> = { status: "active", level: "city", kind: "appointment" };
/** Per-type defaults that differ from the shared ones. */
const TYPE_DEFAULTS: Partial<Record<CreatableType, Record<string, string>>> = {
  estimate: { unit: "currency", category: "other", dataKind: "actual", source: "manual" },
  transaction: { kind: "expense", source: "manual" },
  document: { kind: "other", source: "manual" },
};

export function initialValues(type: CreatableType, ctx: CreateContext = {}): FormValues {
  const fields: Record<string, string> = {};
  const typed = TYPE_DEFAULTS[type] ?? {};
  for (const f of FIELDS[type]) fields[f.name] = typed[f.name] ?? DEFAULTS[f.name] ?? "";
  for (const [k, v] of Object.entries(ctx.preset ?? {})) fields[k] = v;
  if (type === "location" && ctx.coords) {
    fields.lat = String(round(ctx.coords.lat));
    fields.lng = String(round(ctx.coords.lng));
  }
  const relations: FormValues["relations"] = {};
  if (ctx.parent) {
    // Placed inside the context object, through whichever of this type's own relations accepts
    // it first — "parent" for most types, but e.g. a transaction created from an account's own
    // page has no "parent" field for it: its "account" field is what accepts one instead.
    const spec = RELATIONS[type].find((r) => r.accepts.includes(ctx.parent!.type));
    if (spec) relations[spec.name] = ctx.parent.id;
  }
  return { fields, relations };
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────

/** Accepts "2.5" and "2,5"; empty is `null`; anything else is `NaN`. */
export function parseNumber(raw: string): number | null {
  const v = raw.trim().replace(",", ".");
  if (v === "") return null;
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : Number.NaN;
}

const orNull = (raw: string | undefined): string | null => {
  const v = (raw ?? "").trim();
  return v === "" ? null : v;
};

export function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,;\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, 50);
}

export type FormErrors = Partial<Record<string, MessageKey>>;

export interface BuildResult {
  ok: boolean;
  input?: CreateObjectInput;
  relations?: NewRelation[];
  errors: FormErrors;
}

function detailsFor(type: CreatableType, f: Record<string, string>, errors: FormErrors) {
  const date = (name: string): string | null => {
    const v = orNull(f[name]);
    if (v !== null && !isValidIsoDate(v)) errors[name] = "form.error.date";
    return v;
  };
  const num = (name: string, opts: { min?: number; max?: number; int?: boolean } = {}) => {
    const n = parseNumber(f[name] ?? "");
    if (
      n !== null &&
      (Number.isNaN(n) ||
        (opts.min !== undefined && n < opts.min) ||
        (opts.max !== undefined && n > opts.max) ||
        (opts.int && !Number.isInteger(n)))
    ) {
      errors[name] = "form.error.number";
      return null;
    }
    return n;
  };

  switch (type) {
    case "plan":
      return { description: (f.description ?? "").trim() };
    case "project":
    case "sub_project": {
      const startDate = date("startDate");
      const targetDate = date("targetDate");
      if (startDate && targetDate && targetDate < startDate)
        errors.targetDate = "form.error.dateOrder";
      return { description: (f.description ?? "").trim(), startDate, targetDate };
    }
    case "task":
      return { description: (f.description ?? "").trim(), due: date("due") };
    case "milestone":
      return { date: date("date") };
    case "decision":
      return { question: (f.question ?? "").trim(), deadline: date("deadline") };
    case "risk": {
      const probability = num("probability", { min: 1, max: 5, int: true });
      const impact = num("impact", { min: 1, max: 5, int: true });
      if (probability === null) errors.probability = "form.error.required";
      if (impact === null) errors.impact = "form.error.required";
      return {
        probability: probability ?? 1,
        impact: impact ?? 1,
        mitigation: (f.mitigation ?? "").trim(),
      };
    }
    case "note": {
      const text = (f.body ?? "").trim();
      return {
        blocks: text ? [{ id: "b1", type: "paragraph" as const, text }] : [],
        pinned: false,
      };
    }
    case "property":
      return { sizeM2: num("sizeM2", { min: 0.01 }), beds: num("beds", { min: 0, int: true }) };
    case "location": {
      const lat = num("lat", { min: -90, max: 90 });
      const lng = num("lng", { min: -180, max: 180 });
      if ((lat === null) !== (lng === null))
        errors[lat === null ? "lat" : "lng"] = "form.error.coordsTogether";
      const country = orNull(f.countryCode)?.toUpperCase() ?? null;
      if (country !== null && !/^[A-Z]{2}$/.test(country))
        errors.countryCode = "form.error.country";
      return {
        level: f.level || "city",
        countryCode: country,
        lat,
        lng,
        coordinatesSource: lat !== null ? "manual" : null,
      };
    }
    case "person":
      return { role: orNull(f.role), org: orNull(f.org) };
    case "event": {
      const raw = orNull(f.startsAt);
      const d = raw ? new Date(raw) : null;
      if (!d || Number.isNaN(d.getTime())) errors.startsAt = "form.error.required";
      return {
        startsAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : "",
        kind: f.kind || "appointment",
      };
    }
    case "estimate": {
      const unit = (f.unit || "currency") as EstimateUnit;
      const monetary = CURRENCY_UNITS.includes(unit);
      const amount = num("amount");
      if (amount === null && !errors.amount) errors.amount = "form.error.required";
      const currency = orNull(f.currency)?.toUpperCase() ?? null;
      if (monetary && currency === null) errors.currency = "form.error.required";
      else if (monetary && currency !== null && !/^[A-Z]{3}$/.test(currency))
        errors.currency = "form.error.currency";
      const costBasis = num("costBasis");
      if (costBasis !== null && !monetary) errors.costBasis = "form.error.costBasisMoney";
      return {
        amount: amount ?? 0,
        currency: monetary ? currency : null,
        unit,
        category: f.category || "other",
        dataKind: f.dataKind || "estimate",
        subcategory: orNull(f.subcategory),
        asOf: date("asOf"),
        source: (f.source ?? "").trim(),
        costBasis: monetary ? costBasis : null,
        ticker: orNull(f.ticker)?.toUpperCase() ?? null,
        quantity: num("quantity", { min: 0 }),
        scenarioId: orNull(f.scenarioId),
        note: (f.note ?? "").trim(),
      };
    }
    case "transaction": {
      const amount = num("amount");
      if (amount !== null && amount <= 0) errors.amount = "form.error.positive";
      const currency = orNull(f.currency)?.toUpperCase() ?? null;
      if (currency !== null && !/^[A-Z]{3}$/.test(currency))
        errors.currency = "form.error.currency";
      const when = date("date");
      return {
        date: when ?? "",
        amount: amount ?? 0,
        currency: currency ?? "",
        kind: f.kind || "expense",
        subcategory: orNull(f.subcategory),
        description: (f.description ?? "").trim(),
        source: (f.source ?? "").trim(),
      };
    }
    case "document":
      // The file's own facts (mime, size, storage path, checksum, extracted text) are never
      // form fields: an edit keeps them, and a hand-recorded document has no file.
      return {
        mime: orNull(f.mime) ?? "application/octet-stream",
        kind: f.kind || "other",
        description: (f.description ?? "").trim(),
        source: (f.source ?? "").trim(),
        issuer: orNull(f.issuer),
        validUntil: date("validUntil"),
      };
    case "memory":
      // sourceKind is never a form field: creating through this dialog is always user-sourced,
      // and editing preserves whatever value valuesFromObject copied from the existing memory
      // (an ai-proposed memory the user later edits stays ai-proposed — provenance is not
      // decorative, ADR 0002 §9).
      return {
        memoryType: f.memoryType || "fact",
        detail: (f.detail ?? "").trim(),
        sourceKind: (f.sourceKind || "user") as MemorySourceKind,
        pinned: f.pinned === "true",
      };
  }
}

/**
 * Turns form values into the API request: the object, plus the relations that follow from where
 * it was created. `parents` resolves picked ids to objects so the right edge can be chosen.
 */
export function buildObject(
  type: CreatableType,
  values: FormValues,
  lookup: (id: string) => Pick<ApiObject, "id" | "type"> | undefined,
): BuildResult {
  const errors: FormErrors = {};
  const f = values.fields;
  const title = (f.title ?? "").trim();
  if (title === "") errors.title = "form.error.required";
  else if (title.length > 200) errors.title = "form.error.tooLong";
  for (const spec of FIELDS[type]) {
    if (
      spec.required &&
      spec.name !== "title" &&
      (f[spec.name] ?? "").trim() === "" &&
      !errors[spec.name]
    )
      errors[spec.name] = "form.error.required";
  }

  const details = detailsFor(type, f, errors);
  const relations: NewRelation[] = [];
  let finalType: CreatableType = type;

  const parent = values.relations.parent ? lookup(values.relations.parent) : undefined;
  if (parent && type === "estimate") {
    // A financial value is the value of something: the `estimates` relation, not a reference.
    relations.push({ kind: "estimates", direction: "out", other: parent.id });
  } else if (parent) {
    // A project inside a project is a sub-project: that is what the relation rules allow.
    if (type === "project" && (parent.type === "project" || parent.type === "sub_project"))
      finalType = "sub_project";
    const rel = relationForChild(parent.type, finalType);
    if (rel) {
      // The relation picked at creation is the memory's primary context (ADR 0002 §3): labelled
      // explicitly so it wins even if a secondary `about` edge is later added elsewhere.
      relations.push({
        ...rel,
        other: parent.id,
        ...(rel.kind === "about" ? { label: "primary" } : {}),
      });
    } else errors.parent = "form.error.relation";
  }
  const place = values.relations.location ? lookup(values.relations.location) : undefined;
  if (place) relations.push({ kind: "located_at", direction: "out", other: place.id });
  const account = values.relations.account ? lookup(values.relations.account) : undefined;
  if (account)
    relations.push({ kind: "references", direction: "out", other: account.id, label: "account" });
  const scenario = values.relations.scenario ? lookup(values.relations.scenario) : undefined;
  if (scenario)
    relations.push({ kind: "references", direction: "out", other: scenario.id, label: "scenario" });
  const plan = values.relations.plan ? lookup(values.relations.plan) : undefined;
  if (plan) relations.push({ kind: "contains", direction: "in", other: plan.id });

  // Confidence is a spine field, not a detail — but only types that ask for it (today, only
  // memory) accept it from this form; every other type stays permanently unset, unchanged.
  let confidence: number | null = null;
  if (FIELDS[type].some((spec) => spec.name === "confidence")) {
    const raw = parseNumber(f.confidence ?? "");
    if (raw !== null && (Number.isNaN(raw) || raw < 0 || raw > 100 || !Number.isInteger(raw))) {
      errors.confidence = "form.error.number";
    } else {
      confidence = raw;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const candidate = {
    type: finalType,
    title,
    status: (f.status as (typeof LIFECYCLE_STATUSES)[number]) || "active",
    tags: parseTags(f.tags ?? ""),
    confidence,
    details,
  };
  const parsed = createObjectSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, errors: { form: "error.invalid" } };
  return { ok: true, input: candidate as CreateObjectInput, relations, errors };
}

// ── Editing ──────────────────────────────────────────────────────────────────────────────────

/** Form values for an existing object, so the same form can edit it. */
export function valuesFromObject(node: ApiObject): FormValues {
  const d = node.details ?? {};
  const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
  const fields: Record<string, string> = {
    title: node.title,
    status: node.status,
    tags: node.tags.filter((t) => !t.startsWith("atlas:")).join(", "),
  };
  if (node.confidence !== null) fields.confidence = String(node.confidence);
  for (const [k, v] of Object.entries(d)) if (typeof v !== "object") fields[k] = s(v);
  if (node.type === "note" && Array.isArray(d.blocks))
    fields.body = (d.blocks as { text: string }[]).map((b) => b.text).join("\n\n");
  if (node.type === "event" && typeof d.startsAt === "string")
    fields.startsAt = toLocalInput(d.startsAt);
  return { fields, relations: {} };
}

/** "2026-10-05T09:00:00Z" → "2026-10-05T09:00" for a datetime-local input (local time). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
