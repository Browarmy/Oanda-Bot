export type MarketDirection = "BUY" | "SELL" | "WAIT";
export type MarketRiskMood = "CALM" | "NORMAL" | "ELEVATED" | "DANGER" | string;

export interface MarketState {
  instrument: string;
  direction: MarketDirection;

  regime: string;
  riskMood: MarketRiskMood;
  regimeConfidence: number;

  trendScore: number;
  rangeScore: number;
  breakoutScore: number;
  volatilityScore: number;

  spreadPips: number;
  maxSpreadPips: number;
  spreadScore: number;

  structureScore: number;
  liquidityScore: number;
  volumeProfileScore: number;
volumeProfilePosition: string;
volumeProfilePoc: number;
volumeProfileValueAreaHigh: number;
volumeProfileValueAreaLow: number;
volumeProfileSummary: string;

  score: number;
  grade: "A" | "B" | "C" | "D";
  confidenceAdjustment: number;
  riskMultiplier: number;

  summary: string;
}