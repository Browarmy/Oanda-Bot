import type { Candle } from "./autonomous-engine";

export type ExecutionDecisionAction = "EXECUTE_NOW" | "WAIT" | "SKIP";

export interface ExecutionDecision {
  action: ExecutionDecisionAction;
  reason: string;
  score: number;
  pullbackRisk: number;
  spreadRisk: number;
  exhaustionRisk: number;
}

export function evaluateExecutionIntelligence(input: {
  instrument: string;
  direction: "BUY" | "SELL";
  candles: Candle[];
  entry: number;
  atr: number;
  spreadPips: number;
  maxSpreadPips: number;
  confidence: number;
  regime: string;
}): ExecutionDecision {
  const {
    instrument,
    direction,
    candles,
    entry,
    atr,
    spreadPips,
    maxSpreadPips,
    confidence,
    regime,
  } = input;

  if (candles.length < 5 || atr <= 0) {
    return {
      action: "EXECUTE_NOW",
      reason: "not enough execution data, defaulting to market execution",
      score: 0.5,
      pullbackRisk: 0,
      spreadRisk: 0,
      exhaustionRisk: 0,
    };
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const candleRange = Math.max(last.high - last.low, 0);
  const body = Math.abs(last.close - last.open);
  const bodyToAtr = atr > 0 ? body / atr : 0;
  const rangeToAtr = atr > 0 ? candleRange / atr : 0;

  const movedWithTrade =
    direction === "BUY"
      ? last.close > prev.close
      : last.close < prev.close;

  const entryExtended =
    direction === "BUY"
      ? entry > last.open + atr * 0.8
      : entry < last.open - atr * 0.8;

  const spreadRisk = Math.min(1, spreadPips / Math.max(maxSpreadPips, 0.1));

  const exhaustionRisk =
    movedWithTrade && (bodyToAtr > 0.9 || rangeToAtr > 1.3)
      ? Math.min(1, Math.max(bodyToAtr / 1.5, rangeToAtr / 2))
      : 0;

  const pullbackRisk =
    movedWithTrade && entryExtended
      ? Math.min(1, 0.35 + exhaustionRisk * 0.5)
      : exhaustionRisk * 0.4;

  let score = confidence;

  if (spreadRisk > 0.8) score -= 0.15;
  if (exhaustionRisk > 0.65) score -= 0.12;
  if (pullbackRisk > 0.65) score -= 0.12;
  if (regime === "BREAKOUT" && confidence >= 0.85) score += 0.06;

  score = Math.max(0, Math.min(1, score));

  if (spreadRisk >= 1.15) {
    return {
      action: "SKIP",
      reason: `${instrument} execution blocked: spread too wide (${spreadPips.toFixed(1)}p)`,
      score,
      pullbackRisk,
      spreadRisk,
      exhaustionRisk,
    };
  }

  if (pullbackRisk > 0.7 && confidence < 0.9) {
    return {
      action: "WAIT",
      reason:
        `${instrument} execution wait: price extended after strong candle, ` +
        `pullback risk ${(pullbackRisk * 100).toFixed(0)}%`,
      score,
      pullbackRisk,
      spreadRisk,
      exhaustionRisk,
    };
  }

  if (exhaustionRisk > 0.8 && confidence < 0.92) {
    return {
      action: "WAIT",
      reason:
        `${instrument} execution wait: candle exhaustion risk ` +
        `${(exhaustionRisk * 100).toFixed(0)}%`,
      score,
      pullbackRisk,
      spreadRisk,
      exhaustionRisk,
    };
  }

  return {
    action: "EXECUTE_NOW",
    reason:
      `${instrument} execution approved: score ${(score * 100).toFixed(0)}%, ` +
      `spread ${(spreadRisk * 100).toFixed(0)}%, pullback ${(pullbackRisk * 100).toFixed(0)}%`,
    score,
    pullbackRisk,
    spreadRisk,
    exhaustionRisk,
  };
}