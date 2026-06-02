/**
 * Multi-Strategy Engine v1
 *
 * Three strategies, each activated by market regime:
 *
 * 1. TREND_FOLLOW  — ADX > 25, price trending. Uses EMA crossover + MACD + RSI momentum.
 *                    Best in London/NY sessions. Targets 3:1 RR.
 *
 * 2. MEAN_REVERT   — ADX < 20, BB squeeze, price at extremes. Fades the move.
 *                    RSI overbought/oversold + BB band touch. Targets 1.5:1 RR.
 *                    Tighter SL (0.8x ATR), quicker TP (1.2x ATR).
 *
 * 3. BREAKOUT      — Price breaks above/below N-period high/low with volume surge.
 *                    Requires BB expansion + MACD momentum. Targets 2.5:1 RR.
 *                    Only trades during London open (07-09 UTC) or NY open (13-15 UTC).
 *
 * Regime Detection:
 *   ADX > 25 + ATR > 60th percentile → TRENDING
 *   ADX < 20 + BB width < 40th percentile → RANGING
 *   Price breaks N-bar range + volume > 1.5x avg → BREAKOUT
 *   Otherwise → NEUTRAL (no trade)
 *
 * Walk-Forward Optimiser:
 *   Every 30 closed trades, runs a mini-backtest on the last 200 candles.
 *   Tests ±10% variations of current RSI/ATR params.
 *   Adopts the best-performing variation (by Sharpe-like ratio).
 */

import type { Candle } from "./autonomous-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MarketRegime = "TRENDING" | "RANGING" | "BREAKOUT" | "NEUTRAL" | "VOLATILE";
export type StrategyType = "TREND_FOLLOW" | "MEAN_REVERT" | "BREAKOUT" | "NONE";

export interface RegimeAnalysis {
  regime: MarketRegime;
  adx: number;
  bbWidth: number;
  atrPercentile: number;
  trendStrength: number;   // 0-1
  volatility: number;      // 0-1
  rangebound: number;      // 0-1
}

export interface StrategySignal {
  action: "BUY" | "SELL" | "WAIT";
  strategy: StrategyType;
  confidence: number;
  reason: string;
  slMultiplier: number;    // ATR multiplier for SL
  tpMultiplier: number;    // ATR multiplier for TP
  rsi: number;
  atr: number;
  ema9: number;
  ema21: number;
  macd: number;
  bbPosition: number;
  signalsAgreeing: number;
}

export interface WalkForwardResult {
  instrument: string;
  bestRsiLower: number;
  bestRsiUpper: number;
  bestSlMult: number;
  bestTpMult: number;
  sharpeRatio: number;
  winRate: number;
  totalTrades: number;
  testedAt: number;
}

export interface CorrelationGroup {
  pairs: string[];
  direction: "USD_LONG" | "USD_SHORT" | "EUR_LONG" | "EUR_SHORT" | "JPY_LONG" | "JPY_SHORT" | "GOLD_LONG" | "GOLD_SHORT" | "GBP_LONG" | "GBP_SHORT";
}

// ─── Correlation groups — pairs that move together ────────────────────────────
// Opening two trades in the same group = double exposure
const CORRELATION_GROUPS: CorrelationGroup[] = [
  { pairs: ["EUR_USD", "GBP_USD", "AUD_USD", "NZD_USD"], direction: "USD_SHORT" },
  { pairs: ["USD_JPY", "USD_CHF", "USD_CAD"], direction: "USD_LONG" },
  { pairs: ["EUR_USD", "EUR_GBP", "EUR_JPY", "EUR_CHF", "EUR_AUD"], direction: "EUR_LONG" },
  { pairs: ["GBP_USD", "GBP_JPY", "GBP_CHF"], direction: "GBP_LONG" },
  { pairs: ["USD_JPY", "EUR_JPY", "GBP_JPY", "AUD_JPY", "CAD_JPY"], direction: "JPY_SHORT" },
  { pairs: ["XAU_USD", "XAG_USD"], direction: "GOLD_LONG" },
];

// ─── Math helpers ─────────────────────────────────────────────────────────────

function emaArr(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function rsiVal(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function atrVal(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs = candles.slice(1).map((c, i) =>
    Math.max(c.high - c.low, Math.abs(c.high - candles[i].close), Math.abs(c.low - candles[i].close))
  );
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function adx(candles: Candle[], period = 14): number {
  if (candles.length < period * 2) return 0;
  const slice = candles.slice(-period * 2);
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trs: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    const c = slice[i], p = slice[i - 1];
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const smoothTR = trs.slice(-period).reduce((a, b) => a + b, 0);
  const smoothPlus = plusDM.slice(-period).reduce((a, b) => a + b, 0);
  const smoothMinus = minusDM.slice(-period).reduce((a, b) => a + b, 0);
  if (smoothTR === 0) return 0;
  const diPlus = (smoothPlus / smoothTR) * 100;
  const diMinus = (smoothMinus / smoothTR) * 100;
  const diSum = diPlus + diMinus;
  if (diSum === 0) return 0;
  return (Math.abs(diPlus - diMinus) / diSum) * 100;
}

function bbWidth(values: number[], period = 20): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  return mean > 0 ? (sd * 4) / mean : 0;  // normalised BB width
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function macdHist(values: number[]): number {
  if (values.length < 26) return 0;
  const fast = emaArr(values, 12);
  const slow = emaArr(values, 26);
  const macdLine = fast.map((v, i) => v - slow[i]);
  const sig = emaArr(macdLine, 9);
  return macdLine[macdLine.length - 1] - sig[sig.length - 1];
}

function nPeriodHigh(candles: Candle[], n: number): number {
  return Math.max(...candles.slice(-n).map(c => c.high));
}

function nPeriodLow(candles: Candle[], n: number): number {
  return Math.min(...candles.slice(-n).map(c => c.low));
}

// ─── RSI Divergence Detector ──────────────────────────────────────────────────
// Bullish divergence: price makes lower low, RSI makes higher low → reversal up
// Bearish divergence: price makes higher high, RSI makes lower high → reversal down
export interface DivergenceResult {
  bullish: boolean;
  bearish: boolean;
  strength: number; // 0–1
  description: string;
}

export function detectRSIDivergence(candles: Candle[], lookback = 20): DivergenceResult {
  const none: DivergenceResult = { bullish: false, bearish: false, strength: 0, description: "No divergence" };
  if (candles.length < lookback + 5) return none;

  const slice = candles.slice(-lookback);
  const closes = slice.map(c => c.close);

  // Compute RSI for each candle in the window
  const rsiSeries: number[] = [];
  for (let i = 5; i < closes.length; i++) {
    rsiSeries.push(rsiVal(closes.slice(0, i + 1), Math.min(14, i)));
  }
  if (rsiSeries.length < 6) return none;

  // Find the two most recent swing lows in price
  const priceSwingLows: { idx: number; price: number; rsi: number }[] = [];
  const priceSwingHighs: { idx: number; price: number; rsi: number }[] = [];

  for (let i = 2; i < slice.length - 2; i++) {
    const rsiIdx = i - 5;
    if (rsiIdx < 0 || rsiIdx >= rsiSeries.length) continue;
    const p = slice[i].low;
    if (p < slice[i - 1].low && p < slice[i - 2].low && p < slice[i + 1].low && p < slice[i + 2].low) {
      priceSwingLows.push({ idx: i, price: p, rsi: rsiSeries[rsiIdx] });
    }
    const h = slice[i].high;
    if (h > slice[i - 1].high && h > slice[i - 2].high && h > slice[i + 1].high && h > slice[i + 2].high) {
      priceSwingHighs.push({ idx: i, price: h, rsi: rsiSeries[rsiIdx] });
    }
  }

  // Bullish divergence: last two swing lows — price lower, RSI higher
  if (priceSwingLows.length >= 2) {
    const [prev, curr] = priceSwingLows.slice(-2);
    if (curr.price < prev.price && curr.rsi > prev.rsi + 2) {
      const strength = Math.min((curr.rsi - prev.rsi) / 15, 1);
      return { bullish: true, bearish: false, strength, description: `Bullish RSI divergence: price ${prev.price.toFixed(5)}→${curr.price.toFixed(5)}, RSI ${prev.rsi.toFixed(0)}→${curr.rsi.toFixed(0)}` };
    }
  }

  // Bearish divergence: last two swing highs — price higher, RSI lower
  if (priceSwingHighs.length >= 2) {
    const [prev, curr] = priceSwingHighs.slice(-2);
    if (curr.price > prev.price && curr.rsi < prev.rsi - 2) {
      const strength = Math.min((prev.rsi - curr.rsi) / 15, 1);
      return { bullish: false, bearish: true, strength, description: `Bearish RSI divergence: price ${prev.price.toFixed(5)}→${curr.price.toFixed(5)}, RSI ${prev.rsi.toFixed(0)}→${curr.rsi.toFixed(0)}` };
    }
  }

  return none;
}

// ─── D1 Key Level Detector ────────────────────────────────────────────────────
// Identifies daily support/resistance levels from the last 20 D1 candles.
// Returns proximity score: 1.0 = price is AT a key level (high confluence)
export interface KeyLevelResult {
  nearSupport: boolean;
  nearResistance: boolean;
  proximityScore: number; // 0–1, higher = closer to key level
  nearestLevel: number;
  description: string;
}

export function checkD1KeyLevels(d1Candles: Candle[], currentPrice: number): KeyLevelResult {
  const none: KeyLevelResult = { nearSupport: false, nearResistance: false, proximityScore: 0, nearestLevel: 0, description: "No D1 data" };
  if (d1Candles.length < 5) return none;

  // Collect significant D1 highs and lows (swing points)
  const levels: number[] = [];
  for (let i = 1; i < d1Candles.length - 1; i++) {
    const c = d1Candles[i];
    const prev = d1Candles[i - 1];
    const next = d1Candles[i + 1];
    // Swing high
    if (c.high > prev.high && c.high > next.high) levels.push(c.high);
    // Swing low
    if (c.low < prev.low && c.low < next.low) levels.push(c.low);
    // Previous close (round number confluence)
    levels.push(c.close);
  }

  if (levels.length === 0) return none;

  // ATR of D1 candles for proximity threshold
  const d1Atr = atrVal(d1Candles, Math.min(14, d1Candles.length - 1));
  const threshold = d1Atr * 0.3; // within 30% of D1 ATR = "near" a level

  let nearestLevel = levels[0];
  let minDist = Math.abs(currentPrice - levels[0]);

  for (const level of levels) {
    const dist = Math.abs(currentPrice - level);
    if (dist < minDist) { minDist = dist; nearestLevel = level; }
  }

  const proximityScore = threshold > 0 ? Math.max(0, 1 - minDist / threshold) : 0;
  const nearSupport = currentPrice > nearestLevel && proximityScore > 0.4;
  const nearResistance = currentPrice < nearestLevel && proximityScore > 0.4;

  return {
    nearSupport, nearResistance, proximityScore, nearestLevel,
    description: proximityScore > 0.4
      ? `Price near D1 ${nearSupport ? 'support' : 'resistance'} at ${nearestLevel.toFixed(5)} (score ${(proximityScore * 100).toFixed(0)}%)`
      : `No significant D1 level nearby`,
  };
}

// ─── Regime Detector ──────────────────────────────────────────────────────────

export function detectRegime(m15: Candle[], h1: Candle[]): RegimeAnalysis {
  const closes = m15.map(c => c.close);
  const adxVal = adx(m15, 14);
  const bbW = bbWidth(closes, 20);
  const atr = atrVal(m15, 14);

  // ATR percentile over last 50 candles
  const recentAtrs = m15.slice(-50).slice(1).map((c, i) =>
    Math.max(c.high - c.low, Math.abs(c.high - m15[i].close), Math.abs(c.low - m15[i].close))
  );
  const atr50th = percentile(recentAtrs, 50);
  const atr80th = percentile(recentAtrs, 80);
  const atrPercentile = atr50th > 0 ? Math.min(atr / atr50th, 2) : 1;

  // BB width percentile
  const recentBbWidths: number[] = [];
  for (let i = 20; i < closes.length; i++) {
    recentBbWidths.push(bbWidth(closes.slice(0, i + 1), 20));
  }
  const bbW40th = percentile(recentBbWidths, 40);
  const bbW70th = percentile(recentBbWidths, 70);

  // Breakout: price near N-period high/low
  const lastClose = closes[closes.length - 1];
  const high20 = nPeriodHigh(m15, 20);
  const low20 = nPeriodLow(m15, 20);
  const range20 = high20 - low20;
  const nearBreakout = range20 > 0 && (
    (lastClose > high20 - range20 * 0.05) ||
    (lastClose < low20 + range20 * 0.05)
  );

  // Volume surge
  const vols = m15.slice(-21).map(c => c.volume);
  const avgVol = vols.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
  const volSurge = vols[20] > avgVol * 1.4;

  let regime: MarketRegime = "NEUTRAL";
  if (adxVal > 25 && atrPercentile > 0.8) {
    regime = "TRENDING";
  } else if (adxVal < 20 && bbW < bbW40th) {
    regime = "RANGING";
  } else if (nearBreakout && volSurge && bbW > bbW70th) {
    regime = "BREAKOUT";
  } else if (atr > atr80th) {
    regime = "VOLATILE";
  }

  return {
    regime,
    adx: adxVal,
    bbWidth: bbW,
    atrPercentile,
    trendStrength: Math.min(adxVal / 50, 1),
    volatility: Math.min(atrPercentile / 2, 1),
    rangebound: adxVal < 20 ? (1 - adxVal / 20) : 0,
  };
}

// ─── Strategy 1: Trend Following ──────────────────────────────────────────────

export function trendFollowSignal(
  m15: Candle[],
  h1: Candle[],
  params: { rsiLower: number; rsiUpper: number; minSignals: number }
): StrategySignal {
  const empty: StrategySignal = {
    action: "WAIT", strategy: "TREND_FOLLOW", confidence: 0, reason: "No trend signal",
    slMultiplier: 1.5, tpMultiplier: 3.0, rsi: 50, atr: 0, ema9: 0, ema21: 0, macd: 0, bbPosition: 0.5, signalsAgreeing: 0,
  };
  if (m15.length < 30 || h1.length < 20) return empty;

  const m15c = m15.map(c => c.close);
  const h1c = h1.map(c => c.close);

  const h1e9 = emaArr(h1c, 9), h1e21 = emaArr(h1c, 21);
  const h1Bull = h1e9[h1e9.length - 1] > h1e21[h1e21.length - 1];
  const h1Bear = h1e9[h1e9.length - 1] < h1e21[h1e21.length - 1];

  const m15e9 = emaArr(m15c, 9), m15e21 = emaArr(m15c, 21);
  const lastE9 = m15e9[m15e9.length - 1], lastE21 = m15e21[m15e21.length - 1];
  const prevE9 = m15e9[m15e9.length - 2] ?? lastE9, prevE21 = m15e21[m15e21.length - 2] ?? lastE21;

  const rsi = rsiVal(m15c, 14);
  const atr = atrVal(m15, 14);
  const macd = macdHist(m15c);
  const lastClose = m15c[m15c.length - 1];

  // BB position
  const slice = m15c.slice(-20);
  const bbMean = slice.reduce((a, b) => a + b, 0) / 20;
  const bbSd = Math.sqrt(slice.reduce((a, b) => a + (b - bbMean) ** 2, 0) / 20);
  const bbPos = bbSd > 0 ? (lastClose - (bbMean - 2 * bbSd)) / (4 * bbSd) : 0.5;

  const buySignals = [
    h1Bull,
    lastE9 > lastE21,
    rsi >= params.rsiLower && rsi <= params.rsiUpper,
    macd > 0,
    lastClose > lastE21,
  ];
  const sellSignals = [
    h1Bear,
    lastE9 < lastE21,
    rsi >= (100 - params.rsiUpper) && rsi <= (100 - params.rsiLower),
    macd < 0,
    lastClose < lastE21,
  ];

  const buyCount = buySignals.filter(Boolean).length;
  const sellCount = sellSignals.filter(Boolean).length;

  let action: "BUY" | "SELL" | "WAIT" = "WAIT";
  let signalsAgreeing = 0;
  let reason = "No trend confluence";

  if (buyCount >= params.minSignals) {
    action = "BUY"; signalsAgreeing = buyCount;
    reason = `TREND BUY ${buyCount}/5 | H1:${h1Bull ? "✓" : "✗"} EMA:${lastE9 > lastE21 ? "✓" : "✗"} RSI:${rsi.toFixed(0)} MACD:${macd > 0 ? "+" : "-"}`;
  } else if (sellCount >= params.minSignals) {
    action = "SELL"; signalsAgreeing = sellCount;
    reason = `TREND SELL ${sellCount}/5 | H1:${h1Bear ? "✓" : "✗"} EMA:${lastE9 < lastE21 ? "✓" : "✗"} RSI:${rsi.toFixed(0)} MACD:${macd < 0 ? "-" : "+"}`;
  }

  let confidence = signalsAgreeing / 5;
  if (action !== "WAIT") {
    if (action === "BUY" && lastE9 > lastE21 && prevE9 <= prevE21) confidence += 0.08; // fresh cross
    if (action === "SELL" && lastE9 < lastE21 && prevE9 >= prevE21) confidence += 0.08;
    if (action === "BUY" && bbPos < 0.4) confidence += 0.04;
    if (action === "SELL" && bbPos > 0.6) confidence += 0.04;
  }

  return { action, strategy: "TREND_FOLLOW", confidence: Math.min(confidence, 0.99), reason,
    slMultiplier: 1.5, tpMultiplier: 3.0, rsi, atr, ema9: lastE9, ema21: lastE21, macd, bbPosition: bbPos, signalsAgreeing };
}

// ─── Strategy 2: Mean Reversion ───────────────────────────────────────────────

export function meanReversionSignal(m15: Candle[], h1: Candle[]): StrategySignal {
  const empty: StrategySignal = {
    action: "WAIT", strategy: "MEAN_REVERT", confidence: 0, reason: "No mean-reversion signal",
    slMultiplier: 0.8, tpMultiplier: 1.5, rsi: 50, atr: 0, ema9: 0, ema21: 0, macd: 0, bbPosition: 0.5, signalsAgreeing: 0,
  };
  if (m15.length < 25) return empty;

  const m15c = m15.map(c => c.close);
  const rsi = rsiVal(m15c, 14);
  const atr = atrVal(m15, 14);
  const macd = macdHist(m15c);
  const lastClose = m15c[m15c.length - 1];

  const slice = m15c.slice(-20);
  const bbMean = slice.reduce((a, b) => a + b, 0) / 20;
  const bbSd = Math.sqrt(slice.reduce((a, b) => a + (b - bbMean) ** 2, 0) / 20);
  const bbUpper = bbMean + 2 * bbSd;
  const bbLower = bbMean - 2 * bbSd;
  const bbPos = bbSd > 0 ? (lastClose - bbLower) / (4 * bbSd) : 0.5;

  const e9 = emaArr(m15c, 9), e21 = emaArr(m15c, 21);
  const lastE9 = e9[e9.length - 1], lastE21 = e21[e21.length - 1];

  // Mean reversion BUY: oversold + at lower BB + MACD turning up
  const prevMacd = macdHist(m15c.slice(0, -1));
  const macdTurningUp = macd > prevMacd;
  const macdTurningDown = macd < prevMacd;

  const buySignals = [
    rsi < 35,                        // oversold
    lastClose <= bbLower * 1.002,    // at or below lower BB
    macdTurningUp,                   // MACD turning up
    lastClose > m15c[m15c.length - 2], // last candle green
  ];
  const sellSignals = [
    rsi > 65,                        // overbought
    lastClose >= bbUpper * 0.998,    // at or above upper BB
    macdTurningDown,                 // MACD turning down
    lastClose < m15c[m15c.length - 2], // last candle red
  ];

  const buyCount = buySignals.filter(Boolean).length;
  const sellCount = sellSignals.filter(Boolean).length;

  if (buyCount >= 3) {
    const conf = 0.55 + (buyCount - 3) * 0.1 + (rsi < 25 ? 0.1 : 0);
    return { action: "BUY", strategy: "MEAN_REVERT", confidence: Math.min(conf, 0.85),
      reason: `MEAN-REV BUY ${buyCount}/4 | RSI:${rsi.toFixed(0)} BB:${bbPos.toFixed(2)} MACD:${macdTurningUp ? "↑" : "→"}`,
slMultiplier: 1.2, tpMultiplier: 2.4, rsi, atr, ema9: lastE9, ema21: lastE21, macd, bbPosition: bbPos, signalsAgreeing: buyCount
  }
  if (sellCount >= 3) {
    const conf = 0.55 + (sellCount - 3) * 0.1 + (rsi > 75 ? 0.1 : 0);
    return { action: "SELL", strategy: "MEAN_REVERT", confidence: Math.min(conf, 0.85),
      reason: `MEAN-REV SELL ${sellCount}/4 | RSI:${rsi.toFixed(0)} BB:${bbPos.toFixed(2)} MACD:${macdTurningDown ? "↓" : "→"}`,
      slMultiplier: 0.8, tpMultiplier: 1.5, rsi, atr, ema9: lastE9, ema21: lastE21, macd, bbPosition: bbPos, signalsAgreeing: sellCount };
  }

  return empty;
}

// ─── Strategy 3: Breakout ─────────────────────────────────────────────────────

export function breakoutSignal(m15: Candle[], h1: Candle[]): StrategySignal {
  const empty: StrategySignal = {
    action: "WAIT", strategy: "BREAKOUT", confidence: 0, reason: "No breakout signal",
    slMultiplier: 1.2, tpMultiplier: 2.5, rsi: 50, atr: 0, ema9: 0, ema21: 0, macd: 0, bbPosition: 0.5, signalsAgreeing: 0,
  };
  if (m15.length < 25) return empty;

  const m15c = m15.map(c => c.close);
  const lastClose = m15c[m15c.length - 1];
  const prevClose = m15c[m15c.length - 2];
  const atr = atrVal(m15, 14);
  const rsi = rsiVal(m15c, 14);
  const macd = macdHist(m15c);

  // N-period range breakout (20 bars, excluding last)
  const lookback = m15.slice(-21, -1);
  const rangeHigh = Math.max(...lookback.map(c => c.high));
  const rangeLow = Math.min(...lookback.map(c => c.low));
  const rangeSize = rangeHigh - rangeLow;

  // Volume surge
  const vols = m15.slice(-21).map(c => c.volume);
  const avgVol = vols.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
  const volSurge = vols[20] > avgVol * 1.5;

  // BB expansion
  const slice = m15c.slice(-20);
  const bbMean = slice.reduce((a, b) => a + b, 0) / 20;
  const bbSd = Math.sqrt(slice.reduce((a, b) => a + (b - bbMean) ** 2, 0) / 20);
  const bbPos = bbSd > 0 ? (lastClose - (bbMean - 2 * bbSd)) / (4 * bbSd) : 0.5;
  const bbExpanding = bbSd > 0 && rangeSize > 0 && (bbSd * 4) / bbMean > 0.003;

  const e9 = emaArr(m15c, 9), e21 = emaArr(m15c, 21);
  const lastE9 = e9[e9.length - 1], lastE21 = e21[e21.length - 1];

  // Bullish breakout
  if (lastClose > rangeHigh && prevClose <= rangeHigh) {
    const signals = [volSurge, bbExpanding, macd > 0, rsi > 50 && rsi < 70, lastE9 > lastE21];
    const count = signals.filter(Boolean).length;
    if (count >= 3) {
      const conf = 0.60 + count * 0.06;
      return { action: "BUY", strategy: "BREAKOUT", confidence: Math.min(conf, 0.90),
        reason: `BREAKOUT BUY ${count}/5 | Range:${rangeSize.toFixed(5)} Vol:${volSurge ? "✓" : "✗"} BB:${bbExpanding ? "✓" : "✗"}`,
        slMultiplier: 1.2, tpMultiplier: 2.5, rsi, atr, ema9: lastE9, ema21: lastE21, macd, bbPosition: bbPos, signalsAgreeing: count };
    }
  }

  // Bearish breakout
  if (lastClose < rangeLow && prevClose >= rangeLow) {
    const signals = [volSurge, bbExpanding, macd < 0, rsi < 50 && rsi > 30, lastE9 < lastE21];
    const count = signals.filter(Boolean).length;
    if (count >= 3) {
      const conf = 0.60 + count * 0.06;
      return { action: "SELL", strategy: "BREAKOUT", confidence: Math.min(conf, 0.90),
        reason: `BREAKOUT SELL ${count}/5 | Range:${rangeSize.toFixed(5)} Vol:${volSurge ? "✓" : "✗"} BB:${bbExpanding ? "✓" : "✗"}`,
        slMultiplier: 1.2, tpMultiplier: 2.5, rsi, atr, ema9: lastE9, ema21: lastE21, macd, bbPosition: bbPos, signalsAgreeing: count };
    }
  }

  return empty;
}

// ─── Master signal selector ───────────────────────────────────────────────────

export function selectStrategy(
  regime: RegimeAnalysis,
  m15: Candle[],
  h1: Candle[],
  params: { rsiLower: number; rsiUpper: number; minSignals: number },
  utcHour: number
): StrategySignal {
  switch (regime.regime) {
    case "TRENDING": {
      return trendFollowSignal(m15, h1, params);
    }
    case "RANGING": {
      // Mean reversion only — no trend trades in ranging market
      return meanReversionSignal(m15, h1);
    }
    case "BREAKOUT": {
      // Only trade breakouts during session opens
      const isSessionOpen = (utcHour >= 7 && utcHour <= 9) || (utcHour >= 13 && utcHour <= 15);
      if (!isSessionOpen) return { action: "WAIT", strategy: "NONE", confidence: 0, reason: "Breakout outside session open", slMultiplier: 1.5, tpMultiplier: 3.0, rsi: 50, atr: 0, ema9: 0, ema21: 0, macd: 0, bbPosition: 0.5, signalsAgreeing: 0 };
      const bo = breakoutSignal(m15, h1);
      if (bo.action !== "WAIT") return bo;
      // Fall back to trend if breakout signal not confirmed
      return trendFollowSignal(m15, h1, params);
    }
    case "VOLATILE":
    case "NEUTRAL":
    default:
      return { action: "WAIT", strategy: "NONE", confidence: 0, reason: `Regime: ${regime.regime} — no trade`, slMultiplier: 1.5, tpMultiplier: 3.0, rsi: 50, atr: 0, ema9: 0, ema21: 0, macd: 0, bbPosition: 0.5, signalsAgreeing: 0 };
  }
}

// ─── Correlation Guard ────────────────────────────────────────────────────────

export function checkCorrelationConflict(
  newInstrument: string,
  newDirection: "BUY" | "SELL",
  openTrades: { instrument: string; direction: "BUY" | "SELL" }[]
): { conflict: boolean; reason: string } {
  for (const group of CORRELATION_GROUPS) {
    if (!group.pairs.includes(newInstrument)) continue;
    for (const open of openTrades) {
      if (!group.pairs.includes(open.instrument)) continue;
      if (open.instrument === newInstrument) continue;
      // Same group, same direction = correlated exposure
      if (open.direction === newDirection) {
        return {
          conflict: true,
          reason: `Correlation conflict: ${newInstrument} ${newDirection} correlates with open ${open.instrument} ${open.direction}`,
        };
      }
    }
  }
  return { conflict: false, reason: "" };
}

// ─── Portfolio Heat ───────────────────────────────────────────────────────────
// Total risk = sum of (SL distance * units) for all open trades / equity

export function calcPortfolioHeat(
  openTrades: { entryPrice: number; stopLoss: number; units: number }[],
  equity: number
): number {
  if (equity <= 0) return 0;
  let totalRisk = 0;
  for (const t of openTrades) {
    if (t.stopLoss <= 0) continue;
    const slDist = Math.abs(t.entryPrice - t.stopLoss);
    // Approximate: risk in account currency ≈ slDist * units (for FX majors)
    totalRisk += slDist * t.units;
  }
  return (totalRisk / equity) * 100;
}

// ─── Walk-Forward Optimiser ───────────────────────────────────────────────────
// Mini-backtest on last 200 M15 candles, tests parameter variations

interface BacktestResult {
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  sharpe: number;
}

function miniBacktest(
  candles: Candle[],
  params: { rsiLower: number; rsiUpper: number; slMult: number; tpMult: number; minSignals: number }
): BacktestResult {
  const results: number[] = [];
  const windowSize = 40;

  for (let i = windowSize; i < candles.length - 5; i++) {
    const window = candles.slice(i - windowSize, i);
    const closes = window.map(c => c.close);
    const rsi = rsiVal(closes, 14);
    const atr = atrVal(window, 14);
    const macd = macdHist(closes);
    const e9 = emaArr(closes, 9), e21 = emaArr(closes, 21);
    const lastE9 = e9[e9.length - 1], lastE21 = e21[e21.length - 1];
    const lastClose = closes[closes.length - 1];

    const buySignals = [lastE9 > lastE21, rsi >= params.rsiLower && rsi <= params.rsiUpper, macd > 0, lastClose > lastE21].filter(Boolean).length;
    const sellSignals = [lastE9 < lastE21, rsi >= (100 - params.rsiUpper) && rsi <= (100 - params.rsiLower), macd < 0, lastClose < lastE21].filter(Boolean).length;

    const minSig = Math.min(params.minSignals, 4);
    let action: "BUY" | "SELL" | null = null;
    if (buySignals >= minSig) action = "BUY";
    else if (sellSignals >= minSig) action = "SELL";
    if (!action || atr === 0) continue;

    const entry = lastClose;
    const sl = action === "BUY" ? entry - atr * params.slMult : entry + atr * params.slMult;
    const tp = action === "BUY" ? entry + atr * params.tpMult : entry - atr * params.tpMult;

    // Simulate outcome on next 5 candles
    let pnl = -atr * params.slMult; // default: SL hit
    for (let j = i; j < Math.min(i + 5, candles.length); j++) {
      const fc = candles[j];
      if (action === "BUY") {
        if (fc.low <= sl) { pnl = -atr * params.slMult; break; }
        if (fc.high >= tp) { pnl = atr * params.tpMult; break; }
      } else {
        if (fc.high >= sl) { pnl = -atr * params.slMult; break; }
        if (fc.low <= tp) { pnl = atr * params.tpMult; break; }
      }
    }
    results.push(pnl);
  }

  if (results.length === 0) return { trades: 0, wins: 0, winRate: 0, totalPnl: 0, sharpe: 0 };
  const wins = results.filter(r => r > 0).length;
  const totalPnl = results.reduce((a, b) => a + b, 0);
  const mean = totalPnl / results.length;
  const sd = Math.sqrt(results.reduce((a, b) => a + (b - mean) ** 2, 0) / results.length);
  const sharpe = sd > 0 ? mean / sd : 0;
  return { trades: results.length, wins, winRate: wins / results.length, totalPnl, sharpe };
}

export function walkForwardOptimise(
  instrument: string,
  candles: Candle[],
  currentParams: { rsiLower: number; rsiUpper: number; slMult: number; tpMult: number; minSignals: number }
): WalkForwardResult {
  if (candles.length < 100) {
    return { instrument, ...currentParams, bestRsiLower: currentParams.rsiLower, bestRsiUpper: currentParams.rsiUpper,
      bestSlMult: currentParams.slMult, bestTpMult: currentParams.tpMult, sharpeRatio: 0, winRate: 0, totalTrades: 0, testedAt: Date.now() };
  }

  const variations = [
    { ...currentParams },
    { ...currentParams, rsiLower: currentParams.rsiLower - 3, rsiUpper: currentParams.rsiUpper + 3 },
    { ...currentParams, rsiLower: currentParams.rsiLower + 3, rsiUpper: currentParams.rsiUpper - 3 },
    { ...currentParams, slMult: currentParams.slMult * 0.9, tpMult: currentParams.tpMult * 0.9 },
    { ...currentParams, slMult: currentParams.slMult * 1.1, tpMult: currentParams.tpMult * 1.1 },
    { ...currentParams, slMult: currentParams.slMult, tpMult: currentParams.tpMult * 1.2 },
  ];

  let best = variations[0];
  let bestResult = miniBacktest(candles.slice(-200), variations[0]);

  for (const v of variations.slice(1)) {
    const r = miniBacktest(candles.slice(-200), v);
    if (r.sharpe > bestResult.sharpe && r.trades >= 5) {
      best = v;
      bestResult = r;
    }
  }

  return {
    instrument,
    bestRsiLower: best.rsiLower,
    bestRsiUpper: best.rsiUpper,
    bestSlMult: best.slMult,
    bestTpMult: best.tpMult,
    sharpeRatio: bestResult.sharpe,
    winRate: bestResult.winRate,
    totalTrades: bestResult.trades,
    testedAt: Date.now(),
  };
}

// ─── Liquidity Sweep Detector ─────────────────────────────────────────────────
/**
 * Detects stop hunts / liquidity sweeps:
 * A sweep occurs when price briefly breaks a recent swing high/low (taking out stops)
 * then immediately reverses. This is a high-probability SMC entry signal.
 *
 * Pattern: price wicks through N-bar high/low but CLOSES back inside the range.
 * After a sweep, smart money has filled their orders — price moves the other way.
 */
export interface LiquiditySweepResult {
  detected: boolean;
  type: "SWEEP_HIGH" | "SWEEP_LOW" | "NONE";
  sweepLevel: number;
  confidence: number;
  reason: string;
}

export function detectLiquiditySweep(candles: Candle[], lookback = 20): LiquiditySweepResult {
  const none: LiquiditySweepResult = { detected: false, type: "NONE", sweepLevel: 0, confidence: 0, reason: "No sweep" };
  if (candles.length < lookback + 3) return none;

  const recent = candles.slice(-lookback - 3);
  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];
  const range = recent.slice(0, -2); // the N-bar range before the last 2 candles

  const rangeHigh = Math.max(...range.map(c => c.high));
  const rangeLow = Math.min(...range.map(c => c.low));
  const atr = atrVal(recent, 14);

  // Sweep HIGH: prev candle wicked above rangeHigh but closed below it
  // AND last candle is bearish (close < open) — reversal confirmed
  const wickedAbove = prev.high > rangeHigh && prev.close < rangeHigh;
  const reversalBear = last.close < last.open && last.close < prev.close;
  if (wickedAbove && reversalBear) {
    // Wick size relative to ATR — bigger wick = stronger sweep
    const wickSize = prev.high - rangeHigh;
    const conf = Math.min(0.85, 0.55 + (wickSize / atr) * 0.15);
    return {
      detected: true,
      type: "SWEEP_HIGH",
      sweepLevel: rangeHigh,
      confidence: conf,
      reason: `🎯 Liquidity sweep HIGH at ${rangeHigh.toFixed(5)} | wick ${(wickSize * 10000).toFixed(1)}p | reversal confirmed`,
    };
  }

  // Sweep LOW: prev candle wicked below rangeLow but closed above it
  // AND last candle is bullish — reversal confirmed
  const wickedBelow = prev.low < rangeLow && prev.close > rangeLow;
  const reversalBull = last.close > last.open && last.close > prev.close;
  if (wickedBelow && reversalBull) {
    const wickSize = rangeLow - prev.low;
    const conf = Math.min(0.85, 0.55 + (wickSize / atr) * 0.15);
    return {
      detected: true,
      type: "SWEEP_LOW",
      sweepLevel: rangeLow,
      confidence: conf,
      reason: `🎯 Liquidity sweep LOW at ${rangeLow.toFixed(5)} | wick ${(wickSize * 10000).toFixed(1)}p | reversal confirmed`,
    };
  }

  return none;
}

// ─── Session-Strategy Mapper ──────────────────────────────────────────────────
/**
 * Different sessions have distinct characteristics:
 * - London open (07-09 UTC): High volatility, breakouts common
 * - London main (09-12 UTC): Trend continuation
 * - London/NY overlap (12-16 UTC): Highest volume, trends strongest
 * - NY main (16-20 UTC): Trend continuation, reversals at extremes
 * - Asian session (00-07 UTC): Range-bound, mean reversion works best
 * - Off-hours (20-00 UTC): Low liquidity, avoid trading
 */
export type SessionStrategy = "BREAKOUT_PREFERRED" | "TREND_PREFERRED" | "MEAN_REVERT_PREFERRED" | "AVOID";

export interface SessionContext {
  session: string;
  strategy: SessionStrategy;
  confidenceBoost: number;  // applied when strategy matches session
  confidencePenalty: number; // applied when strategy conflicts with session
  description: string;
}

export function getSessionContext(utcHour: number): SessionContext {
  if (utcHour >= 7 && utcHour < 9) {
    return { session: "London Open", strategy: "BREAKOUT_PREFERRED", confidenceBoost: 0.07, confidencePenalty: 0.05,
      description: "London open — breakouts and momentum moves dominate" };
  }
  if (utcHour >= 9 && utcHour < 12) {
    return { session: "London Main", strategy: "TREND_PREFERRED", confidenceBoost: 0.05, confidencePenalty: 0.03,
      description: "London main — trend continuation, strong directional moves" };
  }
  if (utcHour >= 12 && utcHour < 16) {
    return { session: "London/NY Overlap", strategy: "TREND_PREFERRED", confidenceBoost: 0.08, confidencePenalty: 0.04,
      description: "London/NY overlap — highest volume, best trend quality" };
  }
  if (utcHour >= 16 && utcHour < 20) {
    return { session: "NY Main", strategy: "TREND_PREFERRED", confidenceBoost: 0.04, confidencePenalty: 0.03,
      description: "NY main — trend continuation, watch for reversals late" };
  }
  if (utcHour >= 0 && utcHour < 7) {
    return { session: "Asian Session", strategy: "MEAN_REVERT_PREFERRED", confidenceBoost: 0.06, confidencePenalty: 0.05,
      description: "Asian session — range-bound, mean reversion setups preferred" };
  }
  // 20-24 UTC: off-hours
  return { session: "Off-Hours", strategy: "AVOID", confidenceBoost: 0, confidencePenalty: 0.12,
    description: "Low liquidity off-hours — avoid new positions" };
}

export function applySessionAdjustment(
  signal: StrategySignal,
  sessionCtx: SessionContext
): { adjustedConfidence: number; sessionNote: string } {
  const { strategy, confidenceBoost, confidencePenalty } = sessionCtx;

  // Avoid off-hours entirely
  if (strategy === "AVOID") {
    return { adjustedConfidence: signal.confidence - confidencePenalty, sessionNote: `⏰ Off-hours penalty -${(confidencePenalty*100).toFixed(0)}%` };
  }

  // Strategy matches session — boost
  const strategyMatchesSession =
    (strategy === "BREAKOUT_PREFERRED" && signal.strategy === "BREAKOUT") ||
    (strategy === "TREND_PREFERRED" && signal.strategy === "TREND_FOLLOW") ||
    (strategy === "MEAN_REVERT_PREFERRED" && signal.strategy === "MEAN_REVERT");

  // Strategy conflicts with session — penalty
  const strategyConflictsSession =
    (strategy === "BREAKOUT_PREFERRED" && signal.strategy === "MEAN_REVERT") ||
    (strategy === "MEAN_REVERT_PREFERRED" && signal.strategy === "BREAKOUT") ||
    (strategy === "MEAN_REVERT_PREFERRED" && signal.strategy === "TREND_FOLLOW");

  if (strategyMatchesSession) {
    return {
      adjustedConfidence: signal.confidence + confidenceBoost,
      sessionNote: `⏰ ${sessionCtx.session} boost +${(confidenceBoost*100).toFixed(0)}% (${signal.strategy} suits this session)`,
    };
  }
  if (strategyConflictsSession) {
    return {
      adjustedConfidence: signal.confidence - confidencePenalty,
      sessionNote: `⏰ ${sessionCtx.session} penalty -${(confidencePenalty*100).toFixed(0)}% (${signal.strategy} conflicts with session)`,
    };
  }
  return { adjustedConfidence: signal.confidence, sessionNote: `⏰ ${sessionCtx.session} — neutral` };
}
