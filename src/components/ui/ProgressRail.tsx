import { useId } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";

interface ProgressRailProps {
  /** Fraction of plan achieved (1 = plan). `null` means no data, which is not 0%. */
  actual: number | null;
  /** Where the plan expects to end up (projection). Hatched, never solid. */
  projected?: number;
  /** Position of the target marker as a fraction of plan. Defaults to 1. */
  target?: number;
  /** The one focal rail on a screen may carry the sand accent. Others stay quiet. */
  accent?: boolean;
  label: string;
  className?: string;
}

/**
 * Actual is solid, projection is hatched grey, the target is a tick, and anything past the
 * target is an overrun in the critical colour. The rail spans 0..max(plan, actual, projected),
 * so an overrun is visible instead of clipped. States: actual · projected · target-marker ·
 * overrun · no-data.
 */
export function ProgressRail({
  actual,
  projected,
  target = 1,
  accent = false,
  label,
  className,
}: ProgressRailProps) {
  const patternId = useId();
  const { t } = useI18n();

  if (actual === null) {
    return (
      <div className={cn("flex items-center gap-3", className)} data-state="no-data">
        <div
          role="img"
          aria-label={`${label}: ${t("common.noData")}`}
          className="h-2 grow rounded-control border border-dashed border-border"
        />
        <span className="num w-12 shrink-0 text-right text-xs text-fg-muted">—</span>
      </div>
    );
  }

  const span = Math.max(1, target, actual, projected ?? 0);
  const pct = (v: number) => `${(Math.max(0, v) / span) * 100}%`;
  const overrun = actual > target;
  const fill = accent ? "fill-accent" : "fill-fg";

  return (
    <div
      className={cn("flex items-center gap-3", className)}
      data-state={overrun ? "overrun" : "actual"}
    >
      <svg
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(actual * 100)}
        aria-valuetext={`${formatPercent(actual)} of plan${overrun ? ", over plan" : ""}`}
        width="100%"
        height="8"
        className="min-w-0 grow overflow-visible"
      >
        <defs>
          <pattern
            id={patternId}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-fg-muted" strokeWidth="2" />
          </pattern>
        </defs>
        <rect x="0" y="0" width="100%" height="8" rx="4" className="fill-border" />
        {projected !== undefined && projected > actual && (
          <rect
            x="0"
            y="0"
            width={pct(projected)}
            height="8"
            rx="4"
            fill={`url(#${patternId})`}
            data-part="projected"
          />
        )}
        <rect
          x="0"
          y="0"
          width={pct(Math.min(actual, target))}
          height="8"
          rx="4"
          className={fill}
          data-part="actual"
        />
        {overrun && (
          <rect
            x={pct(target)}
            y="0"
            width={pct(actual - target)}
            height="8"
            className="fill-critical"
            data-part="overrun"
          />
        )}
        <rect x={pct(target)} y="-3" width="2" height="14" className="fill-fg" data-part="target" />
      </svg>
      <span className="num w-12 shrink-0 text-right text-xs text-fg-muted">
        {formatPercent(actual)}
      </span>
    </div>
  );
}
