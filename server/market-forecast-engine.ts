export interface MarketForecastInput {
  regime: string;
  regimeConfidence: number;
  trendScore: number;
  rangeScore: number;
  breakoutScore: number;
  volatilityScore: number;
  riskMood: string;
}

export interface MarketForecastDecision {
  forecast: "TREND_CONTINUATION" | "RANGE_CONTINUATION" | "BREAKOUT_RISK" | "CHOP_RISK";
  score: number;
  approved: boolean;
  confidenceAdjustment: number;
  riskMultiplier: number;
  reason: string;
}

export function forecastMarketState(
  input: MarketForecastInput
): MarketForecastDecision {
  let score = 50;
  let confidenceAdjustment = 0;
  let riskMultiplier = 1;
  const reasons: string[] = [];

  if (input.regime === "TRENDING" && input.trendScore >= 0.65) {
    score += 25;
    confidenceAdjustment += 0.03;
    reasons.push("trend continuation likely");
  }

  if (input.regime === "RANGING" && input.rangeScore >= 0.65) {
    score += 15;
    confidenceAdjustment += 0.01;
    riskMultiplier *= 0.9;
    reasons.push("range continuation likely");
  }

  if (input.breakoutScore >= 0.7 && input.regimeConfidence < 0.65) {
    score -= 20;
    confidenceAdjustment -= 0.04;
    riskMultiplier *= 0.75;
    reasons.push("uncertain breakout risk");
  }

  if (input.volatilityScore >= 0.65) {
    score -= 25;
    confidenceAdjustment -= 0.05;
    riskMultiplier *= 0.65;
    reasons.push("high volatility risk");
  }

  if (input.riskMood === "DANGER" || input.riskMood === "HOSTILE") {
    score -= 30;
    confidenceAdjustment -= 0.06;
    riskMultiplier *= 0.5;
    reasons.push(`risk mood ${input.riskMood}`);
  }

  score = Math.max(0, Math.min(100, score));

  const forecast: MarketForecastDecision["forecast"] =
    input.volatilityScore >= 0.65 ? "CHOP_RISK" :
    input.breakoutScore >= 0.7 ? "BREAKOUT_RISK" :
    input.regime === "RANGING" ? "RANGE_CONTINUATION" :
    "TREND_CONTINUATION";

  return {
    forecast,
    score,
    approved: score >= 40,
    confidenceAdjustment,
    riskMultiplier: Math.max(0.25, Math.min(1.1, riskMultiplier)),
    reason: reasons.join(" | ") || "market forecast acceptable",
  };
}