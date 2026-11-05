"use client";

import { riskLevel, type RiskLevel } from "@/domain/engine";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";

export interface MatrixRisk {
  id: string;
  title: string;
  probability: number;
  impact: number;
}

export interface MatrixCell {
  probability: number;
  impact: number;
  risks: MatrixRisk[];
}

interface RiskMatrixProps {
  risks: readonly MatrixRisk[];
  selected?: { probability: number; impact: number } | null;
  onSelectCell?: (cell: MatrixCell) => void;
  /** Smaller cells for dashboards. */
  compact?: boolean;
  className?: string;
}

const SCALE = [1, 2, 3, 4, 5] as const;

/** Colour appears only in the top-right quadrant (probability >= 3 and impact >= 3). */
const TINT: Record<RiskLevel, string> = {
  low: "",
  medium: "bg-critical/10",
  high: "bg-critical/20",
  critical: "bg-critical/35",
};

/**
 * Probability × impact, 5×5. It is a table (rows and columns are named), colour is confined to
 * the top-right quadrant as the blueprint asks, and each occupied cell shows how many risks
 * cluster there. The risk level is derived from the cell, never stored. States: 5×5 ·
 * cell-hover · cluster-count · selected.
 */
export function RiskMatrix({
  risks,
  selected = null,
  onSelectCell,
  compact = false,
  className,
}: RiskMatrixProps) {
  const { t } = useI18n();
  const cellSize = compact ? "size-8" : "size-12";

  return (
    <div className={cn("inline-flex flex-col gap-2", className)}>
      <div className="flex items-stretch gap-2">
        <span
          aria-hidden="true"
          className="label flex items-center [writing-mode:vertical-rl] rotate-180"
        >
          {t("risk.probability")}
        </span>
        <table className="border-separate border-spacing-1">
          <caption className="sr-only">{t("risk.matrixCaption")}</caption>
          <thead>
            <tr>
              <td />
              {SCALE.map((i) => (
                <th key={i} scope="col" className="num text-xs font-normal text-fg-muted">
                  <span className="sr-only">{t("risk.impact")} </span>
                  {i}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...SCALE].reverse().map((p) => (
              <tr key={p}>
                <th scope="row" className="num pr-2 text-right text-xs font-normal text-fg-muted">
                  <span className="sr-only">{t("risk.probability")} </span>
                  {p}
                </th>
                {SCALE.map((i) => {
                  const inCell = risks.filter((r) => r.probability === p && r.impact === i);
                  const level = riskLevel(p, i);
                  const coloured = p >= 3 && i >= 3;
                  const isSelected = selected?.probability === p && selected?.impact === i;
                  const face = cn(
                    cellSize,
                    "flex items-center justify-center rounded-control border text-sm",
                    coloured ? TINT[level] : "",
                    isSelected ? "border-fg" : "border-border",
                  );
                  const description = t("risk.cell", {
                    p,
                    i,
                    summary:
                      inCell.length === 0
                        ? t("risk.cellNone")
                        : t("risk.cellCount", { count: inCell.length, level: t(`risk.${level}`) }),
                  });
                  return (
                    <td key={i} className="p-0">
                      {inCell.length > 0 && onSelectCell ? (
                        <button
                          type="button"
                          aria-label={description}
                          aria-pressed={isSelected}
                          data-level={level}
                          onClick={() => onSelectCell({ probability: p, impact: i, risks: inCell })}
                          className={cn(
                            face,
                            "num transition-colors duration-(--duration-hover) hover:bg-selected",
                          )}
                        >
                          {inCell.length}
                        </button>
                      ) : (
                        <div
                          role={inCell.length > 0 ? "img" : undefined}
                          aria-label={inCell.length > 0 ? description : undefined}
                          data-level={level}
                          className={cn(face, "num text-fg-muted")}
                        >
                          {inCell.length > 0 ? inCell.length : ""}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span aria-hidden="true" className="label self-center">
        {t("risk.impact")}
      </span>
    </div>
  );
}
