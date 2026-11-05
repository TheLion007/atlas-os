import { confidenceBand } from "@/domain/confidence";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";

const TICKS = 5;

interface ConfidenceMeterProps {
  /** 0–100, or null/undefined when never assessed. */
  score: number | null | undefined;
  /** Show the band name next to the ticks. */
  showLabel?: boolean;
  className?: string;
}

/**
 * Five ticks, not a percentage bar: confidence is a judgement, not a measurement. Each tick is
 * 20 points. The band (high ≥ 75 · medium 45–74 · low < 45 · unset) is always available as
 * text, and an unset value is drawn hollow so "unknown" never looks like "low".
 */
export function ConfidenceMeter({ score, showLabel = false, className }: ConfidenceMeterProps) {
  const { t } = useI18n();
  const band = confidenceBand(score);
  const filled = score === null || score === undefined ? 0 : Math.max(1, Math.ceil(score / 20));
  const description =
    band === "unset"
      ? t("confidence.unsetLabel")
      : t("confidence.label", { band: t(`confidence.${band}`).toLowerCase(), score: score ?? 0 });

  return (
    <span className={cn("inline-flex items-center gap-2", className)} data-band={band}>
      <span role="img" aria-label={description} className="inline-flex items-end gap-1">
        {Array.from({ length: TICKS }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              "inline-block h-3 w-1 rounded-control",
              band === "unset"
                ? "border border-dashed border-fg-muted"
                : i < filled
                  ? "bg-fg"
                  : "bg-border",
            )}
          />
        ))}
      </span>
      {showLabel && <span className="label">{t(`confidence.${band}`)}</span>}
    </span>
  );
}
