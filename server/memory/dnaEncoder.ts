// server/memory/dnaEncoder.ts

import type { MarketDirection, MarketState } from "../market-state";

export type DnaVector = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
];

export type TrendDirection = "BEARISH" | "NEUTRAL" | "BULLISH";
export type VolatilityState = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
export type VolumeProfilePosition = "BELOW_VALUE" | "IN_VALUE" | "ABOVE_VALUE";
export type TradingSession = "ASIA" | "LONDON" | "NEW_YORK" | "OVERLAP";
export type RegimeState = "RANGING" | "TRANSITIONING" | "TRENDING";
export type MomentumDirection = "BEARISH" | "NEUTRAL" | "BULLISH";
export type MacroFlag = "NONE" | "SCHEDULED_EVENT" | "ACTIVE_SHOCK";

export interface MarketCharacterisationForDna {
  marketState: MarketState;

  trendDirection?: TrendDirection | Lowercase<TrendDirection>;
  session?: TradingSession | Lowercase<TradingSession>;
  momentumDirection?: MomentumDirection | Lowercase<MomentumDirection>;
  macroFlag?: MacroFlag | Lowercase<MacroFlag>;

  confidenceScore?: number;
  direction?: MarketDirection;
}

const DNA_VECTOR_DIMENSIONS = 10;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.0;
  return Math.max(0.0, Math.min(1.0, value));
}

function normalisePercent(value: number): number {
  if (!Number.isFinite(value)) return 0.0;
  return clamp01(value > 1 ? value / 100 : value);
}

function roundDnaValue(value: number): number {
  return Number(clamp01(value).toFixed(6));
}

function normaliseKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function encodeTrendDirection(value: unknown, fallbackDirection?: MarketDirection): number {
  const key = normaliseKey(value);

  if (key === "BEARISH" || key === "SELL") return 0.0;
  if (key === "NEUTRAL" || key === "WAIT") return 0.5;
  if (key === "BULLISH" || key === "BUY") return 1.0;

  if (fallbackDirection === "SELL") return 0.0;
  if (fallbackDirection === "BUY") return 1.0;

  return 0.5;
}

function encodeVolumeProfilePosition(value: unknown): number {
  const key = normaliseKey(value);

  if (key === "BELOW_VALUE") return 0.0;
  if (key === "ABOVE_VALUE") return 1.0;

  return 0.5;
}

function encodeSession(value: unknown): number {
  const key = normaliseKey(value);

  if (key === "ASIA" || key === "ASIAN_SESSION" || key === "TOKYO") return 0.25;
  if (key === "LONDON" || key === "LONDON_OPEN" || key === "LONDON_MAIN") return 0.5;
  if (key === "NEW_YORK" || key === "NY" || key === "NY_MAIN") return 0.75;
  if (key === "OVERLAP" || key === "LONDON_NY" || key === "LONDON_NY_OVERLAP" || key === "LONDON_NEW_YORK_OVERLAP") return 1.0;

  return 0.5;
}

function encodeRegime(value: unknown): number {
  const key = normaliseKey(value);

  if (key === "RANGING") return 0.0;
  if (key === "TRENDING" || key === "BREAKOUT") return 1.0;

  return 0.5;
}

function encodeMomentumDirection(value: unknown, fallbackDirection?: MarketDirection): number {
  const key = normaliseKey(value);

  if (key === "BEARISH" || key === "SELL") return 0.0;
  if (key === "BULLISH" || key === "BUY") return 1.0;
  if (key === "NEUTRAL" || key === "WAIT") return 0.5;

  if (fallbackDirection === "SELL") return 0.0;
  if (fallbackDirection === "BUY") return 1.0;

  return 0.5;
}

function encodeMacroFlag(value: unknown): number {
  const key = normaliseKey(value);

  if (key === "SCHEDULED_EVENT") return 0.5;
  if (key === "ACTIVE_SHOCK") return 1.0;

  return 0.0;
}

export function encodeMarketStateToDnaVector(input: MarketCharacterisationForDna): DnaVector {
  const { marketState } = input;

  const dnaVector: DnaVector = [
    roundDnaValue(encodeTrendDirection(input.trendDirection, input.direction ?? marketState.direction)),
    roundDnaValue(normalisePercent(marketState.trendScore)),
    roundDnaValue(encodeVolatilityState(marketState.volatilityScore)),
    roundDnaValue(encodeVolumeProfilePosition(marketState.volumeProfilePosition)),
    roundDnaValue(encodeSession(input.session)),
    roundDnaValue(encodeRegime(marketState.regime)),
    roundDnaValue(normalisePercent(marketState.liquidityScore)),
    roundDnaValue(encodeMomentumDirection(input.momentumDirection, input.direction ?? marketState.direction)),
    roundDnaValue(encodeMacroFlag(input.macroFlag)),
    roundDnaValue(normalisePercent(input.confidenceScore ?? marketState.regimeConfidence)),
  ];

  if (!validateDnaVector(dnaVector)) {
    throw new Error("[DnaEncoder] Generated DNA vector failed 10-dimension validation.");
  }

  return dnaVector;
}

export function validateDnaVector(dnaVector: number[]): dnaVector is DnaVector {
  return (
    Array.isArray(dnaVector) &&
    dnaVector.length === DNA_VECTOR_DIMENSIONS &&
    dnaVector.every((value) => Number.isFinite(value) && value >= 0.0 && value <= 1.0)
  );
}