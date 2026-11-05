/**
 * Confidence bands from the blueprint (slide 11, ConfidenceMeter):
 * high ≥ 75 · medium 45–74 · low < 45 · unset.
 */
export type ConfidenceBand = "high" | "medium" | "low" | "unset";

export const CONFIDENCE_HIGH_MIN = 75;
export const CONFIDENCE_MEDIUM_MIN = 45;

/** Classify a 0–100 confidence score. `null`/`undefined` means the value was never assessed. */
export function confidenceBand(score: number | null | undefined): ConfidenceBand {
  if (score === null || score === undefined) return "unset";
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError(`Confidence must be a number between 0 and 100, received ${score}`);
  }
  if (score >= CONFIDENCE_HIGH_MIN) return "high";
  if (score >= CONFIDENCE_MEDIUM_MIN) return "medium";
  return "low";
}
