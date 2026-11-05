export type RiskLevel = "low" | "medium" | "high" | "critical";

export const RISK_SCALE_MIN = 1;
export const RISK_SCALE_MAX = 5;

/** Upper score bounds (probability × impact) for each band. Documented in docs/PRODUCT.md. */
export const RISK_BANDS = { low: 4, medium: 9, high: 16 } as const;

function assertScale(name: string, value: number): void {
  if (!Number.isInteger(value) || value < RISK_SCALE_MIN || value > RISK_SCALE_MAX) {
    throw new RangeError(
      `${name} must be an integer ${RISK_SCALE_MIN}–${RISK_SCALE_MAX}: ${value}`,
    );
  }
}

/** Score on the 5×5 matrix. */
export function riskScore(probability: number, impact: number): number {
  assertScale("probability", probability);
  assertScale("impact", impact);
  return probability * impact;
}

/** Risk level is derived from probability × impact, never stored. */
export function riskLevel(probability: number, impact: number): RiskLevel {
  const score = riskScore(probability, impact);
  if (score <= RISK_BANDS.low) return "low";
  if (score <= RISK_BANDS.medium) return "medium";
  if (score <= RISK_BANDS.high) return "high";
  return "critical";
}
