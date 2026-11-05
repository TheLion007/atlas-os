import type { ObjectType } from "@/domain/enums";

/** Which detail table holds each object type's type-specific fields. */
export const DETAIL_TABLE: Readonly<Record<ObjectType, string>> = {
  plan: "plan_details",
  project: "project_details",
  sub_project: "project_details",
  task: "task_details",
  milestone: "milestone_details",
  estimate: "estimate_details",
  scenario: "scenario_details",
  location: "location_details",
  property: "property_details",
  decision: "decision_details",
  risk: "risk_details",
  note: "note_details",
  document: "document_details",
  person: "person_details",
  event: "event_details",
  memory: "memory_details",
  transaction: "transaction_details",
};

/** Detail fields stored as jsonb; their contents are never key-converted. */
export const JSONB_FIELDS: ReadonlySet<string> = new Set([
  "gateCriteria",
  "options",
  "criteria",
  "scores",
  "blocks",
  "contact",
]);

export const toSnake = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export const toCamel = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

const ENVELOPE_COLUMNS = new Set(["id", "type", "owner_id"]);

/** A details row as read via `to_jsonb(d)` becomes the camelCase `details` object of the API. */
export function detailsFromRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!ENVELOPE_COLUMNS.has(k)) out[toCamel(k)] = v;
  }
  return out;
}

/** Normalises a driver timestamp (Date or string) to an ISO-8601 string. */
export function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
