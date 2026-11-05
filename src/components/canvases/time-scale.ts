import { diffDays } from "@/domain/dates";

/** Maps calendar dates to pixels across a window, and produces the axis ticks. */
export interface TimeScale {
  x(iso: string): number;
  /** Axis ticks: years, or quarters when zoomed in. */
  ticks(zoom: "year" | "quarter"): { x: number; label: string; major: boolean }[];
  width: number;
}

export function makeTimeScale(start: string, end: string, width: number): TimeScale {
  const total = Math.max(1, diffDays(start, end));
  const x = (iso: string) => (diffDays(start, iso) / total) * width;
  const y0 = Number(start.slice(0, 4));
  const y1 = Number(end.slice(0, 4));

  return {
    width,
    x,
    ticks(zoom) {
      const out: { x: number; label: string; major: boolean }[] = [];
      for (let y = y0; y <= y1; y++) {
        if (zoom === "year") {
          out.push({ x: x(`${y}-01-01`), label: String(y), major: true });
        } else {
          for (let q = 0; q < 4; q++) {
            const month = String(q * 3 + 1).padStart(2, "0");
            out.push({
              x: x(`${y}-${month}-01`),
              label: q === 0 ? `${y}` : `Q${q + 1}`,
              major: q === 0,
            });
          }
        }
      }
      return out.filter((t) => t.x >= 0 && t.x <= width);
    },
  };
}
