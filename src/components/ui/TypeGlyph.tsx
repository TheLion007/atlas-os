import type { ReactNode } from "react";
import type { ObjectType } from "@/domain/enums";

/**
 * One distinct geometric mark per object type (16×16, 1.5px stroke). Colour is never the only
 * cue: the shape identifies the type even in greyscale, and the glyph is decorative because the
 * type is always also named in text.
 */
const SHAPES: Record<ObjectType, ReactNode> = {
  plan: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="2.5" />
      <rect x="4" y="8.6" width="2.1" height="2.1" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="6.95" y="8.6" width="2.1" height="2.1" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="9.9" y="8.6" width="2.1" height="2.1" rx="0.5" fill="currentColor" stroke="none" />
    </>
  ),
  project: <rect x="2.5" y="2.5" width="11" height="11" rx="2" />,
  sub_project: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <rect x="6" y="6" width="4" height="4" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  task: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.6 8.2l1.7 1.7 3.1-3.4" />
    </>
  ),
  milestone: <path d="M8 2.2L13.8 8 8 13.8 2.2 8z" />,
  estimate: (
    <path d="M3 6.2c1.6-1.6 3.2-1.6 5 0s3.4 1.6 5 0M3 10.6c1.6-1.6 3.2-1.6 5 0s3.4 1.6 5 0" />
  ),
  scenario: <path d="M3 4.5h10M3 8h7M3 11.5h4" />,
  location: (
    <>
      <path d="M8 14s4.5-4.2 4.5-7.6a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z" />
      <circle cx="8" cy="6.4" r="1.6" />
    </>
  ),
  property: (
    <>
      <path d="M2.8 7.4L8 3l5.2 4.4V13H2.8z" />
      <path d="M6.6 13V9.4h2.8V13" />
    </>
  ),
  decision: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
    </>
  ),
  risk: (
    <>
      <path d="M8 2.6L14 13H2z" />
      <path d="M8 6.6v3M8 11.4v.1" />
    </>
  ),
  note: <path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h5.5" />,
  document: (
    <>
      <path d="M4 2.5h5.2L12.5 6v7.5H4z" />
      <path d="M9 2.5V6h3.5" />
    </>
  ),
  person: (
    <>
      <circle cx="8" cy="5.6" r="2.4" />
      <path d="M3.4 13.4c.4-2.6 2.2-4 4.6-4s4.2 1.4 4.6 4" />
    </>
  ),
  event: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.8h11M5.5 2v3M10.5 2v3" />
    </>
  ),
  memory: (
    <>
      <path d="M8 2.5a4.7 4.7 0 0 0-2.6 8.6V13h5.2v-1.9A4.7 4.7 0 0 0 8 2.5z" />
      <path d="M6.3 13.5h3.4" />
    </>
  ),
  // Two opposed arrows: money moving in and out.
  transaction: <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" />,
};

interface TypeGlyphProps {
  type: ObjectType;
  size?: number;
  /** Paint in the type's own colour. Otherwise inherits `currentColor`. */
  colored?: boolean;
  className?: string;
}

export function TypeGlyph({ type, size = 16, colored = true, className }: TypeGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={colored ? { color: `var(--c-type-${type})` } : undefined}
    >
      {SHAPES[type]}
    </svg>
  );
}
