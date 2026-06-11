export type RiskMood = "CALM" | "NORMAL" | "HOT" | "DANGEROUS";

export interface RegimeRiskInput {
  instrument: string;
  regime: string;
  riskMood: RiskMood;
  regimeConfidence: number;
  volatilityScore: number;
  trendScore: number;
  rangeScore: number;
  breakoutScore: number;
  baseRiskPct: number;
}

export interface RegimeRiskResult {
  approved: boolean;
  riskMultiplier: number;
  reason: string;
}

export function evaluateRegimeRisk(input: RegimeRiskInput): RegimeRiskResult {
  if (input.riskMood === "DANGEROUS") {
    return {
      approved: false,
      riskMultiplier: 0,
      reason: `dangerous regime mood | vol ${(input.volatilityScore * 100).toFixed(0)}%`,
    };
  }

  let riskMultiplier = 1.0;
  const reasons: string[] = [];

  if (input.riskMood === "HOT") {
    riskMultiplier *= 0.65;
    reasons.push("hot market risk");
  }

  if (input.regimeConfidence < 0.45) {
    riskMultiplier *= 0.75;
    reasons.push("low regime confidence");
  }

  if (input.volatilityScore > 0.75) {
    riskMultiplier *= 0.7;
    reasons.push("high volatility");
  }

  if (input.regime === "RANGING" && input.trendScore > 0.45) {
    riskMultiplier *= 0.8;
    reasons.push("mixed range/trend signal");
  }

  if (input.regime === "TRENDING" && input.rangeScore > 0.45) {
    riskMultiplier *= 0.8;
    reasons.push("mixed trend/range signal");
  }

  if (input.regime === "BREAKOUT" && input.breakoutScore < 0.7) {
    riskMultiplier *= 0.8;
    reasons.push("weak breakout score");
  }

  riskMultiplier = Math.max(0.35, Math.min(1, riskMultiplier));

  return {
    approved: true,
    riskMultiplier,
    reason:
      reasons.length > 0
        ? reasons.join(", ")
        : "regime risk acceptable",
  };
}