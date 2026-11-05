import { z } from "zod";
import { isValidIsoDate } from "./dates";
import {
  COLOR_TOKEN_PATTERN,
  COLORABLE_TYPES,
  CURRENCY_UNITS,
  DATA_KINDS,
  DEPENDENCY_TYPES,
  EDGE_KINDS,
  ESTIMATE_CATEGORIES,
  ESTIMATE_UNITS,
  DOCUMENT_KINDS,
  EVENT_KINDS,
  LIFECYCLE_STATUSES,
  LOCATION_LEVELS,
  MEMORY_SOURCE_KINDS,
  MEMORY_TYPES,
  SCENARIO_VARIANTS,
  TRANSACTION_KINDS,
} from "./enums";

/*
 * Zod schemas for creating objects and edges. They mirror the CHECK constraints in
 * db/migrations so bad data is rejected with a helpful message before it reaches the
 * database (which remains the backstop). Field names are camelCase here, snake_case in SQL.
 * Derived values (progress, risk level, slip, yield, ...) deliberately do not appear.
 */

const isoDate = z.string().refine(isValidIsoDate, "Expected a valid date (YYYY-MM-DD)");
const currency = z.string().regex(/^[A-Z]{3}$/, "Expected a 3-letter ISO 4217 code, e.g. EUR");
const countryCode = z.string().regex(/^[A-Z]{2}$/, "Expected a 2-letter ISO 3166 code, e.g. BE");
const text = (max = 2_000) => z.string().trim().max(max);
/** A design-token key, e.g. "purple" — never a raw hex (ADR 0002 §5). */
const colorToken = z
  .string()
  .regex(COLOR_TOKEN_PATTERN, 'Expected a colour token, e.g. "purple", not a hex value');

/** Fields shared by every object (the spine). */
const spine = {
  title: z.string().trim().min(1, "Title is required").max(200),
  status: z.enum(LIFECYCLE_STATUSES).default("active"),
  tags: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  /** 0–100, or null when never assessed. */
  confidence: z.number().int().min(0).max(100).nullable().default(null),
  /** A context colour token; only project/sub_project may set one at launch (checked below). */
  color: colorToken.nullable().default(null),
};

// ── Type-specific details ────────────────────────────────────────────────────────────────────

const projectDetailsBase = z.object({
  description: text(10_000).default(""),
  kind: text(60).min(1).default("general"),
  /** 1 = highest priority, 4 = lowest. */
  priority: z.number().int().min(1).max(4).default(2),
  startDate: isoDate.nullable().default(null),
  targetDate: isoDate.nullable().default(null),
  /** A target, not an estimate: money with provenance is an Estimate object. */
  budgetAmount: z.number().nonnegative().nullable().default(null),
  budgetCurrency: currency.nullable().default(null),
});

function refineProject(
  d: z.infer<typeof projectDetailsBase>,
  ctx: z.RefinementCtx,
  allowBudget: boolean,
): void {
  if (d.startDate && d.targetDate && d.targetDate < d.startDate) {
    ctx.addIssue({ code: "custom", path: ["targetDate"], message: "Target date is before start" });
  }
  if ((d.budgetAmount === null) !== (d.budgetCurrency === null)) {
    ctx.addIssue({
      code: "custom",
      path: ["budgetCurrency"],
      message: "Budget amount and currency must be set together",
    });
  }
  if (!allowBudget && d.budgetAmount !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["budgetAmount"],
      message: "Sub-projects have no independent budget",
    });
  }
}

export const projectDetailsSchema = projectDetailsBase.superRefine((d, ctx) =>
  refineProject(d, ctx, true),
);
export const subProjectDetailsSchema = projectDetailsBase.superRefine((d, ctx) =>
  refineProject(d, ctx, false),
);

export const taskDetailsSchema = z.object({
  description: text(10_000).default(""),
  due: isoDate.nullable().default(null),
  /** Roll-up weight. Null means the default weight. */
  effort: z.number().positive().nullable().default(null),
});

export const milestoneDetailsSchema = z.object({
  date: isoDate.nullable().default(null),
  /** Slip is measured against this; slip itself is derived. */
  baselineDate: isoDate.nullable().default(null),
  gateCriteria: z
    .array(z.object({ text: text(300).min(1), met: z.boolean().default(false) }))
    .max(50)
    .default([]),
});

export const estimateDetailsSchema = z
  .object({
    amount: z.number(),
    currency: currency.nullable().default(null),
    unit: z.enum(ESTIMATE_UNITS).default("currency"),
    category: z.enum(ESTIMATE_CATEGORIES).default("other"),
    /** actual | target | estimate | scenario | assumption — never conflated with lifecycle status. */
    dataKind: z.enum(DATA_KINDS).default("estimate"),
    source: text(300).default(""),
    asOf: isoDate.nullable().default(null),
    /** Which scenario this value belongs to. A qualifier, not a relationship (ADR 0001 F5). */
    scenarioId: z.uuid().nullable().default(null),
    note: text(2_000).default(""),
    /** Invested capital of a holding (return = amount − costBasis, derived, never stored). */
    costBasis: z.number().nullable().default(null),
    quantity: z.number().nonnegative().nullable().default(null),
    ticker: text(20).min(1).nullable().default(null),
    /** A free, user-chosen category ("Housing", "ETF"…): not an enum, so it never needs a migration. */
    subcategory: text(60).min(1).nullable().default(null),
  })
  .superRefine((d, ctx) => {
    if (d.costBasis !== null && d.currency === null) {
      ctx.addIssue({
        code: "custom",
        path: ["costBasis"],
        message: "An invested capital needs a monetary value",
      });
    }
    const needsCurrency = CURRENCY_UNITS.includes(d.unit);
    if (needsCurrency && d.currency === null) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: "A currency is required for monetary values",
      });
    }
    if (!needsCurrency && d.currency !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["currency"],
        message: "Non-monetary values must not have a currency",
      });
    }
  });

export const scenarioDetailsSchema = z.object({
  variant: z.enum(SCENARIO_VARIANTS),
  description: text(2_000).default(""),
});

/** A programme grouping several standalone projects. Deliberately minimal: a plan's own progress
 *  is a presentation-only rollup of its member projects, never a stored value. */
export const planDetailsSchema = z.object({
  description: text(10_000).default(""),
});

export const locationDetailsSchema = z
  .object({
    level: z.enum(LOCATION_LEVELS).default("site"),
    countryCode: countryCode.nullable().default(null),
    region: text(120).nullable().default(null),
    city: text(120).nullable().default(null),
    district: text(120).nullable().default(null),
    addressLine: text(300).nullable().default(null),
    postalCode: text(20).nullable().default(null),
    lat: z.number().min(-90).max(90).nullable().default(null),
    lng: z.number().min(-180).max(180).nullable().default(null),
    /** Provenance of the coordinates: "manual" or "geocoder:<name>". Never invented. */
    coordinatesSource: text(80).nullable().default(null),
    category: text(80).nullable().default(null),
    studiedOn: isoDate.nullable().default(null),
    verdict: text(2_000).nullable().default(null),
  })
  .superRefine((d, ctx) => {
    if ((d.lat === null) !== (d.lng === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["lng"],
        message: "Latitude and longitude must be set together",
      });
    }
  });

export const propertyDetailsSchema = z.object({
  sizeM2: z.number().positive().nullable().default(null),
  beds: z.number().int().nonnegative().nullable().default(null),
  stage: text(60).min(1).default("identified"),
  listingRef: text(120).nullable().default(null),
  listingUrl: z.url().nullable().default(null),
});

const decisionOption = z.object({ id: text(60).min(1), label: text(200).min(1) });
const decisionCriterion = z.object({
  id: text(60).min(1),
  label: text(200).min(1),
  weight: z.number().nonnegative(),
});

export const decisionDetailsSchema = z.object({
  question: text(1_000).default(""),
  options: z.array(decisionOption).max(20).default([]),
  criteria: z.array(decisionCriterion).max(20).default([]),
  /** scores[optionId][criterionId] */
  scores: z.record(z.string(), z.record(z.string(), z.number())).default({}),
  deadline: isoDate.nullable().default(null),
  resolvedOptionId: text(60).nullable().default(null),
  rationale: text(5_000).default(""),
  resolvedAt: z.iso.datetime({ offset: true }).nullable().default(null),
});

export const riskDetailsSchema = z.object({
  probability: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  mitigation: text(5_000).default(""),
});

const noteBlock = z.object({
  id: text(60).min(1),
  type: z.enum(["paragraph", "heading", "list", "todo", "quote", "code"]).default("paragraph"),
  text: z.string().max(20_000).default(""),
  /** Only for a "todo" block: the box is ticked. */
  checked: z.boolean().optional(),
});

export const noteDetailsSchema = z.object({
  blocks: z.array(noteBlock).max(2_000).default([]),
  pinned: z.boolean().default(false),
});

export const documentDetailsSchema = z.object({
  mime: text(120).min(1),
  sizeBytes: z.number().int().nonnegative().default(0),
  issuer: text(200).nullable().default(null),
  validUntil: isoDate.nullable().default(null),
  /** Where the file lives in the file store; null for a document recorded without its file. */
  storagePath: text(500).nullable().default(null),
  checksum: text(128).nullable().default(null),
  kind: z.enum(DOCUMENT_KINDS).default("other"),
  description: text(2_000).default(""),
  /** Provenance ("upload", "import", "scan", …). */
  source: text(120).default(""),
  originalName: text(300).nullable().default(null),
  uploadedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  /**
   * Text extracted from the file, for content search. `null` means "not extracted" (nothing
   * pretends to have read a PDF before an extraction step exists).
   */
  contentText: z.string().max(200_000).nullable().default(null),
});

/** A dated money movement. Always actual: a projection is an Estimate with a data kind. */
export const transactionDetailsSchema = z.object({
  date: isoDate,
  /** Always positive: the direction is the kind. */
  amount: z.number().positive(),
  currency,
  kind: z.enum(TRANSACTION_KINDS).default("expense"),
  subcategory: text(60).min(1).nullable().default(null),
  description: text(2_000).default(""),
  source: text(300).default(""),
});

export const personDetailsSchema = z.object({
  role: text(120).nullable().default(null),
  org: text(200).nullable().default(null),
  countryCode: countryCode.nullable().default(null),
  lastContact: isoDate.nullable().default(null),
  contact: z.record(z.string(), text(300)).default({}),
});

export const eventDetailsSchema = z.object({
  startsAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().nonnegative().nullable().default(null),
  allDay: z.boolean().default(false),
  kind: z.enum(EVENT_KINDS).default("appointment"),
});

/**
 * A durable knowledge statement. The statement itself is the shared `title` field (<= 200 chars,
 * enforced by the spine): that cap is what keeps a memory atomic (ADR 0002 §2). `detail` is an
 * optional short elaboration, not a place to put a long document — that is a Note.
 */
export const memoryDetailsSchema = z.object({
  memoryType: z.enum(MEMORY_TYPES).default("fact"),
  detail: text(1_000).default(""),
  sourceKind: z.enum(MEMORY_SOURCE_KINDS).default("user"),
  pinned: z.boolean().default(false),
});

// ── Objects ──────────────────────────────────────────────────────────────────────────────────

const decisionClosedRule = (
  o: { status: string; details: z.infer<typeof decisionDetailsSchema> },
  ctx: z.RefinementCtx,
): void => {
  const { resolvedOptionId, rationale, options } = o.details;
  if (resolvedOptionId !== null && !options.some((opt) => opt.id === resolvedOptionId)) {
    ctx.addIssue({
      code: "custom",
      path: ["details", "resolvedOptionId"],
      message: "Resolved option is not one of the options",
    });
  }
  if (o.status === "done") {
    if (resolvedOptionId === null) {
      ctx.addIssue({
        code: "custom",
        path: ["details", "resolvedOptionId"],
        message: "Pick an option to close a decision",
      });
    }
    if (rationale.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["details", "rationale"],
        message: "A rationale is required to close a decision",
      });
    }
  }
};

/** Input for creating any object. Discriminated by `type`. */
export const createObjectSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("plan"), ...spine, details: planDetailsSchema }),
    z.object({ type: z.literal("project"), ...spine, details: projectDetailsSchema }),
    z.object({ type: z.literal("sub_project"), ...spine, details: subProjectDetailsSchema }),
    z.object({ type: z.literal("task"), ...spine, details: taskDetailsSchema }),
    z.object({ type: z.literal("milestone"), ...spine, details: milestoneDetailsSchema }),
    z.object({ type: z.literal("estimate"), ...spine, details: estimateDetailsSchema }),
    z.object({ type: z.literal("scenario"), ...spine, details: scenarioDetailsSchema }),
    z.object({ type: z.literal("location"), ...spine, details: locationDetailsSchema }),
    z.object({ type: z.literal("property"), ...spine, details: propertyDetailsSchema }),
    z
      .object({ type: z.literal("decision"), ...spine, details: decisionDetailsSchema })
      .superRefine(decisionClosedRule),
    z.object({ type: z.literal("risk"), ...spine, details: riskDetailsSchema }),
    z.object({ type: z.literal("note"), ...spine, details: noteDetailsSchema }),
    z.object({ type: z.literal("document"), ...spine, details: documentDetailsSchema }),
    z.object({ type: z.literal("person"), ...spine, details: personDetailsSchema }),
    z.object({ type: z.literal("event"), ...spine, details: eventDetailsSchema }),
    z.object({ type: z.literal("memory"), ...spine, details: memoryDetailsSchema }),
    z.object({ type: z.literal("transaction"), ...spine, details: transactionDetailsSchema }),
  ])
  .superRefine((o, ctx) => {
    if (o.color !== null && !(COLORABLE_TYPES as readonly string[]).includes(o.type)) {
      ctx.addIssue({
        code: "custom",
        path: ["color"],
        message: `Only ${COLORABLE_TYPES.join("/")} may have a context colour`,
      });
    }
  });

export type CreateObjectInput = z.input<typeof createObjectSchema>;
export type ParsedObjectInput = z.output<typeof createObjectSchema>;

// ── Tags ─────────────────────────────────────────────────────────────────────────────────────

export const createTagSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(40),
  color: colorToken.nullable().default(null),
});
export type CreateTagInput = z.input<typeof createTagSchema>;
export type ParsedTagInput = z.output<typeof createTagSchema>;

export const updateTagSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: colorToken.nullable().optional(),
});
export type UpdateTagInput = z.output<typeof updateTagSchema>;

// ── Edges ────────────────────────────────────────────────────────────────────────────────────

export const createEdgeSchema = z
  .object({
    kind: z.enum(EDGE_KINDS),
    from: z.uuid(),
    to: z.uuid(),
    /** Free label, e.g. "assignee" or "owner" on `references` edges. */
    label: text(60).nullable().default(null),
    /** `depends_on` only. */
    dependencyType: z.enum(DEPENDENCY_TYPES).nullable().default(null),
    /** `depends_on` only. Days after the predecessor; negative = lead. */
    lagDays: z.number().int().min(-3650).max(3650).nullable().default(null),
  })
  .superRefine((e, ctx) => {
    if (e.from === e.to) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "An object cannot relate to itself" });
    }
    if (e.kind !== "depends_on" && (e.dependencyType !== null || e.lagDays !== null)) {
      ctx.addIssue({
        code: "custom",
        path: ["dependencyType"],
        message: "Dependency type and lag apply only to depends_on edges",
      });
    }
  })
  .transform((e) =>
    e.kind === "depends_on"
      ? { ...e, dependencyType: e.dependencyType ?? ("fs" as const), lagDays: e.lagDays ?? 0 }
      : e,
  );

export type CreateEdgeInput = z.input<typeof createEdgeSchema>;
export type ParsedEdgeInput = z.output<typeof createEdgeSchema>;
