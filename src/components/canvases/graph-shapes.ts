import type { EdgeKind, ObjectType } from "@/domain/enums";

/**
 * What a node looks like. The shape says what kind of thing it is (colour says which project it
 * belongs to), so the graph reads at a glance and never depends on colour alone.
 */
export type Shape = "circle" | "hexagon" | "square" | "diamond" | "triangle";

export const SHAPE_OF: Readonly<Record<ObjectType, Shape>> = {
  project: "circle",
  location: "circle",
  property: "circle",
  person: "circle",
  event: "circle",
  sub_project: "hexagon",
  plan: "hexagon",
  task: "square",
  estimate: "square",
  scenario: "square",
  transaction: "square",
  note: "square",
  document: "square",
  memory: "square",
  milestone: "diamond",
  decision: "diamond",
  risk: "triangle",
};

/** The shapes, in the order the legend lists them, with the types each one stands for. */
export const SHAPE_ORDER: readonly Shape[] = ["circle", "hexagon", "square", "diamond", "triangle"];

export function typesOfShape(shape: Shape): ObjectType[] {
  return (Object.keys(SHAPE_OF) as ObjectType[]).filter((t) => SHAPE_OF[t] === shape);
}

/** Traces a shape of "radius" `r` centred on (x, y) into a canvas path. */
export function traceShape(
  ctx: Pick<
    CanvasRenderingContext2D,
    "beginPath" | "moveTo" | "lineTo" | "closePath" | "arc" | "roundRect"
  >,
  shape: Shape,
  x: number,
  y: number,
  r: number,
): void {
  ctx.beginPath();
  switch (shape) {
    case "circle":
      ctx.arc(x, y, r, 0, Math.PI * 2);
      return;
    case "square": {
      const s = r * 1.55;
      ctx.roundRect(x - s / 2, y - s / 2, s, s, r * 0.28);
      return;
    }
    case "diamond": {
      const d = r * 1.3;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
      return;
    }
    case "triangle": {
      const d = r * 1.25;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d * 0.95, y + d * 0.7);
      ctx.lineTo(x - d * 0.95, y + d * 0.7);
      ctx.closePath();
      return;
    }
    case "hexagon":
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = x + Math.cos(a) * r * 1.1;
        const py = y + Math.sin(a) * r * 1.1;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
  }
}

/** The look of each kind of link: width, dash and which colour family it takes. */
export interface EdgeStyle {
  width: number;
  dash: readonly number[] | null;
  /** A canvas colour name, or an object type whose colour the link borrows. */
  tone: "muted" | "accent" | "positive" | { type: ObjectType };
  alpha: number;
  arrow: boolean;
}

export const EDGE_STYLE: Readonly<Record<EdgeKind, EdgeStyle>> = {
  contains: { width: 1.6, dash: null, tone: "muted", alpha: 0.5, arrow: false },
  depends_on: { width: 2.2, dash: null, tone: "accent", alpha: 0.85, arrow: true },
  references: { width: 1.1, dash: [4, 4], tone: "muted", alpha: 0.45, arrow: false },
  located_at: { width: 1.6, dash: [1.5, 4], tone: "positive", alpha: 0.7, arrow: false },
  estimates: { width: 1.5, dash: null, tone: { type: "estimate" }, alpha: 0.7, arrow: false },
  funded_by: { width: 1.8, dash: [7, 3], tone: { type: "estimate" }, alpha: 0.7, arrow: true },
  about: { width: 1.3, dash: [2, 3], tone: { type: "memory" }, alpha: 0.6, arrow: false },
  supported_by: { width: 1.3, dash: null, tone: { type: "memory" }, alpha: 0.6, arrow: false },
  derived_from: { width: 1.3, dash: [6, 3], tone: { type: "memory" }, alpha: 0.6, arrow: true },
};

/** The kinds worth a place in the legend (the others read like one of these). */
export const LEGEND_EDGES: readonly EdgeKind[] = [
  "contains",
  "depends_on",
  "references",
  "located_at",
  "funded_by",
];
