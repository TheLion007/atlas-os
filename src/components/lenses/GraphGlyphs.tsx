import { EDGE_STYLE, type Shape } from "../canvases/graph-shapes";
import type { EdgeKind } from "@/domain/enums";

/** A node shape, drawn small, in the current text colour: the key of the Graph's filters. */
export function ShapeIcon({ shape, size = 14 }: { shape: Shape; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      {shape === "circle" && <circle cx="8" cy="8" r="5.5" />}
      {shape === "square" && <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />}
      {shape === "diamond" && <path d="M8 1.5L14.5 8 8 14.5 1.5 8z" />}
      {shape === "triangle" && <path d="M8 2l6.5 11.5h-13z" />}
      {shape === "hexagon" && <path d="M8 1.8l5.4 3.1v6.2L8 14.2 2.6 11.1V4.9z" />}
    </svg>
  );
}

const TONE_VAR = {
  muted: "var(--color-fg-muted)",
  accent: "var(--color-accent)",
  positive: "var(--color-positive)",
} as const;

/** A sample of one kind of link: its width, its dash and its colour. */
export function EdgeSample({ kind }: { kind: EdgeKind }) {
  const style = EDGE_STYLE[kind];
  const stroke =
    typeof style.tone === "string" ? TONE_VAR[style.tone] : `var(--c-type-${style.tone.type})`;
  return (
    <svg width="22" height="10" viewBox="0 0 34 12" aria-hidden="true">
      <line
        x1="2"
        y1="6"
        x2={style.arrow ? 26 : 32}
        y2="6"
        stroke={stroke}
        strokeWidth={style.width + 0.6}
        strokeLinecap="round"
        strokeDasharray={style.dash ? style.dash.join(" ") : undefined}
      />
      {style.arrow && <path d="M32 6l-6-3.5v7z" fill={stroke} />}
    </svg>
  );
}
