export interface DynamicRiskInput {
  baseRiskPct: number;

  confidence: number;
  metaScore: number;

  strategyScore?: number;
  pairScore?: number;
  regimeScore?: number;

  currentDrawdownPct?: number;
}

export interface DynamicRiskResult {
  finalRiskPct: number;
  multiplier: number;
  reason: string;
}

export function calculateDynamicRisk(
  input: DynamicRiskInput
): DynamicRiskResult {

  let multiplier = 1.0;

  // Confidence

  if (input.confidence >= 0.90) {
    multiplier += 0.20;
  }
  else if (input.confidence >= 0.80) {
    multiplier += 0.10;
  }
  else if (input.confidence < 0.65) {
    multiplier -= 0.20;
  }

  // Meta score

  if (input.metaScore >= 0.75) {
    multiplier += 0.20;
  }
  else if (input.metaScore >= 0.65) {
    multiplier += 0.10;
  }
  else if (input.metaScore < 0.50) {
    multiplier -= 0.20;
  }

  // Strategy learning

  if ((input.strategyScore ?? 0.5) > 0.70) {
    multiplier += 0.10;
  }

  // Pair learning

  if ((input.pairScore ?? 0.5) > 0.70) {
    multiplier += 0.10;
  }

  // Regime learning

  if ((input.regimeScore ?? 0.5) > 0.70) {
    multiplier += 0.10;
  }

  // Drawdown protection

  const dd = input.currentDrawdownPct ?? 0;

  if (dd >= 5) {
    multiplier *= 0.75;
  }

  if (dd >= 8) {
    multiplier *= 0.50;
  }

  multiplier = Math.max(
    0.35,
    Math.min(1.50, multiplier)
  );

  return {
    finalRiskPct:
      input.baseRiskPct * multiplier,

    multiplier,

    reason:
      `risk x${multiplier.toFixed(2)}`
  };
}
