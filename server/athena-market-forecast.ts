export function forecastMarketState(input: {
  regime: string;
  regimeConfidence: number;
  trendScore: number;
  rangeScore: number;
  breakoutScore: number;
  volatilityScore: number;
  riskMood: string;
}) {
  let score = 50;
  const reasons: string[] = [];

  score += input.regimeConfidence * 20;

  if (input.riskMood === "CALM") score += 10;
  if (input.riskMood === "DANGEROUS") score -= 20;
  if (input.volatilityScore > 0.75) score -= 15;
  if (input.breakoutScore > 0.65) score += 8;
  if (input.trendScore > 0.65) score += 8;

  if (input.regime === "NEUTRAL") score -= 8;

  score = Math.max(0, Math.min(100, score));

  if (input.riskMood === "DANGEROUS") reasons.push("dangerous risk mood");
  if (input.volatilityScore > 0.75) reasons.push("high volatility");
  if (input.regimeConfidence < 0.35) reasons.push("low regime confidence");
  if (input.trendScore > 0.65) reasons.push("trend support");
  if (input.breakoutScore > 0.65) reasons.push("breakout support");

  const approved = score >= 55;

  return {
    approved,
    score,
    forecast:
      score >= 75 ? "FAVOURABLE" :
      score >= 55 ? "ACCEPTABLE" :
      "UNFAVOURABLE",
    confidenceAdjustment:
      score >= 75 ? 0.03 :
      score < 55 ? -0.05 :
      0,
    riskMultiplier:
      score >= 75 ? 1.05 :
      score < 55 ? 0.75 :
      1,
    reason: reasons.length ? reasons.join(", ") : "market forecast acceptable",
  };
}