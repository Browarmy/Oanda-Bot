export interface TradeQualityInput {
  instrument: string;
  regime: string;
  strategy: string;
  confidence: number;
  rsi: number;
}

export interface TradeQualityResult {
  score: number;
  approved: boolean;
  reason: string;
}

export function evaluateTradeQuality(
  input: TradeQualityInput,
  history: any[]
): TradeQualityResult {

  if (history.length < 30) {
    return {
      score: 50,
      approved: true,
      reason: "Insufficient history",
    };
  }

  let winningMatches = 0;
  let losingMatches = 0;

  for (const trade of history) {

    let similarity = 0;

    if (trade.strategy === input.strategy)
      similarity += 25;

    if (trade.regime === input.regime)
      similarity += 25;

    if (
      Math.abs((trade.confidence ?? 0) - input.confidence)
      <= 0.10
    )
      similarity += 25;

    if (
      Math.abs((trade.rsi ?? 50) - input.rsi)
      <= 5
    )
      similarity += 25;

    if (similarity >= 75) {
      if (trade.won)
        winningMatches++;
      else
        losingMatches++;
    }
  }

  const total =
    winningMatches +
    losingMatches;

  if (total === 0) {
    return {
      score: 50,
      approved: true,
      reason: "No similar setups",
    };
  }

  const score =
    (winningMatches / total) * 100;

  return {
    score,
    approved: score >= 55,
    reason:
      `${winningMatches} winners vs ` +
      `${losingMatches} losers`,
  };
}