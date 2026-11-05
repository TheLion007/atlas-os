import type { ObjectType } from "@/domain/enums";

/**
 * Object-type identity: a label, a muted colour and a glyph name (see TypeGlyph).
 *
 * The colours are deliberately restrained. They were chosen by search under hard constraints,
 * and `object-types.test.ts` keeps them honest: cool muted hues only, low chroma, at least 3:1
 * contrast on the background, clearly distinct from each other, and clear of the reserved
 * sand accent and the positive/critical status colours. Colour is never the only signal:
 * every type also has its own glyph.
 */
export interface ObjectTypeStyle {
  label: string;
  plural: string;
  /** Hex, kept in sync with the `--color-type-*` tokens in globals.css (tested). */
  color: string;
  family: "structure" | "finance" | "place" | "judgement" | "evidence" | "knowledge";
}

export const OBJECT_TYPE_STYLE: Readonly<Record<ObjectType, ObjectTypeStyle>> = {
  // structure — blues
  plan: { label: "Plan", plural: "Plans", color: "#ccc3e0", family: "structure" },
  project: { label: "Project", plural: "Projects", color: "#a4b8da", family: "structure" },
  sub_project: {
    label: "Sub-project",
    plural: "Sub-projects",
    color: "#648aa1",
    family: "structure",
  },
  task: { label: "Task", plural: "Tasks", color: "#7fadbe", family: "structure" },
  milestone: { label: "Milestone", plural: "Milestones", color: "#7d8aa8", family: "structure" },
  // finance — teals
  estimate: { label: "Estimate", plural: "Estimates", color: "#8fc2bb", family: "finance" },
  scenario: { label: "Scenario", plural: "Scenarios", color: "#4a948f", family: "finance" },
  // place — violets
  location: { label: "Location", plural: "Locations", color: "#908eb3", family: "place" },
  property: { label: "Property", plural: "Properties", color: "#7d6c8a", family: "place" },
  // judgement — orchid and rose
  decision: { label: "Decision", plural: "Decisions", color: "#cdaac6", family: "judgement" },
  risk: { label: "Risk", plural: "Risks", color: "#99707e", family: "judgement" },
  // evidence — quieter tones
  note: { label: "Note", plural: "Notes", color: "#ae9eb1", family: "evidence" },
  document: { label: "Document", plural: "Documents", color: "#8c8085", family: "evidence" },
  person: { label: "Person", plural: "People", color: "#b18693", family: "evidence" },
  event: { label: "Event", plural: "Events", color: "#5b8178", family: "evidence" },
  // knowledge — a clear, quiet sky-blue, deliberately its own family (ADR 0002 §0): a memory is
  // not a structural, financial, spatial, judgement or evidence object, it is what Atlas knows.
  memory: { label: "Memory", plural: "Memories", color: "#a1d4e6", family: "knowledge" },
  // finance — a pale mint beside the estimate teal: a dated movement, not a valuation. The only
  // hue still clear of every other type under the palette's constraints (object-types.test.ts).
  transaction: {
    label: "Transaction",
    plural: "Transactions",
    color: "#c6e5df",
    family: "finance",
  },
};

export const typeLabel = (type: ObjectType): string => OBJECT_TYPE_STYLE[type].label;
