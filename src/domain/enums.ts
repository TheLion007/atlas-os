/** Closed vocabularies shared by the database enums, Zod schemas and UI. See docs/DATABASE.md. */

export const OBJECT_TYPES = [
  "project",
  "sub_project",
  "task",
  "milestone",
  "estimate",
  "scenario",
  "location",
  "property",
  "decision",
  "risk",
  "note",
  "document",
  "person",
  "event",
  "memory",
  "transaction",
  "plan",
] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

/** Lifecycle only. "Blocked" is derived from DEPENDS_ON edges and never stored. */
export const LIFECYCLE_STATUSES = ["draft", "active", "done", "dropped"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const EDGE_KINDS = [
  "contains",
  "depends_on",
  "estimates",
  "funded_by",
  "located_at",
  "references",
  "about",
  "supported_by",
  "derived_from",
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

/** Provenance of a financial value; orthogonal to lifecycle status. */
export const DATA_KINDS = ["actual", "target", "estimate", "scenario", "assumption"] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export const SCENARIO_VARIANTS = ["conservative", "base", "optimistic"] as const;
export type ScenarioVariant = (typeof SCENARIO_VARIANTS)[number];

export const DEPENDENCY_TYPES = ["fs", "ss", "ff", "sf"] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export const ESTIMATE_CATEGORIES = [
  "capital",
  "income",
  "expense",
  "investment",
  "acquisition_cost",
  "property_cost",
  "rental",
  "projection",
  "other",
  "cash",
  "asset",
  "liability",
] as const;
export type EstimateCategory = (typeof ESTIMATE_CATEGORIES)[number];

export const ESTIMATE_UNITS = [
  "currency",
  "currency_per_month",
  "currency_per_year",
  "percent",
  "area_m2",
  "count",
] as const;
export type EstimateUnit = (typeof ESTIMATE_UNITS)[number];

/** Units whose amount is money and therefore needs a currency. */
export const CURRENCY_UNITS: readonly EstimateUnit[] = [
  "currency",
  "currency_per_month",
  "currency_per_year",
];

export const LOCATION_LEVELS = [
  "planet",
  "country",
  "region",
  "city",
  "district",
  "neighbourhood",
  "address",
  "site",
] as const;
export type LocationLevel = (typeof LOCATION_LEVELS)[number];

export const EVENT_KINDS = ["trip", "appointment", "deadline"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * Durable-knowledge kinds (ADR 0002 §2). Deliberately not the brief's full nine: "decision" is
 * covered by the existing Decision object (linked via a `derived_from` edge), "context" is too
 * broad to be a real category, and "lesson" is a case of "insight".
 */
export const MEMORY_TYPES = [
  "fact",
  "preference",
  "goal",
  "plan",
  "constraint",
  "insight",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

/** Who/what created a memory. Not itself the provenance trail — see `derived_from` edges. */
export const MEMORY_SOURCE_KINDS = ["user", "ai_proposal", "import"] as const;
export type MemorySourceKind = (typeof MEMORY_SOURCE_KINDS)[number];

/** A design-token key (never a raw hex) for an object's context colour. Format only; the actual
 * palette lives in src/design/tokens.ts and can grow without a migration (ADR 0002 §5). */
export const COLOR_TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/** Object types allowed to carry a context colour at launch (ADR 0002 §5, approved decision). */
export const COLORABLE_TYPES: readonly ObjectType[] = ["plan", "project", "sub_project"];

/** What a dated money movement was (Finance). A transaction is always an actual: projections are
 * Estimates with a data kind. */
export const TRANSACTION_KINDS = [
  "income",
  "expense",
  "transfer",
  "investment",
  "withdrawal",
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/** What a document is for. Its format (PDF, image, spreadsheet…) is derived from the mime type. */
export const DOCUMENT_KINDS = [
  "other",
  "receipt",
  "invoice",
  "contract",
  "statement",
  "tax",
  "identity",
  "administrative",
  "report",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * Currencies offered first in forms. Any ISO 4217 code is accepted everywhere: this list is a
 * convenience, never a limit, and no value is ever assumed to be in one of them.
 */
export const COMMON_CURRENCIES = ["EUR", "USD", "AED", "CHF", "GBP"] as const;

/**
 * Provenance vocabulary for financial values and documents ("why does Atlas know this?"). Stored
 * as the key in the existing free-text `source` columns, so older free-text sources still read
 * as themselves.
 */
export const DATA_SOURCES = [
  "manual",
  "document",
  "bank_statement",
  "user_estimate",
  "external",
  "import",
] as const;
export type DataSource = (typeof DATA_SOURCES)[number];
