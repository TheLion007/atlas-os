import type { ParsedObjectInput } from "./schemas";

/** Upper bound on stored search text; the column is a search aid, not a document store. */
export const SEARCH_TEXT_MAX = 20_000;

const compact = (parts: readonly (string | null | undefined)[]): string[] =>
  parts.filter((p): p is string => typeof p === "string" && p.trim() !== "");

/**
 * The denormalised body text stored in `objects.search_text`. Titles are indexed separately, so
 * this holds only the searchable free text of an object's details plus its tags. Pure and
 * deterministic so it can be recomputed at any time.
 */
export function buildSearchText(input: ParsedObjectInput): string {
  const parts: (string | null | undefined)[] = [...input.tags];

  switch (input.type) {
    case "project":
    case "sub_project":
      parts.push(input.details.description, input.details.kind);
      break;
    case "task":
      parts.push(input.details.description);
      break;
    case "milestone":
      parts.push(...input.details.gateCriteria.map((g) => g.text));
      break;
    case "estimate":
      parts.push(input.details.source, input.details.note, input.details.category);
      parts.push(input.details.subcategory, input.details.ticker, input.details.currency);
      break;
    case "scenario":
      parts.push(input.details.variant, input.details.description);
      break;
    case "location": {
      const d = input.details;
      parts.push(d.countryCode, d.region, d.city, d.district, d.addressLine, d.postalCode);
      parts.push(d.category, d.verdict);
      break;
    }
    case "property":
      parts.push(input.details.stage, input.details.listingRef);
      break;
    case "decision":
      parts.push(input.details.question, ...input.details.options.map((o) => o.label));
      parts.push(input.details.rationale);
      break;
    case "risk":
      parts.push(input.details.mitigation);
      break;
    case "note":
      parts.push(...input.details.blocks.map((b) => b.text));
      break;
    case "document":
      parts.push(input.details.mime, input.details.issuer, input.details.kind);
      parts.push(input.details.description, input.details.originalName, input.details.source);
      // Extracted content last: it is the longest part, and the cap trims it first.
      parts.push(input.details.contentText);
      break;
    case "transaction":
      parts.push(input.details.kind, input.details.subcategory, input.details.description);
      parts.push(input.details.source, input.details.currency);
      break;
    case "person":
      parts.push(input.details.role, input.details.org, input.details.countryCode);
      break;
    case "event":
      parts.push(input.details.kind);
      break;
    case "memory":
      parts.push(input.details.memoryType, input.details.detail);
      break;
  }

  // Accent-insensitive search: words written with accents ("précompte", and an accented title)
  // are also stored folded, so a query typed without them ("precompte") still matches. The
  // folded copy goes first so the length cap trims the long raw content, never the short words.
  const text = compact(parts).join(" ");
  const accented = [input.title, text].join(" ");
  const folded = foldAccents(accented);
  const extra = folded !== accented ? `${folded} ` : "";
  return `${extra}${text}`.slice(0, SEARCH_TEXT_MAX);
}

/** "Précompte immobilier" → "Precompte immobilier": the same text without diacritics. */
export function foldAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}
