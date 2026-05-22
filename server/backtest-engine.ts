/**
 * Backtest Engine
 *
 * Runs the live signal logic (regime detection + strategy selection) against
 * historical OANDA candles and returns a full trade list + equity curve.
 *
 * This lets you see exactly what the bot would have done on any pair over
 * any recent period — without risking real money.
 */

import type { Candle } from "./autonomous-engine";
import { detectRegime, trendFollowSignal, meanReversionSignal, breakoutSignal } from "./strategy-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BacktestTrade {
  index: number;          // candle index entry was taken
  direction: "BUY" | "SELL";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  exitPrice: number;
  exitIndex: number;
  pnl: number;            // in price units (multiply by units for currency)
  pips: number;
  outcome: "WIN" | "LOSS" | "OPEN";
  reason: string;
  regime: string;
  strategy: string;
  confidence: number;
}

export interface BacktestResult {
  instrument: string;
  granularity: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  totalPips: number;
  maxDrawdown: number;       // as fraction of starting equity (e.g. 0.05 = 5%)
  sharpeRatio: number;
  avgWinPips: number;
  avgLossPips: number;
  expectancy: number;        // avg pips per trade
  trades: BacktestTrade[];
  equityCurve: { index: number; equity: number }[];
  testedAt: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emaArr(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    result.push(prices[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function rsiVal(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const d = prices[i] - prices[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function atrVal(candles: Candle[], period = 14): number {
  if (candles.length < period) return 0;
  const trs = candles.slice(-period).map((c, i, arr) => {
    if (i === 0) return c.high - c.low;
    const prev = arr[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  });
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function macdHist(prices: number[]): number {
  if (prices.length < 26) return 0;
  const ema12 = emaArr(prices, 12);
  const ema26 = emaArr(prices, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signal = emaArr(macdLine, 9);
  return macdLine[macdLine.length - 1] - signal[signal.length - 1];
}

// ─── Core backtest function ───────────────────────────────────────────────────

export function runBacktest(
  instrument: string,
  granularity: string,
  candles: Candle[],
  options: {
    rsiLower?: number;
    rsiUpper?: number;
    slMultiplier?: number;
    tpMultiplier?: number;
    minSignals?: number;
    startingEquity?: number;
    riskPercent?: number;
  } = {}
): BacktestResult {
  const {
    rsiLower = 40,
    rsiUpper = 62,
    slMultiplier = 1.5,
    tpMultiplier = 3.0,
    minSignals = 4,
    startingEquity = 10000,
    riskPercent = 1,
  } = options;

  const isJpy = instrument.includes("JPY");
  const pipFactor = isJpy ? 100 : 10000;

  const trades: BacktestTrade[] = [];
  const equityCurve: { index: number; equity: number }[] = [{ index: 0, equity: startingEquity }];
  let equity = startingEquity;
  let peakEquity = startingEquity;
  let maxDrawdown = 0;
  let inTrade = false;
  let currentTrade: Partial<BacktestTrade> | null = null;
  let lastTradeExit = -5; // cooldown: don't enter within 5 candles of last exit

  // Need at least 80 candles for indicators to warm up
  const warmup = 80;

  for (let i = warmup; i < candles.length - 1; i++) {
    const slice = candles.slice(Math.max(0, i - 79), i + 1);
    const closes = slice.map(c => c.close);
    const lastClose = closes[closes.length - 1];

    // ── Manage open trade ──
    if (inTrade && currentTrade) {
      const c = candles[i];
      const dir = currentTrade.direction!;
      const sl = currentTrade.stopLoss!;
      const tp = currentTrade.takeProfit!;

      let exited = false;
      let exitPrice = lastClose;
      let outcome: "WIN" | "LOSS" = "WIN";

      if (dir === "BUY") {
        if (c.low <= sl) { exitPrice = sl; outcome = "LOSS"; exited = true; }
        else if (c.high >= tp) { exitPrice = tp; outcome = "WIN"; exited = true; }
      } else {
        if (c.high >= sl) { exitPrice = sl; outcome = "LOSS"; exited = true; }
        else if (c.low <= tp) { exitPrice = tp; outcome = "WIN"; exited = true; }
      }

      // Max hold: 20 candles
      if (!exited && i - (currentTrade.index ?? i) >= 20) {
        exitPrice = lastClose;
        outcome = exitPrice > (currentTrade.entryPrice ?? 0) === (dir === "BUY") ? "WIN" : "LOSS";
        exited = true;
      }

      if (exited) {
        const rawPnl = dir === "BUY"
          ? exitPrice - currentTrade.entryPrice!
          : currentTrade.entryPrice! - exitPrice;
        const pips = rawPnl * pipFactor;
        // Risk-based P&L: risk 1% of equity per trade
        const riskAmount = equity * (riskPercent / 100);
        const slDist = Math.abs(currentTrade.entryPrice! - sl);
        const pnlCurrency = slDist > 0 ? (rawPnl / slDist) * riskAmount : 0;

        const trade: BacktestTrade = {
          ...currentTrade as BacktestTrade,
          exitPrice,
          exitIndex: i,
          pnl: pnlCurrency,
          pips,
          outcome,
        };
        trades.push(trade);
        equity += pnlCurrency;
        if (equity > peakEquity) peakEquity = equity;
        const dd = (peakEquity - equity) / peakEquity;
        if (dd > maxDrawdown) maxDrawdown = dd;
        equityCurve.push({ index: i, equity });
        inTrade = false;
        currentTrade = null;
        lastTradeExit = i;
      }
      continue;
    }

    // ── Signal generation ──
    if (i - lastTradeExit < 5) continue; // cooldown

    const closes2 = slice.map(c => c.close);
    const rsi = rsiVal(closes2, 14);
    const atr = atrVal(slice, 14);
    if (atr === 0) continue;

    const ema9arr = emaArr(closes2, 9);
    const ema21arr = emaArr(closes2, 21);
    const ema50arr = emaArr(closes2, 50);
    const e9 = ema9arr[ema9arr.length - 1];
    const e21 = ema21arr[ema21arr.length - 1];
    const e50 = ema50arr[ema50arr.length - 1];
    const macd = macdHist(closes2);

    // H1 trend: use every 12th candle as proxy (M5 * 12 = H1)
    const h1closes = closes2.filter((_, idx) => idx % 12 === 0);
    const h1ema21 = emaArr(h1closes, 21);
    const h1trend = h1ema21.length > 1
      ? (h1ema21[h1ema21.length - 1] > h1ema21[h1ema21.length - 2] ? "BULLISH" : "BEARISH")
      : "NEUTRAL";

    // Regime detection (simplified for backtest)
    const adxProxy = Math.abs(e9 - e21) / atr; // proxy for ADX
    const regime = adxProxy > 0.5 ? "TRENDING" : adxProxy < 0.2 ? "RANGING" : "NEUTRAL";

    // Signal logic
    const buySignals = [
      e9 > e21,
      rsi >= rsiLower && rsi <= rsiUpper,
      macd > 0,
      lastClose > e21,
      h1trend === "BULLISH",
    ];
    const sellSignals = [
      e9 < e21,
      rsi >= (100 - rsiUpper) && rsi <= (100 - rsiLower),
      macd < 0,
      lastClose < e21,
      h1trend === "BEARISH",
    ];

    const buyCount = buySignals.filter(Boolean).length;
    const sellCount = sellSignals.filter(Boolean).length;

    let direction: "BUY" | "SELL" | null = null;
    let sigCount = 0;
    if (buyCount >= minSignals) { direction = "BUY"; sigCount = buyCount; }
    else if (sellCount >= minSignals) { direction = "SELL"; sigCount = sellCount; }
    if (!direction) continue;

    const entry = lastClose;
    const slDist = Math.max(atr * slMultiplier, isJpy ? 0.01 * 15 : 0.0001 * 15);
    const tpDist = slDist * (tpMultiplier / slMultiplier);
    const sl = direction === "BUY" ? entry - slDist : entry + slDist;
    const tp = direction === "BUY" ? entry + tpDist : entry - tpDist;
    const confidence = 0.5 + (sigCount - minSignals) * 0.1;

    inTrade = true;
    currentTrade = {
      index: i,
      direction,
      entryPrice: entry,
      stopLoss: sl,
      takeProfit: tp,
      reason: `${sigCount}/5 signals | RSI:${rsi.toFixed(0)} | ${regime}`,
      regime,
      strategy: regime === "RANGING" ? "MEAN_REVERT" : "TREND_FOLLOW",
      confidence,
    };
  }

  // ── Compute stats ──
  const wins = trades.filter(t => t.outcome === "WIN");
  const losses = trades.filter(t => t.outcome === "LOSS");
  const totalPips = trades.reduce((s, t) => s + t.pips, 0);
  const winPips = wins.reduce((s, t) => s + t.pips, 0);
  const lossPips = losses.reduce((s, t) => s + Math.abs(t.pips), 0);
  const profitFactor = lossPips > 0 ? winPips / lossPips : winPips > 0 ? 99 : 0;
  const avgWinPips = wins.length > 0 ? winPips / wins.length : 0;
  const avgLossPips = losses.length > 0 ? lossPips / losses.length : 0;
  const expectancy = trades.length > 0 ? totalPips / trades.length : 0;

  // Sharpe: mean pnl / std pnl
  const pnls = trades.map(t => t.pnl);
  const meanPnl = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
  const stdPnl = pnls.length > 1
    ? Math.sqrt(pnls.reduce((a, b) => a + (b - meanPnl) ** 2, 0) / pnls.length)
    : 1;
  const sharpeRatio = stdPnl > 0 ? meanPnl / stdPnl : 0;

  return {
    instrument,
    granularity,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    profitFactor,
    totalPips,
    maxDrawdown,
    sharpeRatio,
    avgWinPips,
    avgLossPips,
    expectancy,
    trades,
    equityCurve,
    testedAt: Date.now(),
  };
}
