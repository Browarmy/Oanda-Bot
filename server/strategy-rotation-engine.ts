export interface StrategyRotationInput {
  strategy: string;
  recentTrades: {
    strategy?: string;
    pnl: number;
    won: boolean;
    closedAt: number;
  }[];
}

export interface StrategyRotationDecision {
  approved: boolean;
  score: number;
  riskMultiplier: number;
  confidenceAdjustment: number;
  reason: string;
}

export function evaluateStrategyRotation(
  input: StrategyRotationInput
): StrategyRotationDecision {
  const trades = input.recentTrades
    .filter(t => (t.strategy ?? "UNKNOWN") === input.strategy)
    .slice(-20);

  if (trades.length < 5) {
    return {
      approved: true,
      score: 60,
      riskMultiplier: 1,
      confidenceAdjustment: 0,
      reason: "not enough recent strategy data",
    };
  }

  const wins = trades.filter(t => t.won).length;
  const pnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const winRate = wins / trades.length;

  let score = 50 + (winRate - 0.5) * 80;
  if (pnl > 0) score += 10;
  else score -= 15;

  const lastFive = trades.slice(-5);
  const lastFiveLosses = lastFive.filter(t => !t.won).length;

  if (lastFiveLosses >= 4) score -= 25;
  else if (lastFiveLosses >= 3) score -= 15;

  score = Math.max(0, Math.min(100, score));

  if (score < 35) {
    return {
      approved: true,
      score,
      riskMultiplier: 0.35,
      confidenceAdjustment: -0.04,
      reason: `${input.strategy} cooling off: ${wins}W/${trades.length - wins}L recent, pnl ${pnl.toFixed(2)} — sized down, not blocked`,
    };
  }

  if (score < 55) {
    return {
      approved: true,
      score,
      riskMultiplier: 0.65,
      confidenceAdjustment: -0.015,
      reason: `${input.strategy} weak recently: ${wins}W/${trades.length - wins}L`,
    };
  }


  return {
    approved: true,
    score,
    riskMultiplier: score > 75 ? 1.05 : 1,
    confidenceAdjustment: score > 75 ? 0.02 : 0,
    reason: `${input.strategy} recent score ${score.toFixed(0)}/100`,
  };
}