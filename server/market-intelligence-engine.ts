import type { MarketDirection, MarketState } from "./market-state";

interface CandleLike {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BuildMarketStateInput {
  instrument: string;
  direction: MarketDirection;

  m15: CandleLike[];
  h1: CandleLike[];
  d1: CandleLike[];
  h4: CandleLike[];

  bid: number;
  ask: number;
  spreadPips: number;
  maxSpreadPips: number;

  regime: string;
  riskMood: string;
  regimeConfidence: number;
  trendScore: number;
  rangeScore: number;
  breakoutScore: number;
  volatilityScore: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calcStructureScore(
  direction: MarketDirection,
  h1: CandleLike[],
  h4: CandleLike[],
  trendScore: number
): number {
  if (direction === "WAIT") return clamp01(trendScore);

  const h1Closes = h1.map(c => c.close);
  const h4Closes = h4.map(c => c.close);

  const h1Momentum =
    h1Closes.length >= 8
      ? h1Closes[h1Closes.length - 1] - h1Closes[h1Closes.length - 8]
      : 0;

  const h4Momentum =
    h4Closes.length >= 6
      ? h4Closes[h4Closes.length - 1] - h4Closes[h4Closes.length - 6]
      : 0;

  const directionalMomentum =
    direction === "BUY"
      ? Number(h1Momentum > 0) + Number(h4Momentum > 0)
      : Number(h1Momentum < 0) + Number(h4Momentum < 0);

  return clamp01(trendScore * 0.65 + (directionalMomentum / 2) * 0.35);
}

function calcLiquidityScore(m15: CandleLike[]): number {
  if (m15.length < 25) return 0.5;

  const recent = m15.slice(-20);
  const last = recent[recent.length - 1];

  const recentHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
  const recentLow = Math.min(...recent.slice(0, -1).map(c => c.low));

  const sweptHigh = last.high > recentHigh && last.close < recentHigh;
  const sweptLow = last.low < recentLow && last.close > recentLow;

  if (sweptHigh || sweptLow) return 0.85;

  const closeNearHigh =
    (last.close - last.low) / Math.max(last.high - last.low, 0.0000001);

  if (closeNearHigh > 0.75 || closeNearHigh < 0.25) return 0.65;

  return 0.5;
}

function calcVolumeScore(m15: CandleLike[]): number {
  if (m15.length < 25) return 0.5;

  const recent = m15.slice(-21);
  const baseline = average(recent.slice(0, -1).map(c => c.volume));
  const lastVolume = recent[recent.length - 1].volume;

  if (baseline <= 0) return 0.5;

  const volumeRatio = lastVolume / baseline;

  if (volumeRatio >= 1.8) return 0.9;
  if (volumeRatio >= 1.4) return 0.75;
  if (volumeRatio >= 1.1) return 0.6;
  if (volumeRatio < 0.6) return 0.35;

  return 0.5;
}

function grade(score: number): MarketState["grade"] {
  if (score >= 82) return "A";
  if (score >= 68) return "B";
  if (score >= 52) return "C";
  return "D";
}

export function buildMarketState(input: BuildMarketStateInput): MarketState {
  const spreadScore = clamp01(
    1 - input.spreadPips / Math.max(input.maxSpreadPips, 0.0001)
  );

  const structureScore = calcStructureScore(
    input.direction,
    input.h1,
    input.h4,
    input.trendScore
  );

  const liquidityScore = calcLiquidityScore(input.m15);
  const volumeScore = calcVolumeScore(input.m15);

  const institutionalScore = clamp01(
    structureScore * 0.35 +
      liquidityScore * 0.2 +
      volumeScore * 0.2 +
      spreadScore * 0.15 +
      input.regimeConfidence * 0.1
  );

  const rawScore =
    institutionalScore * 100 -
    input.volatilityScore * 12 -
    (input.riskMood === "DANGER" ? 15 : 0) -
    (input.riskMood === "ELEVATED" ? 7 : 0);

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  const confidenceAdjustment =
    score >= 82 ? 0.04 :
    score >= 70 ? 0.02 :
    score < 45 ? -0.05 :
    score < 55 ? -0.03 :
    0;

  const riskMultiplier =
    score >= 82 ? 1.05 :
    score < 45 ? 0.65 :
    score < 55 ? 0.8 :
    1;

  return {
    instrument: input.instrument,
    direction: input.direction,

    regime: input.regime,
    riskMood: input.riskMood,
    regimeConfidence: input.regimeConfidence,

    trendScore: input.trendScore,
    rangeScore: input.rangeScore,
    breakoutScore: input.breakoutScore,
    volatilityScore: input.volatilityScore,

    spreadPips: input.spreadPips,
    maxSpreadPips: input.maxSpreadPips,
    spreadScore,

    structureScore,
    liquidityScore,
    volumeScore,
    institutionalScore,

    score,
    grade: grade(score),
    confidenceAdjustment,
    riskMultiplier,

    summary:
      `Market intelligence ${grade(score)} ${score}/100 | ` +
      `structure ${(structureScore * 100).toFixed(0)}% | ` +
      `liquidity ${(liquidityScore * 100).toFixed(0)}% | ` +
      `volume ${(volumeScore * 100).toFixed(0)}% | ` +
      `institutional ${(institutionalScore * 100).toFixed(0)}%`,
  };
}