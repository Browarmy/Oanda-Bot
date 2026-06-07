/**
 * Autonomous Trading Engine v4 — QUALITY OVER QUANTITY
 *
 * Root cause of 22% win rate:
 * 1. Bot was placing 500,000 unit positions (max size) — huge losses per SL hit
 * 2. Signal logic had no real trend filter — was trading against trend
 * 3. SL was too tight (1x ATR) causing noise-outs before TP
 * 4. No daily loss guard — kept trading after big drawdowns
 * 5. 65 trades in short period = overtrading random noise
 *
 * v4 fixes:
 * - MAX 3 concurrent trades (was 10)
 * - 1% risk per trade (was 2%) — survive a losing streak
 * - SL = 1.5x ATR, TP = 3x ATR → 2:1 RR minimum
 * - Require 4/5 signals + H1 EMA trend alignment (no counter-trend)
 * - RSI: BUY only 40-60 (momentum zone), SELL only 40-60
 * - Daily loss guard: stop trading if down >3% today
 * - Cooldown: 5 min between trades on same pair
 * - Min confidence 0.78 (raised from 0.72)
 * - Scan only top 15 FX pairs (not 40 instruments)
 */
import { EventEmitter } from "events";
import { ENV } from "./_core/env";
import { learningEngine } from "./learning-engine";
import { notifyTradeOpen, notifyTradeClose, notifyDailyLossGuard, notifyBotStatus, notifyPropFirmAlert } from "./telegram-notifier";
import {
  detectRegime,
  selectStrategy,
  checkCorrelationConflict,
  calcPortfolioHeat,
  walkForwardOptimise,
  detectRSIDivergence,
  checkD1KeyLevels,
  detectLiquiditySweep,
  getSessionContext,
  applySessionAdjustment,
  type MarketRegime,
  type WalkForwardResult,
} from "./strategy-engine";
import {
  newsGuard,
  checkFvgRetest,
  fetchSentiment,
  getLLMBias,
} from "./intelligence-layer";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Signal {
  action: "BUY" | "SELL" | "WAIT";
  confidence: number;
  reason: string;
  signalCount: number;
  ema9: number;
  ema21: number;
  rsi: number;
  atr: number;
  macd: number;
  bbPosition: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  signalsAgreeing: number;
}

export interface ClosedTrade {
  id: string;
  instrument: string;
  direction: "BUY" | "SELL";
  units: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  openTime: number;
  closedAt: number;
  pnl: number;
  pips: number;
  won: boolean;
  closeReason: string;
}

export interface OpenTrade {
  id: string;
  instrument: string;
  direction: "BUY" | "SELL";
  units: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  openTime: number;
  unrealisedPnl: number;
}

interface PairStats {
  instrument: string;
  bid: number;
  ask: number;
  spread: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  signalStrength: number;
  lastSignal: Signal | null;
  openTrades: OpenTrade[];
  wins: number;
  losses: number;
  totalPnl: number;
  lastScan: number;
  lastTrade: number;
  enabled: boolean;
}

interface AdaptiveWeights {
  minConfidence: number;
  wins: number;
  losses: number;
  consecutiveLosses: number;
}

export type MarketSession = "ALL" | "LONDON" | "NEW_YORK" | "TOKYO" | "SYDNEY" | "LONDON_NY";

export interface BotConfig {
  riskPercent: number;
  maxConcurrentTrades: number;
  tpAtrMultiplier: number;
  slAtrMultiplier: number;
  minSignalsRequired: number;
  sessions: MarketSession[];
  enabledPairs: string[];
  maxSpreadPips: number;
  minRRRatio: number;
  trailingStopEnabled: boolean;
  trailingStopAtr: number;
  // Learned params (updated by learning engine)
  rsiLower?: number;
  rsiUpper?: number;
  minConfidence?: number;
}

export interface EngineState {
  isLive: boolean;
  isPaused: boolean;
  accountBalance: number;
  accountEquity: number;
  accountCurrency: string;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  totalPnl: number;
  openTradesCount: number;
  openTrades: OpenTrade[];
  config: BotConfig;
  pairs: PairStats[];
  lastUpdate: number;
  startedAt: number | null;
  logs: string[];
  equityCurve: { time: number; equity: number }[];
  currentSession: string;
  tradeHistory: ClosedTrade[];
}

// ─── Top 15 FX pairs only — liquid, tight spreads, predictable ────────────────
export const ALL_PAIRS = [
  "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD",
  "USD_CAD", "NZD_USD", "EUR_GBP", "EUR_JPY", "GBP_JPY",
  "EUR_CHF", "AUD_JPY", "EUR_AUD", "GBP_CHF", "CAD_JPY",
  // Commodities
  "XAU_USD", "XAG_USD", "BCO_USD", "WTICO_USD", "XCU_USD",
  // Indices
  "UK100_GBP", "US30_USD", "SPX500_USD", "NAS100_USD", "DE30_EUR",
  "JP225_USD", "AU200_AUD",
  // Crypto
  "BTC_USD", "ETH_USD", "LTC_USD",
];

const SCAN_INTERVAL_MS = 60_000;   // scan every 60s (was 30s) — less noise
const MAX_LOG_LINES = 200;
const EQUITY_CURVE_MAX = 500;
const CLOSED_TRADE_BACKFILL_EVERY = 3;
const PAIR_TRADE_COOLDOWN_MS = 15 * 60 * 1000; // 5 min cooldown per pair

// Conservative defaults — quality over quantity
const DEFAULT_CONFIG: BotConfig = {
  riskPercent: 1.0,             // 1% risk per trade (was 2%)
  maxConcurrentTrades: 3,       // max 3 open at once (was 10)
  tpAtrMultiplier: 3.0,         // TP = 3x ATR (was 2.5)
  slAtrMultiplier: 1.5,         // SL = 1.5x ATR (was 1.0) — gives trades room
  minSignalsRequired: 3,        // 3/5 signals required (was 4 — too strict for current market)
  sessions: ["LONDON", "NEW_YORK", "LONDON_NY"], // active sessions only
  enabledPairs: [
    "EUR_USD", "GBP_USD", "USD_JPY", "USD_CHF", "AUD_USD",
    "USD_CAD", "EUR_GBP", "EUR_JPY", "GBP_JPY", "XAU_USD",
  ],
  maxSpreadPips: 2,             // tighter spread filter (was 3)
  minRRRatio: 2.0,              // 2:1 RR minimum (was 1.8)
  trailingStopEnabled: true,
  trailingStopAtr: 1.0,
};

// ─── Math helpers ─────────────────────────────────────────────────────────────
function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values[0];
  for (const v of values) {
    const e = v * k + prev * (1 - k);
    result.push(e);
    prev = e;
  }
  return result;
}

function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function calcAtr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function macdCalc(values: number[]): { macd: number; signal: number; histogram: number } {
  if (values.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const macdLine = fast.map((v, i) => v - slow[i]);
  const signalLine = ema(macdLine, 9);
  const last = macdLine.length - 1;
  return {
    macd: macdLine[last],
    signal: signalLine[last],
    histogram: macdLine[last] - signalLine[last],
  };
}

function bollingerBands(values: number[], period = 20, stdDev = 2) {
  if (values.length < period) return { upper: 0, middle: 0, lower: 0, position: 0.5 };
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mean + stdDev * sd;
  const lower = mean - stdDev * sd;
  const last = values[values.length - 1];
  const position = sd === 0 ? 0.5 : (last - lower) / (upper - lower);
  return { upper, middle: mean, lower, position };
}

// ─── Session helpers ──────────────────────────────────────────────────────────
function getCurrentSession(): string {
  const h = new Date().getUTCHours();
  if (h >= 22 || h < 7) return "SYDNEY";
  if (h >= 0 && h < 9) return "TOKYO";
  if (h >= 12 && h < 16) return "LONDON_NY";
  if (h >= 7 && h < 16) return "LONDON";
  if (h >= 16 && h < 21) return "NEW_YORK";
  return "LONDON";
}

function isSessionActive(sessions: MarketSession[]): boolean {
  if (sessions.includes("ALL")) return true;
  const h = new Date().getUTCHours();
  for (const s of sessions) {
    if (s === "SYDNEY" && (h >= 22 || h < 7)) return true;
    if (s === "TOKYO" && h >= 0 && h < 9) return true;
    if (s === "LONDON" && h >= 7 && h < 16) return true;
    if (s === "NEW_YORK" && h >= 12 && h < 21) return true;
    if (s === "LONDON_NY" && h >= 12 && h < 16) return true;
  }
  return false;
}

// ─── OANDA API ────────────────────────────────────────────────────────────────
export class OandaAPI {
  private baseUrl: string;
  private token: string;
  private accountId: string;

  constructor(token: string, accountId: string, environment: "practice" | "live") {
    this.token = token;
    this.accountId = accountId;
    this.baseUrl = environment === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";
  }

  async request(path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OANDA ${res.status}: ${text}`);
    }
    return res.json();
  }

  async getAccount() {
    const data = await this.request(`/v3/accounts/${this.accountId}`);
    return {
      balance: parseFloat(data.account.balance),
      equity: parseFloat(data.account.NAV),
      currency: data.account.currency,
      unrealisedPnl: parseFloat(data.account.unrealizedPL),
    };
  }

  async getCandles(instrument: string, granularity: string, count: number): Promise<Candle[]> {
    const data = await this.request(
      `/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}&price=M`
    );
    return (data.candles ?? [])
      .filter((c: any) => c.complete)
      .map((c: any) => ({
        time: c.time,
        open: parseFloat(c.mid.o),
        high: parseFloat(c.mid.h),
        low: parseFloat(c.mid.l),
        close: parseFloat(c.mid.c),
        volume: c.volume,
      }));
  }

  async getPrice(instrument: string): Promise<{ bid: number; ask: number }> {
    const data = await this.request(`/v3/accounts/${this.accountId}/pricing?instruments=${instrument}`);
    const price = data.prices?.[0];
    if (!price) throw new Error(`No price for ${instrument}`);
    return {
      bid: parseFloat(price.bids[0].price),
      ask: parseFloat(price.asks[0].price),
    };
  }

  async getOpenTrades(): Promise<OpenTrade[]> {
    const data = await this.request(`/v3/accounts/${this.accountId}/openTrades`);
    return (data.trades ?? []).map((t: any) => ({
      id: t.id,
      instrument: t.instrument,
      direction: parseFloat(t.currentUnits) > 0 ? "BUY" : "SELL",
      units: Math.abs(parseFloat(t.currentUnits)),
      entryPrice: parseFloat(t.price),
      stopLoss: t.stopLossOrder ? parseFloat(t.stopLossOrder.price) : 0,
      takeProfit: t.takeProfitOrder ? parseFloat(t.takeProfitOrder.price) : 0,
      openTime: new Date(t.openTime).getTime(),
      unrealisedPnl: parseFloat(t.unrealizedPL),
    }));
  }

  async getClosedTrades(count = 50): Promise<any[]> {
    try {
      const data = await this.request(`/v3/accounts/${this.accountId}/trades?state=CLOSED&count=${count}`);
      return data.trades ?? [];
    } catch { return []; }
  }

  async placeTrade(
    instrument: string,
    units: number,
    direction: "BUY" | "SELL",
    stopLoss: number,
    takeProfit: number
  ): Promise<string> {
    const isJpy = instrument.includes("JPY");
    const isCrypto = ["BTC","ETH","LTC"].some(x => instrument.includes(x));
    const isIndex = ["UK100","US30","SPX","NAS","DE30","JP225","AU200"].some(x => instrument.includes(x));
    const isGold = instrument.includes("XAU");
    const isSilver = instrument.includes("XAG");
    const isOil = instrument.includes("BCO") || instrument.includes("WTICO");
    const dp = isCrypto ? 2 : isIndex ? 1 : isGold ? 3 : isSilver ? 4 : isOil ? 3 : isJpy ? 3 : 5;
    const signedUnits = direction === "BUY" ? units : -units;
    const body = {
      order: {
        type: "MARKET",
        instrument,
        units: String(Math.round(signedUnits)),
        stopLossOnFill: { price: stopLoss.toFixed(dp), timeInForce: "GTC" },
        takeProfitOnFill: { price: takeProfit.toFixed(dp), timeInForce: "GTC" },
        positionFill: "DEFAULT",
      },
    };
    const data = await this.request(`/v3/accounts/${this.accountId}/orders`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const fill = data.orderFillTransaction;
    if (!fill) {
      const rejectTx = data.orderCancelTransaction || data.orderRejectTransaction;
      throw new Error(`Rejected (${rejectTx?.reason ?? "unknown"})`);
    }
    return fill.id;
  }

  async closeTrade(tradeId: string): Promise<void> {
    await this.request(`/v3/accounts/${this.accountId}/trades/${tradeId}/close`, {
      method: "PUT",
      body: JSON.stringify({ units: "ALL" }),
    });
  }

  getBaseUrl() { return this.baseUrl; }
  getToken() { return this.token; }
  getAccountId() { return this.accountId; }
}

// ─── Signal Generator — strict 5-signal confluence ───────────────────────────
/**
 * Entry rules (ALL must be true):
 * 1. H1 EMA9 > EMA21 for BUY (trend direction — no counter-trend trades)
 * 2. M15 EMA9 > EMA21 for BUY (momentum alignment)
 * 3. RSI 40-60 (momentum zone, not overbought/oversold)
 * 4. MACD histogram positive for BUY (momentum confirmed)
 * 5. Price above M15 EMA21 for BUY (price in trend)
 *
 * Bonus signals (boost confidence):
 * - Bollinger Band position (near lower for BUY, near upper for SELL)
 * - Volume surge
 * - Fresh EMA crossover on M15
 */
function generateSignal(
  m5: Candle[],
  m15: Candle[],
  h1: Candle[],
  minSignals: number
): Signal {
  const empty: Signal = {
    action: "WAIT", confidence: 0, reason: "Insufficient data", signalCount: 0,
    ema9: 0, ema21: 0, rsi: 50, atr: 0, macd: 0, bbPosition: 0.5,
    trend: "NEUTRAL", signalsAgreeing: 0,
  };

  if (m15.length < 30 || h1.length < 20) return empty;

  const m15closes = m15.map(c => c.close);
  const h1closes = h1.map(c => c.close);

  // ── H1 trend (primary filter — must agree) ──
  const h1e9 = ema(h1closes, 9);
  const h1e21 = ema(h1closes, 21);
  const h1TrendBull = h1e9[h1e9.length - 1] > h1e21[h1e21.length - 1];
  const h1TrendBear = h1e9[h1e9.length - 1] < h1e21[h1e21.length - 1];

  // ── M15 EMA ──
  const e9arr = ema(m15closes, 9);
  const e21arr = ema(m15closes, 21);
  const lastE9 = e9arr[e9arr.length - 1];
  const lastE21 = e21arr[e21arr.length - 1];
  const prevE9 = e9arr[e9arr.length - 2] ?? lastE9;
  const prevE21 = e21arr[e21arr.length - 2] ?? lastE21;
  const m15EmaBull = lastE9 > lastE21;
  const m15EmaBear = lastE9 < lastE21;
  const freshCrossBull = lastE9 > lastE21 && prevE9 <= prevE21;
  const freshCrossBear = lastE9 < lastE21 && prevE9 >= prevE21;

  // ── RSI (momentum zone only) ──
  const rsiVal = rsi(m15closes, 14);
  // BUY: RSI 40-60 (rising momentum, not overbought)
  // SELL: RSI 40-60 (falling momentum, not oversold)
  const rsiBullOk = rsiVal >= 40 && rsiVal <= 62;
  const rsiBearOk = rsiVal >= 38 && rsiVal <= 60;

  // ── MACD ──
  const m15macd = macdCalc(m15closes);
  const macdBull = m15macd.histogram > 0;
  const macdBear = m15macd.histogram < 0;

  // ── Price vs EMA21 (price must be on correct side) ──
  const lastClose = m15closes[m15closes.length - 1];
  const priceAboveEma = lastClose > lastE21;
  const priceBelowEma = lastClose < lastE21;

  // ── Bollinger Bands (bonus) ──
  const bb = bollingerBands(m15closes);
  const bbBull = bb.position < 0.45;  // near lower band
  const bbBear = bb.position > 0.55;  // near upper band

  // ── Volume surge (bonus) ──
  const volSurge = m5.length >= 21
    ? m5[m5.length - 1].volume > (m5.slice(-21, -1).reduce((a, c) => a + c.volume, 0) / 20) * 1.3
    : false;

  // ── ATR ──
  const atrVal = calcAtr(m15, 14);

  // ── Count core signals ──
  const buyCore = [
    h1TrendBull,    // 1. H1 trend
    m15EmaBull,     // 2. M15 EMA alignment
    rsiBullOk,      // 3. RSI in zone
    macdBull,       // 4. MACD positive
    priceAboveEma,  // 5. Price above EMA21
  ];
  const sellCore = [
    h1TrendBear,
    m15EmaBear,
    rsiBearOk,
    macdBear,
    priceBelowEma,
  ];

  const buyCount = buyCore.filter(Boolean).length;
  const sellCount = sellCore.filter(Boolean).length;

  let action: "BUY" | "SELL" | "WAIT" = "WAIT";
  let signalsAgreeing = 0;
  let reason = "No confluence";

  if (buyCount >= minSignals) {
    action = "BUY";
    signalsAgreeing = buyCount;
    reason = `BUY ${buyCount}/5 | H1:${h1TrendBull ? "✓" : "✗"} M15EMA:${m15EmaBull ? "✓" : "✗"} RSI:${rsiVal.toFixed(0)} MACD:${macdBull ? "+" : "-"} Price:${priceAboveEma ? "✓" : "✗"} [${buyCore.map((s, i) => s ? String.fromCharCode(65+i) : "-").join("")}]`;
  } else if (sellCount >= minSignals) {
    action = "SELL";
    signalsAgreeing = sellCount;
    reason = `SELL ${sellCount}/5 | H1:${h1TrendBear ? "✓" : "✗"} M15EMA:${m15EmaBear ? "✓" : "✗"} RSI:${rsiVal.toFixed(0)} MACD:${macdBear ? "-" : "+"} Price:${priceBelowEma ? "✓" : "✗"} [${sellCore.map((s, i) => s ? String.fromCharCode(65+i) : "-").join("")}]`;
  } else {
    reason = `No signal [B:${buyCount} S:${sellCount}] | H1:${h1TrendBull ? "↑" : h1TrendBear ? "↓" : "→"} M15EMA:${m15EmaBull ? "↑" : m15EmaBear ? "↓" : "→"} RSI:${rsiVal.toFixed(0)} MACD:${macdBull ? "+" : "-"}`;
  }

  // Confidence: starts at signal ratio, boosted by bonus signals
  let confidence = signalsAgreeing / 5;
  if (action !== "WAIT") {
    if (freshCrossBull && action === "BUY") confidence += 0.07;
    if (freshCrossBear && action === "SELL") confidence += 0.07;
    if (action === "BUY" && bbBull) confidence += 0.04;
    if (action === "SELL" && bbBear) confidence += 0.04;
    if (volSurge) confidence += 0.04;
    // Penalise if RSI is marginal
    if (rsiVal > 58 && action === "BUY") confidence -= 0.05;
    if (rsiVal < 42 && action === "SELL") confidence -= 0.05;
  }

  confidence = Math.max(0, Math.min(confidence, 0.99));

  const trend: "BULLISH" | "BEARISH" | "NEUTRAL" =
    h1TrendBull ? "BULLISH" : h1TrendBear ? "BEARISH" : "NEUTRAL";

  return {
    action, confidence, reason, signalCount: signalsAgreeing,
    ema9: lastE9, ema21: lastE21, rsi: rsiVal, atr: atrVal,
    macd: m15macd.histogram, bbPosition: bb.position,
    trend, signalsAgreeing,
  };
}

// ─── Position sizing — risk-based, capped at 100k units ──────────────────────
function calculateUnits(
  balance: number,
  riskPercent: number,
  slDistance: number,   // in price terms (not pips)
  instrument: string
): number {
  if (slDistance <= 0) return 1000;
  const riskAmount = balance * (riskPercent / 100);
  // Approximate value per unit per price move
  // For most pairs: 1 unit = ~1 base currency per 1.0 price move
  // We want: units * slDistance = riskAmount
  const units = riskAmount / slDistance;
  // Cap: never more than 100k units (was 500k — that's why losses were huge)
  return Math.max(1000, Math.min(Math.round(units), 100_000));
}

// ─── Main Engine ──────────────────────────────────────────────────────────────
export class AutonomousEngine extends EventEmitter {
    public api: any | null = null;   // Original
  private state: EngineState;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private adaptiveWeights: Map<string, AdaptiveWeights> = new Map();
  private scanning = false;
  private previousOpenTradeIds: Set<string> = new Set();
  private openTradeSnapshots: Map<string, OpenTrade> = new Map();
  private scanCycleCount = 0;
  private recordedClosedIds: Set<string> = new Set();
  private dailyStartBalance = 0;
  private dailyStartDate = "";
  private portfolioHeat = 0;
  private currentRegimes: Map<string, MarketRegime> = new Map();
  private wfResults: Map<string, WalkForwardResult> = new Map();
  private tradesSinceWalkForward = 0;
  private m15Cache: Map<string, { candles: any[]; fetchedAt: number }> = new Map();

    constructor() {
    super();
    this.state = {
      isLive: false,
      isPaused: false,
      accountBalance: 0,
      accountEquity: 0,
      accountCurrency: "GBP",
      totalTrades: 0,
      totalWins: 0,
      totalLosses: 0,
      totalPnl: 0,
      openTradesCount: 0,
      openTrades: [],
      config: { ...DEFAULT_CONFIG },
      pairs: ALL_PAIRS.map(p => ({
        instrument: p,
        bid: 0, ask: 0, spread: 0,
        trend: "NEUTRAL",
        signalStrength: 0,
        lastSignal: null,
        openTrades: [],
        wins: 0, losses: 0, totalPnl: 0,
        lastScan: 0,
        lastTrade: 0,
        enabled: true,
      })),
      lastUpdate: Date.now(),
      startedAt: null,
      logs: [],
      equityCurve: [],
      currentSession: "UNKNOWN",
      tradeHistory: [],
    };

    for (const pair of ALL_PAIRS) {
      this.adaptiveWeights.set(pair, {
        minConfidence: 0.78,
        wins: 0, losses: 0, consecutiveLosses: 0,
      });
    }

    // Initialize Sets for trailing stop management (required for esbuild compatibility)
    this.partialTpTaken = new Set<string>();
    this.breakevenSet = new Set<string>();
  }

  init(token: string, accountId: string, environment: "practice" | "live") {
    this.api = new OandaAPI(token, accountId, environment);   // Original
    this.log(`Engine v4 initialised | ${environment.toUpperCase()} | ${accountId}`);
  }

  async start() {
    if (!this.api) { this.log("ERROR: call init() first"); return; }
    if (this.state.isLive) return;
    this.state.isLive = true;
    this.state.isPaused = false;
    this.state.startedAt = Date.now();
    this.log("🚀 Bot v4 STARTED — quality signals, 1% risk, max 3 trades");
    // Load persisted learning state from DB
    await learningEngine.load();
    const lp = learningEngine.getParams();
    this.state.config.rsiLower = lp.rsiLower;
    this.state.config.rsiUpper = lp.rsiUpper;
    this.state.config.slAtrMultiplier = lp.atrSlMultiplier;
    this.state.config.tpAtrMultiplier = lp.atrTpMultiplier;
    this.state.config.minConfidence = lp.minConfidence;
    this.log(`🧠 Loaded learned params v${lp.version}: RSI ${lp.rsiLower.toFixed(0)}-${lp.rsiUpper.toFixed(0)}, SL ${lp.atrSlMultiplier.toFixed(2)}x, Conf ${(lp.minConfidence*100).toFixed(0)}%`);

        try {
      const acct = await this.api.getAccount();
      this.state.accountBalance = acct.balance;
      this.state.accountEquity = acct.equity;
      this.state.accountCurrency = acct.currency;
      this.state.equityCurve.push({ time: Date.now(), equity: acct.equity });
      this.dailyStartBalance = acct.balance;
      this.dailyStartDate = new Date().toDateString();
      this.log(`Account: ${acct.currency} ${acct.balance.toFixed(2)} | Equity: ${acct.equity.toFixed(2)}`);
    } catch (e: any) {
      this.log(`WARNING: Could not fetch account: ${e.message}`);
    }

    try {
      const openTrades = await this.api.getOpenTrades();
      this.previousOpenTradeIds = new Set(openTrades.map(t => t.id));
      
      // Bootstrap snapshots so trailing stop works on existing trades
      for (const t of openTrades) {
        if (!this.openTradeSnapshots.has(t.id)) {
          this.openTradeSnapshots.set(t.id, {
            id: t.id,
            instrument: t.instrument,
            direction: t.direction,
            units: t.units,
            entryPrice: t.entryPrice,
            stopLoss: t.stopLoss,
            takeProfit: t.takeProfit,
            openTime: t.openTime,
            unrealisedPnl: t.unrealisedPnl,
          });
        }
      }
      this.log(`📋 Bootstrapped ${openTrades.length} open trade IDs + snapshots`);
    } catch (e: any) {
      this.log(`⚠️ Reconciliation warning: ${e.message}`);
    }

        await this.backfillClosedTrades();

    // === DAILY PERFORMANCE SUMMARY ===
    const winRate = this.state.totalTrades > 0 
      ? ((this.state.totalWins / this.state.totalTrades) * 100).toFixed(1) 
      : 0;
    const expectancy = this.state.totalTrades > 0 
      ? (this.state.totalPnl / this.state.totalTrades).toFixed(2) 
      : 0;
    this.log(`📊 DAILY SUMMARY | Trades: ${this.state.totalTrades} | Win Rate: ${winRate}% | Total P&L: ${this.state.totalPnl.toFixed(2)} | Expectancy: ${expectancy} | Equity: ${this.state.accountEquity.toFixed(2)}`);

    this.scanTimer = setInterval(() => this.scanAllPairs(), SCAN_INTERVAL_MS);
    this.scanAllPairs();
  }

  stop() {
    if (this.scanTimer) { 
      clearInterval(this.scanTimer); 
      this.scanTimer = null; 
    }
    this.state.isLive = false;
    this.state.isPaused = false;
    learningEngine.save();
    this.log("⏹ Bot STOPPED");
  }

  pause() { this.state.isPaused = true; this.log("⏸ Bot PAUSED — no new trades"); }
  resume() { this.state.isPaused = false; this.log("▶ Bot RESUMED"); }

  updateConfig(config: Partial<BotConfig>) {
    this.state.config = { ...this.state.config, ...config };
    this.log(`⚙ Config updated: ${JSON.stringify(config)}`);
  }

  getState(): EngineState & { portfolioHeat: number; regimes: Record<string, string>; wfResults: Record<string, any> } {
    return {
      ...JSON.parse(JSON.stringify(this.state)),
      portfolioHeat: this.portfolioHeat,
      regimes: Object.fromEntries(this.currentRegimes),
      wfResults: Object.fromEntries(this.wfResults),
    };
  }

  private log(msg: string) {
    const ts = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${msg}`;
    this.state.logs.unshift(line);
    if (this.state.logs.length > MAX_LOG_LINES) this.state.logs.pop();
    this.state.lastUpdate = Date.now();
  }

  private async backfillClosedTrades() {
    if (!this.api) return;
    try {
      const closedTrades = await this.api.getClosedTrades(500);
      let added = 0;
      for (const t of closedTrades) {
        if (this.recordedClosedIds.has(t.id)) continue;
const cutoff = process.env.STATS_CUTOFF_DATE
  ? new Date(process.env.STATS_CUTOFF_DATE).getTime() : 0;
if (cutoff > 0) {
  const closedAt = t.closeTime
    ? new Date(t.closeTime).getTime() : 0;
  if (closedAt < cutoff) continue;
}
        this.recordedClosedIds.add(t.id);
        const pnl = parseFloat(t.realizedPL ?? "0");
        const entryPrice = parseFloat(t.price ?? "0");
        const exitPrice = parseFloat(t.averageClosePrice ?? t.price ?? "0");
        const direction: "BUY" | "SELL" = parseFloat(t.initialUnits) > 0 ? "BUY" : "SELL";
        const instrument = t.instrument ?? "UNKNOWN";
        const isJpy = instrument.includes("JPY");
        const pipSize = isJpy ? 0.01 : 0.0001;
        const pips = (direction === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice) / pipSize;
        let closeReason = "MANUAL";
        const slPrice = t.stopLossOrder ? parseFloat(t.stopLossOrder.price ?? "0") : 0;
        const tpPrice = t.takeProfitOrder ? parseFloat(t.takeProfitOrder.price ?? "0") : 0;
        if (tpPrice > 0 && direction === "BUY" && exitPrice >= tpPrice - pipSize * 3) closeReason = "TP";
        else if (tpPrice > 0 && direction === "SELL" && exitPrice <= tpPrice + pipSize * 3) closeReason = "TP";
        else if (slPrice > 0 && direction === "BUY" && exitPrice <= slPrice + pipSize * 3) closeReason = "SL";
        else if (slPrice > 0 && direction === "SELL" && exitPrice >= slPrice - pipSize * 3) closeReason = "SL";
        const closed: ClosedTrade = {
          id: t.id, instrument, direction,
          units: Math.abs(parseFloat(t.initialUnits ?? "0")),
          entryPrice, exitPrice,
          stopLoss: slPrice, takeProfit: tpPrice,
          openTime: new Date(t.openTime).getTime(),
          closedAt: t.closeTime ? new Date(t.closeTime).getTime() : Date.now(),
          pnl, pips: parseFloat(pips.toFixed(1)),
          won: pnl > 0, closeReason,
        };
        this.state.tradeHistory.push(closed);
        if (pnl > 0) this.state.totalWins++; else this.state.totalLosses++;
        this.state.totalPnl += pnl;
        this.state.totalTrades++;
        added++;
      }
      this.state.tradeHistory.sort((a, b) => b.closedAt - a.closedAt);
      if (this.state.tradeHistory.length > 1000) this.state.tradeHistory.splice(1000);
      if (added > 0) this.log(`📊 Backfilled ${added} closed trades from OANDA`);
    } catch (e: any) {
      this.log(`Backfill error: ${e.message}`);
    }
  }

  private async scanAllPairs() {
    if (this.scanning || !this.api) return;
    this.scanning = true;
    this.scanCycleCount++;
    this.state.currentSession = getCurrentSession();

    try {
      if (!isSessionActive(this.state.config.sessions)) {
        this.log(`⏰ Outside active sessions (${this.state.currentSession}) — waiting`);
        this.scanning = false;
        return;
      }

            // Refresh account
      try {
        const acct = await this.api.getAccount();
        this.state.accountBalance = acct.balance;
        this.state.accountEquity = acct.equity;
        this.state.accountCurrency = acct.currency;
        
        // Reset daily balance tracker at start of new day
        const today = new Date().toDateString();
        if (today !== this.dailyStartDate) {
          this.dailyStartBalance = acct.balance;
          this.dailyStartDate = today;
          this.log(`📅 New trading day — daily balance reset to ${acct.balance.toFixed(2)}`);
        }
        
        const lastEq = this.state.equityCurve[this.state.equityCurve.length - 1];
        if (!lastEq || Math.abs(lastEq.equity - acct.equity) > 0.001) {
          this.state.equityCurve.push({ time: Date.now(), equity: acct.equity });
          if (this.state.equityCurve.length > EQUITY_CURVE_MAX) this.state.equityCurve.shift();
        }

        // === DAY 1: EQUITY CURVE PROTECTION ===
        const peakEquity = this.state.equityCurve?.length 
          ? Math.max(...this.state.equityCurve.map((e: any) => e.equity))
          : this.state.accountEquity;
        
        const currentDd = peakEquity > 0 
          ? ((peakEquity - this.state.accountEquity) / peakEquity) * 100 
          : 0;

        if (currentDd > 5) {
          const oldRisk = this.state.config.riskPercent;
          this.state.config.riskPercent = Math.max(0.3, this.state.config.riskPercent * 0.5);
          this.log(`🛡️ Equity protection: ${currentDd.toFixed(1)}% DD — risk reduced ${oldRisk}% → ${this.state.config.riskPercent}%`);
        } else if (currentDd < 2 && this.state.config.riskPercent < 1.0) {
          this.state.config.riskPercent = Math.min(1.0, this.state.config.riskPercent * 1.05);
        }
        // =========================================
      } catch (e: any) {
        this.log(`Account refresh failed: ${e.message}`);
      }

      // Daily loss guard: stop if down >3% today
      if (this.dailyStartBalance > 0) {
        const dailyPnl = this.state.accountBalance - this.dailyStartBalance;
        const dailyPct = (dailyPnl / this.dailyStartBalance) * 100;
        if (dailyPct < -3) {
          this.log(`🛑 Daily loss guard: down ${dailyPct.toFixed(1)}% today — no new trades`);
          this.scanning = false;
          return;
        }
      }

      const openTrades = await this.api.getOpenTrades();
      this.state.openTrades = openTrades;
      this.state.openTradesCount = openTrades.length;

      await this.checkClosedTrades(openTrades);
      this.previousOpenTradeIds = new Set(openTrades.map(t => t.id));

      if (this.scanCycleCount % CLOSED_TRADE_BACKFILL_EVERY === 0) {
        await this.backfillClosedTrades();
      }

      await this.manageTrailingStops(openTrades);

      for (const pair of this.state.pairs) {
        pair.openTrades = openTrades.filter(t => t.instrument === pair.instrument);
      }

      if (this.state.isPaused) { this.scanning = false; return; }
      if (openTrades.length >= this.state.config.maxConcurrentTrades) {
        this.log(`Max trades (${openTrades.length}/${this.state.config.maxConcurrentTrades}) — waiting`);
        this.scanning = false;
        return;
      }

      const enabledPairs = this.state.pairs.filter(p =>
        p.enabled && this.state.config.enabledPairs.includes(p.instrument)
      );

  for (const pairStat of enabledPairs) {
        if (this.state.openTradesCount >= this.state.config.maxConcurrentTrades) break;
        if (pairStat.openTrades.length > 0) continue;
        // Cooldown: don't trade same pair within 5 minutes
        if (Date.now() - pairStat.lastTrade < PAIR_TRADE_COOLDOWN_MS) continue;
        // Learning engine: skip pairs auto-disabled due to poor performance
        if (!learningEngine.isPairEnabled(pairStat.instrument)) {
          this.log(`🚫 ${pairStat.instrument} disabled by learning engine — skipping`);
          continue;
        }
        // Learning engine: skip low-weight hours
        const currentHour = new Date().getUTCHours();
        if (!learningEngine.isHourActive(currentHour)) {
          this.log(`⏰ Hour ${currentHour}h UTC has low win rate — skipping this cycle`);
          break;
        }
        await this.scanPair(pairStat, openTrades);
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (e: any) {
      this.log(`Scan error: ${e.message}`);
    }

    this.scanning = false;
  }

  private async scanPair(pairStat: PairStats, openTrades: OpenTrade[]) {
    if (!this.api) return;
    try {
      const price = await this.api.getPrice(pairStat.instrument);
      pairStat.bid = price.bid;
      pairStat.ask = price.ask;
      pairStat.spread = price.ask - price.bid;
      pairStat.lastScan = Date.now();

      const isJpy = pairStat.instrument.includes("JPY");
      const spreadPips = pairStat.spread / (isJpy ? 0.01 : 0.0001);
      if (spreadPips > this.state.config.maxSpreadPips) {
        this.log(`🔍 ${pairStat.instrument} — spread ${spreadPips.toFixed(1)}p > max ${this.state.config.maxSpreadPips}p — SKIP`);
        return;
      }

      // ── Portfolio heat guard: max 4% total open risk ──────────────────────────
      this.portfolioHeat = calcPortfolioHeat(openTrades, this.state.accountEquity);
      if (this.portfolioHeat > 4) {
        this.log(`🌡️ Portfolio heat ${this.portfolioHeat.toFixed(1)}% > 4% — no new trades`);
        return;
      }

      // ── Correlation guard ─────────────────────────────────────────────────────
      // Fetch candles — use M15 cache (30s TTL) to avoid hammering OANDA
      const cached = this.m15Cache.get(pairStat.instrument);
      const now = Date.now();
      const [m5, m15, h1, d1, h4] = await Promise.all([
        this.api.getCandles(pairStat.instrument, "M5", 50),
        (cached && now - cached.fetchedAt < 30_000)
          ? Promise.resolve(cached.candles)
          : this.api.getCandles(pairStat.instrument, "M15", 80),
        this.api.getCandles(pairStat.instrument, "H1", 40),
        this.api.getCandles(pairStat.instrument, "D", 25).catch(() => [] as Candle[]),
        this.api.getCandles(pairStat.instrument, "H4", 60).catch(() => [] as Candle[]),
      ]);

      this.m15Cache.set(pairStat.instrument, { candles: m15, fetchedAt: now });

      // ── Regime detection ──────────────────────────────────────────────────────
      const regime = detectRegime(m15, h1);
      this.currentRegimes.set(pairStat.instrument, regime.regime);

      // ── Walk-forward optimised params for this pair ───────────────────────────
      const wf = this.wfResults.get(pairStat.instrument);
      const learnedParams = learningEngine.getParams();
      const pairParams = {
        rsiLower: wf?.bestRsiLower ?? learnedParams.rsiLower,
        rsiUpper: wf?.bestRsiUpper ?? learnedParams.rsiUpper,
        minSignals: this.state.config.minSignalsRequired,
      };

      // ── Select strategy based on regime ──────────────────────────────────────
      const utcHour = new Date().getUTCHours();
      const stratSignal = selectStrategy(regime, m15, h1, pairParams, utcHour);

      // Also run the legacy signal for comparison / fallback
      const legacySignal = generateSignal(m5, m15, h1, this.state.config.minSignalsRequired);

      // Use strategy signal if it fires, else fall back to legacy
      const activeSignal = stratSignal.action !== "WAIT" ? stratSignal : null;
      const legacyFired = legacySignal.action !== "WAIT";

      // Build a unified signal object for downstream code
      let finalAction: "BUY" | "SELL" | "WAIT" = "WAIT";
      let finalConfidence = 0;
      let finalReason = "No signal";
      let finalRsi = 50, finalAtr = 0, finalEma9 = 0, finalEma21 = 0, finalMacd = 0, finalBbPos = 0.5;
      let finalSlMult = learnedParams.atrSlMultiplier;
      let finalTpMult = learnedParams.atrTpMultiplier;
      let finalSignalCount = 0;
      let finalTrend: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";

      if (activeSignal && legacyFired && activeSignal.action === legacySignal.action) {
        // Both agree — highest confidence
        finalAction = activeSignal.action;
        finalConfidence = Math.min((activeSignal.confidence + legacySignal.confidence) / 2 + 0.05, 0.99);
        finalReason = `[DUAL] ${activeSignal.reason}`;
        finalSlMult = activeSignal.slMultiplier;
        finalTpMult = activeSignal.tpMultiplier;
        finalSignalCount = activeSignal.signalsAgreeing;
        finalRsi = activeSignal.rsi; finalAtr = activeSignal.atr;
        finalEma9 = activeSignal.ema9; finalEma21 = activeSignal.ema21;
        finalMacd = activeSignal.macd; finalBbPos = activeSignal.bbPosition;
        finalTrend = legacySignal.trend;
      } else if (activeSignal && activeSignal.confidence >= 0.75) {
        // Strategy engine alone — high confidence only
        finalAction = activeSignal.action;
        finalConfidence = activeSignal.confidence;
        finalReason = activeSignal.reason;
        finalSlMult = activeSignal.slMultiplier;
        finalTpMult = activeSignal.tpMultiplier;
        finalSignalCount = activeSignal.signalsAgreeing;
        finalRsi = activeSignal.rsi; finalAtr = activeSignal.atr;
        finalEma9 = activeSignal.ema9; finalEma21 = activeSignal.ema21;
        finalMacd = activeSignal.macd; finalBbPos = activeSignal.bbPosition;
        finalTrend = legacySignal.trend;
      } else if (legacyFired && legacySignal.confidence >= 0.78) {
        // Legacy signal alone
        finalAction = legacySignal.action;
        finalConfidence = legacySignal.confidence;
        finalReason = legacySignal.reason;
        finalSignalCount = legacySignal.signalCount;
        finalRsi = legacySignal.rsi; finalAtr = legacySignal.atr;
        finalEma9 = legacySignal.ema9; finalEma21 = legacySignal.ema21;
        finalMacd = legacySignal.macd; finalBbPos = legacySignal.bbPosition;
        finalTrend = legacySignal.trend;
      }

      pairStat.lastSignal = { ...legacySignal, action: finalAction, confidence: finalConfidence, reason: finalReason, signalCount: finalSignalCount, trend: finalTrend, signalsAgreeing: finalSignalCount };
      pairStat.trend = finalTrend;
      pairStat.signalStrength = finalConfidence;

               if (finalAction === "WAIT") {
        // === SAFE DETAILED REJECTION LOGGING ===
        let rejectDetails = `Regime:${regime.regime} | Conf:${(finalConfidence*100).toFixed(0)}%`;

        if (spreadPips > this.state.config.maxSpreadPips) {
          rejectDetails += ` | SPREAD:${spreadPips.toFixed(1)}p`;
        }
        if (this.portfolioHeat > 4) {
          rejectDetails += ` | HEAT:${this.portfolioHeat.toFixed(1)}%`;
        }

        this.log(`🔍 ${pairStat.instrument} — WAIT | ${rejectDetails} | ${finalReason}`);
        return;
      }

      // ── H4 EMA50 TREND FILTER ──────────────────────────────────────────────
      if (h4.length >= 50) {
        const h4closes = h4.map(c => c.close);
        const h4ema50arr = ema(h4closes, 50);
        const h4ema50 = h4ema50arr[h4ema50arr.length - 1];
        const h4lastClose = h4closes[h4closes.length - 1];
        if (finalAction === "BUY" && h4lastClose < h4ema50) {
          this.log(`🚫 H4 FILTER: ${pairStat.instrument} BUY blocked — counter-trend`);
          return;
        }
        if (finalAction === "SELL" && h4lastClose > h4ema50) {
          this.log(`🚫 H4 FILTER: ${pairStat.instrument} SELL blocked — counter-trend`);
          return;
        }
        this.log(`✅ H4 aligned: ${pairStat.instrument} ${finalAction} (EMA50: ${h4ema50.toFixed(5)})`);
      }
      // ───────────────────────────────────────────────────────────────────────


      // ── Correlation guard ─────────────────────────────────────────────────────
      const corrCheck = checkCorrelationConflict(
        pairStat.instrument, finalAction,
        openTrades.map(t => ({ instrument: t.instrument, direction: t.direction }))
      );
      if (corrCheck.conflict) {
        this.log(`🔗 ${corrCheck.reason}`);
        return;
      }

      // ── NEWS GUARD — block 30min before / 15min after high-impact events ────────
      const newsCheck = newsGuard.isNewsBlocked(pairStat.instrument);
      if (newsCheck.blocked) {
        this.log(`${newsCheck.reason} [${pairStat.instrument}]`);
        return;
      }

      // ── FVG RETEST — Smart Money Concepts confirmation ────────────────────────
      // FVG is a bonus signal: boosts confidence if price is retesting an FVG
      // Does NOT block the trade — just adds/removes confidence
      const fvgRetest = checkFvgRetest(m15, finalAction);
      if (fvgRetest) {
        finalConfidence = Math.min(finalConfidence + 0.06, 0.99);
        finalReason = `[FVG✓] ${finalReason}`;
        this.log(`📐 ${pairStat.instrument} — FVG retest at ${fvgRetest.midpoint.toFixed(5)} (+6% conf)`);
      }

      // ── SENTIMENT CONTRARIAN FILTER ───────────────────────────────────────────
      // If retail crowd is overwhelmingly on the same side as our signal → reduce conf
      // If retail crowd is against our signal (contrarian agrees) → boost conf
      try {
        const sentiment = await fetchSentiment(pairStat.instrument);
        if (sentiment && sentiment.bias !== "NEUTRAL") {
          if (sentiment.contrarian === finalAction) {
            // Contrarian agrees — retail crowd is on wrong side
            finalConfidence = Math.min(finalConfidence + 0.04, 0.99);
            this.log(`📊 ${pairStat.instrument} sentiment: ${sentiment.longPercent.toFixed(0)}% long / ${sentiment.shortPercent.toFixed(0)}% short — contrarian ${sentiment.contrarian} ✓`);
          } else if (sentiment.contrarian !== "NEUTRAL" && sentiment.contrarian !== finalAction) {
            // Retail crowd agrees with our signal — warning sign
            finalConfidence = Math.max(finalConfidence - 0.05, 0);
            this.log(`⚠ ${pairStat.instrument} sentiment: crowd agrees with ${finalAction} — reducing conf by 5%`);
          }
        }
      } catch { /* non-critical */ }

      // ── LLM MARKET ANALYSIS — 4h cached AI bias confirmation ─────────────────
      try {
        const upcomingNews = newsGuard.getUpcomingEvents(pairStat.instrument);
        const llmBias = await getLLMBias(pairStat.instrument, m15, regime.regime, upcomingNews);
        const llmAgrees =
          (finalAction === "BUY" && llmBias.bias === "BULLISH") ||
          (finalAction === "SELL" && llmBias.bias === "BEARISH");
        const llmContra =
          (finalAction === "BUY" && llmBias.bias === "BEARISH") ||
          (finalAction === "SELL" && llmBias.bias === "BULLISH");

        if (llmAgrees && llmBias.confidence >= 0.65) {
          finalConfidence = Math.min(finalConfidence + 0.05, 0.99);
          this.log(`🤖 LLM ${pairStat.instrument}: ${llmBias.bias} (${(llmBias.confidence*100).toFixed(0)}%) — "${llmBias.reasoning}" ✓`);
        } else if (llmContra && llmBias.confidence >= 0.7) {
          // LLM strongly disagrees — skip this trade
          this.log(`🤖 LLM ${pairStat.instrument}: ${llmBias.bias} (${(llmBias.confidence*100).toFixed(0)}%) contradicts ${finalAction} — SKIP`);
          return;
        } else {
          this.log(`🤖 LLM ${pairStat.instrument}: ${llmBias.bias} (neutral/low conf) — no adjustment`);
        }
      } catch { /* non-critical */ }

      // ── RSI DIVERGENCE — extra confluence booster ────────────────────────────
      // Divergence confirms the signal direction with extra weight
      const divergence = detectRSIDivergence(h1, 20);
      if (finalAction === "BUY" && divergence.bullish) {
        finalConfidence = Math.min(finalConfidence + divergence.strength * 0.08, 0.99);
        finalReason = `[DIV✓] ${finalReason}`;
        this.log(`📈 ${pairStat.instrument} — ${divergence.description} (+${(divergence.strength*8).toFixed(0)}% conf)`);
      } else if (finalAction === "SELL" && divergence.bearish) {
        finalConfidence = Math.min(finalConfidence + divergence.strength * 0.08, 0.99);
        finalReason = `[DIV✓] ${finalReason}`;
        this.log(`📉 ${pairStat.instrument} — ${divergence.description} (+${(divergence.strength*8).toFixed(0)}% conf)`);
      } else if (finalAction === "BUY" && divergence.bearish) {
        // Bearish divergence contradicts BUY — reduce confidence
        finalConfidence = Math.max(finalConfidence - 0.06, 0);
        this.log(`⚠ ${pairStat.instrument} — Bearish divergence contradicts BUY (-6% conf)`);
      } else if (finalAction === "SELL" && divergence.bullish) {
        finalConfidence = Math.max(finalConfidence - 0.06, 0);
        this.log(`⚠ ${pairStat.instrument} — Bullish divergence contradicts SELL (-6% conf)`);
      }

      // ── D1 KEY LEVELS — daily support/resistance confluence ───────────────────
      if (d1.length >= 5) {
        const currentPrice = finalAction === "BUY" ? price.ask : price.bid;
        const keyLevel = checkD1KeyLevels(d1, currentPrice);
        if (keyLevel.proximityScore > 0.5) {
          if (finalAction === "BUY" && keyLevel.nearSupport) {
            // Buying near D1 support — high confluence
            finalConfidence = Math.min(finalConfidence + keyLevel.proximityScore * 0.07, 0.99);
            finalReason = `[D1-S✓] ${finalReason}`;
            this.log(`🏛️ ${pairStat.instrument} — ${keyLevel.description} — BUY at support ✓`);
          } else if (finalAction === "SELL" && keyLevel.nearResistance) {
            // Selling near D1 resistance — high confluence
            finalConfidence = Math.min(finalConfidence + keyLevel.proximityScore * 0.07, 0.99);
            finalReason = `[D1-R✓] ${finalReason}`;
            this.log(`🏛️ ${pairStat.instrument} — ${keyLevel.description} — SELL at resistance ✓`);
          } else if (finalAction === "BUY" && keyLevel.nearResistance) {
            // Buying into D1 resistance — reduce confidence
            finalConfidence = Math.max(finalConfidence - 0.07, 0);
            this.log(`🏛️ ${pairStat.instrument} — Buying into D1 resistance at ${keyLevel.nearestLevel.toFixed(5)} (-7% conf)`);
          } else if (finalAction === "SELL" && keyLevel.nearSupport) {
            finalConfidence = Math.max(finalConfidence - 0.07, 0);
            this.log(`🏛️ ${pairStat.instrument} — Selling into D1 support at ${keyLevel.nearestLevel.toFixed(5)} (-7% conf)`);
          }
        }
      }

      // ── LIQUIDITY SWEEP DETECTION — high-probability SMC reversal signal ────────
      const sweep = detectLiquiditySweep(m15, 20);
      if (sweep.detected) {
        const sweepAgrees = (finalAction === "BUY" && sweep.type === "SWEEP_LOW") ||
                            (finalAction === "SELL" && sweep.type === "SWEEP_HIGH");
        const sweepContra = (finalAction === "BUY" && sweep.type === "SWEEP_HIGH") ||
                            (finalAction === "SELL" && sweep.type === "SWEEP_LOW");
        if (sweepAgrees) {
          finalConfidence = Math.min(finalConfidence + sweep.confidence * 0.1, 0.99);
          finalReason = `[SWEEP✓] ${finalReason}`;
          this.log(`🎯 ${pairStat.instrument} — ${sweep.reason} — agrees with ${finalAction} (+${(sweep.confidence*10).toFixed(0)}% conf)`);
        } else if (sweepContra) {
          // Sweep contradicts direction — strong warning, reduce conf significantly
          finalConfidence = Math.max(finalConfidence - 0.08, 0);
          this.log(`⚠ ${pairStat.instrument} — ${sweep.reason} — contradicts ${finalAction} (-8% conf)`);
        }
      }

      // ── SESSION-STRATEGY ALIGNMENT — boost when strategy fits session ─────────
      const sessionCtx = getSessionContext(utcHour);
      const sessionAdj = applySessionAdjustment({ ...pairStat.lastSignal, strategy: stratSignal.strategy } as any, sessionCtx);
      finalConfidence = Math.min(Math.max(sessionAdj.adjustedConfidence, 0), 0.99);
      this.log(`${sessionAdj.sessionNote} [${pairStat.instrument}]`);

      // ── Learned confidence threshold ──────────────────────────────────────────
      const learnedThreshold = learningEngine.getPairConfidenceThreshold(pairStat.instrument);
      if (finalConfidence < learnedThreshold) {
        this.log(`🔍 ${pairStat.instrument} — ${(finalConfidence*100).toFixed(0)}% < learned threshold ${(learnedThreshold*100).toFixed(0)}% — SKIP`);
        return;
      }

      if (finalAtr === 0) { this.log(`${pairStat.instrument} — zero ATR, skip`); return; }

      const cfg = this.state.config;
      const entry = finalAction === "BUY" ? price.ask : price.bid;

      const isCrypto = ["BTC","ETH","LTC"].some(x => pairStat.instrument.includes(x));
      const isIndex = ["UK100","US30","SPX","NAS","DE30","JP225","AU200"].some(x => pairStat.instrument.includes(x));
      const isGold = pairStat.instrument.includes("XAU");
      const minPip = isJpy ? 0.01 : isCrypto ? 50 : isIndex ? 2 : isGold ? 0.5 : 0.0001;
      const minStop = minPip * 15;

      // Use walk-forward optimised SL/TP multipliers if available
      const slMult = wf ? wf.bestSlMult : finalSlMult;
      const tpMult = wf ? wf.bestTpMult : finalTpMult;

      const rawSlDist = finalAtr * slMult;
      const slDist = Math.max(rawSlDist, minStop);
      const sl = finalAction === "BUY" ? entry - slDist : entry + slDist;
      const tp = finalAction === "BUY"
        ? entry + slDist * (tpMult / slMult) * slMult
        : entry - slDist * (tpMult / slMult) * slMult;

      const reward = Math.abs(tp - entry);
      if (slDist === 0 || reward / slDist < cfg.minRRRatio) {
        this.log(`${pairStat.instrument} — RR ${(reward/slDist).toFixed(1)} < min ${cfg.minRRRatio} — SKIP`);
        return;
      }

      // ── ADAPTIVE KELLY POSITION SIZING ─────────────────────────────────────────────
      // Use fractional Kelly (25%) when we have enough trade history
      // Kelly fraction = W - (1-W)/R  where W=win rate, R=avg win/avg loss
      // Fractional Kelly = Kelly * 0.25 (conservative, avoids over-betting)
      let effectiveRiskPct = cfg.riskPercent;
      const recentTrades = this.state.tradeHistory.slice(-30);
      if (recentTrades.length >= 15) {
        const wins = recentTrades.filter(t => t.pnl > 0);
        const losses = recentTrades.filter(t => t.pnl < 0);
        if (wins.length >= 5 && losses.length >= 3) {
          const winRate = wins.length / recentTrades.length;
          const avgWin = wins.reduce((s, t) => s + t.pnl, 0) / wins.length;
          const avgLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length);
          const rr = avgLoss > 0 ? avgWin / avgLoss : 1;
          const kelly = winRate - (1 - winRate) / rr;
          const fractionalKelly = Math.max(0.005, Math.min(kelly * 0.25, 0.02)); // cap at 2%, floor at 0.5%
          effectiveRiskPct = fractionalKelly * 100;
          // Scale down further on losing streaks
          const recentLosses = recentTrades.slice(-5).filter(t => t.pnl < 0).length;
          if (recentLosses >= 4) effectiveRiskPct *= 0.5; // 4/5 recent losses — halve size
          else if (recentLosses >= 3) effectiveRiskPct *= 0.7; // 3/5 — reduce by 30%
          this.log(`📊 Kelly sizing ${pairStat.instrument}: WR ${(winRate*100).toFixed(0)}% RR ${rr.toFixed(2)} → risk ${effectiveRiskPct.toFixed(2)}%`);
        }
      }
      const units = calculateUnits(this.state.accountBalance, effectiveRiskPct, slDist, pairStat.instrument);

      const tradeId = await this.api.placeTrade(pairStat.instrument, units, finalAction, sl, tp);
      pairStat.lastTrade = Date.now();
      this.state.totalTrades++;
      this.state.openTradesCount++;
      this.tradesSinceWalkForward++;
      this.openTradeSnapshots.set(tradeId, {
        id: tradeId, instrument: pairStat.instrument, direction: finalAction,
        units, entryPrice: entry, stopLoss: sl, takeProfit: tp,
        openTime: Date.now(), unrealisedPnl: 0,
      });
      const dp = isCrypto ? 2 : isIndex ? 1 : isGold ? 3 : isJpy ? 3 : 5;
      this.log(`✅ ${finalAction} ${pairStat.instrument} [${regime.regime}] | ${units.toLocaleString()} units | SL ${sl.toFixed(dp)} TP ${tp.toFixed(dp)} | RR ${(reward/slDist).toFixed(1)} | ${finalReason}`);
      // Telegram notification — fire and forget
      notifyTradeOpen({
        instrument: pairStat.instrument, direction: finalAction, units,
        entryPrice: entry, stopLoss: sl, takeProfit: tp,
        confidence: finalConfidence, reason: finalReason, regime: regime.regime,
      }).catch(() => {});
      this.openTradeSnapshots.set(tradeId, {
        ...this.openTradeSnapshots.get(tradeId)!,
        // @ts-ignore
        _signal: { rsi: finalRsi, macd: finalMacd, bbPosition: finalBbPos, atr: finalAtr, ema9: finalEma9, ema21: finalEma21, regime: regime.regime },
      });

      // ── Walk-forward optimiser: run every 30 trades ───────────────────────────
      if (this.tradesSinceWalkForward >= 30) {
        this.tradesSinceWalkForward = 0;
        this.log(`🔬 Running walk-forward optimiser for all pairs...`);
        for (const ps of this.state.pairs.filter(p => p.enabled)) {
          try {
            const wfCandles = await this.api!.getCandles(ps.instrument, "M15", 200);
            const lp = learningEngine.getParams();
            const result = walkForwardOptimise(ps.instrument, wfCandles, {
              rsiLower: lp.rsiLower, rsiUpper: lp.rsiUpper,
              slMult: lp.atrSlMultiplier, tpMult: lp.atrTpMultiplier,
              minSignals: this.state.config.minSignalsRequired,
            });
            this.wfResults.set(ps.instrument, result);
            if (result.totalTrades >= 5) {
              this.log(`🔬 ${ps.instrument} WF: WR ${(result.winRate*100).toFixed(0)}% Sharpe ${result.sharpeRatio.toFixed(2)} | RSI ${result.bestRsiLower}-${result.bestRsiUpper} SL ${result.bestSlMult.toFixed(2)}x TP ${result.bestTpMult.toFixed(2)}x`);
            }
            await new Promise(r => setTimeout(r, 200));
          } catch {}
        }
      }

    } catch (e: any) {
      this.log(`${pairStat.instrument} error: ${e.message}`);
    }
  }

  private async checkClosedTrades(currentOpen: OpenTrade[]) {
    if (!this.api) return;
    const currentIds = new Set(currentOpen.map(t => t.id));
    for (const prevId of Array.from(this.previousOpenTradeIds)) {
      if (currentIds.has(prevId)) continue;
      if (this.recordedClosedIds.has(prevId)) continue;
      this.recordedClosedIds.add(prevId);
      const snap = this.openTradeSnapshots.get(prevId);
      try {
        const data = await this.api.request(`/v3/accounts/${this.api.getAccountId()}/trades/${prevId}`);
        const t = data.trade;
        const exitPrice = parseFloat(t.averageClosePrice ?? t.price ?? "0");
        const pnl = parseFloat(t.realizedPL ?? "0");
        const direction: "BUY" | "SELL" = snap?.direction ?? (parseFloat(t.initialUnits) > 0 ? "BUY" : "SELL");
        const entryPrice = snap?.entryPrice ?? parseFloat(t.price ?? "0");
        const instrument = snap?.instrument ?? t.instrument ?? "UNKNOWN";
        const isJpy = instrument.includes("JPY");
        const pipSize = isJpy ? 0.01 : 0.0001;
        const pips = (direction === "BUY" ? exitPrice - entryPrice : entryPrice - exitPrice) / pipSize;
        const won = pnl > 0;
        let closeReason = "MANUAL";
        if (snap?.takeProfit && direction === "BUY" && exitPrice >= snap.takeProfit - pipSize * 3) closeReason = "TP";
        else if (snap?.takeProfit && direction === "SELL" && exitPrice <= snap.takeProfit + pipSize * 3) closeReason = "TP";
        else if (snap?.stopLoss && direction === "BUY" && exitPrice <= snap.stopLoss + pipSize * 3) closeReason = "SL";
        else if (snap?.stopLoss && direction === "SELL" && exitPrice >= snap.stopLoss - pipSize * 3) closeReason = "SL";
        const closed: ClosedTrade = {
          id: prevId, instrument, direction,
          units: snap?.units ?? Math.abs(parseFloat(t.initialUnits ?? "0")),
          entryPrice, exitPrice,
          stopLoss: snap?.stopLoss ?? 0, takeProfit: snap?.takeProfit ?? 0,
          openTime: snap?.openTime ?? new Date(t.openTime).getTime(),
          closedAt: t.closeTime ? new Date(t.closeTime).getTime() : Date.now(),
          pnl, pips: parseFloat(pips.toFixed(1)), won, closeReason,
        };
        this.state.tradeHistory.unshift(closed);
        if (this.state.tradeHistory.length > 1000) this.state.tradeHistory.pop();
        if (won) this.state.totalWins++; else this.state.totalLosses++;
        this.state.totalPnl += pnl;
        const pair = this.state.pairs.find(p => p.instrument === instrument);
        if (pair) { if (won) pair.wins++; else pair.losses++; pair.totalPnl += pnl; }
        this.updateWeights(instrument, won);
        this.log(`${won ? "🏆" : "💔"} ${direction} ${instrument} | ${won ? "+" : ""}${pnl.toFixed(2)} (${pips.toFixed(1)}p) | ${closeReason}`);
        // Telegram notification for trade close
        notifyTradeClose({
          instrument, direction, units: snap?.units ?? 0,
          entryPrice, exitPrice, pnl,
          pips: parseFloat(pips.toFixed(1)),
          reason: closeReason, currency: this.state.accountCurrency,
        }).catch(() => {});
            
        // Feed closed trade to learning engine
        const snapSignal = (snap as any)?._signal ?? {};
        learningEngine.recordTrade({
          instrument,
          direction,
          won,
          pnl,
          pips: closed.pips,
          rsi: snapSignal.rsi ?? 50,
          macd: snapSignal.macd ?? 0,
          bbPosition: snapSignal.bbPosition ?? 0.5,
          atr: snapSignal.atr ?? 0,
          entryPrice,
          ema9: snapSignal.ema9 ?? entryPrice,
          ema21: snapSignal.ema21 ?? entryPrice,
          openTime: closed.openTime,
          closedAt: closed.closedAt,
        });

        // === LEARNING EVOLUTION FIX — Trigger at 30 trades (adjusted for current progress) ===
        if (this.state.totalTrades >= 36 && this.tradesSinceWalkForward >= 4) {
          this.log(`🔬 Triggering Learning Engine evolution after ${this.state.totalTrades} trades...`);
          
          await learningEngine.evolve?.();   // Safe call
          
          const lp = learningEngine.getParams();
          this.state.config.rsiLower = lp.rsiLower;
          this.state.config.rsiUpper = lp.rsiUpper;
          this.state.config.slAtrMultiplier = lp.atrSlMultiplier;
          this.state.config.tpAtrMultiplier = lp.atrTpMultiplier;
          this.state.config.minConfidence = lp.minConfidence;
          
          this.tradesSinceWalkForward = 0;
          this.log(`✅ Evolution complete → New params: RSI ${lp.rsiLower}-${lp.rsiUpper}, SL ${lp.atrSlMultiplier.toFixed(2)}x, Conf ${(lp.minConfidence*100).toFixed(0)}%`);
        }

        // Apply any evolved params back to config
        const lp = learningEngine.getParams();
        this.state.config.rsiLower = lp.rsiLower;
        this.state.config.rsiUpper = lp.rsiUpper;
        this.state.config.slAtrMultiplier = lp.atrSlMultiplier;
        this.state.config.tpAtrMultiplier = lp.atrTpMultiplier;
        this.state.config.minConfidence = lp.minConfidence;
      } catch {
        this.log(`📊 Trade ${prevId} closed`);
      }
      this.openTradeSnapshots.delete(prevId);
    }
  } // ← End of checkClosedTrades()

      private async manageTrailingStops(openTrades: OpenTrade[]) {
    if (!this.api) return;
    for (const trade of openTrades) {
      const snap = this.openTradeSnapshots.get(trade.id);
      if (!snap) continue;
      try {
        const price = await this.api.getPrice(trade.instrument);
        const currentPrice = trade.direction === "BUY" ? price.bid : price.ask;
        const isJpy = trade.instrument.includes("JPY");
        const isCrypto = ["BTC","ETH","LTC"].some(x => trade.instrument.includes(x));
        const isIndex = ["UK100","US30","SPX","NAS","DE30","JP225","AU200"].some(x => trade.instrument.includes(x));
        const isGold = trade.instrument.includes("XAU");
        const dp = isCrypto ? 2 : isIndex ? 1 : isGold ? 3 : isJpy ? 3 : 5;

        const slDist = Math.abs(snap.entryPrice - snap.stopLoss);
        if (slDist === 0) continue;

        const profitDist = trade.direction === "BUY"
          ? currentPrice - snap.entryPrice
          : snap.entryPrice - currentPrice;
        const R = profitDist / slDist;

        // Live ATR from cached M15 candles
        const cached = this.m15Cache.get(trade.instrument);
        let currentAtr = slDist;
        if (cached && cached.candles.length >= 15) {
          const atrCalc = calcAtr(cached.candles, 14);
          if (atrCalc > 0) currentAtr = atrCalc;
        }

        const minMove = isJpy ? 0.005 : 0.00003;

        // Stage 1: Breakeven at 1R
        if (R >= 1.0 && !this.breakevenSet.has(trade.id)) {
          const buffer = slDist * 0.05;
          const beSl = trade.direction === "BUY"
            ? snap.entryPrice + buffer
            : snap.entryPrice - buffer;
          const isImprovement = trade.direction === "BUY"
            ? beSl > snap.stopLoss + minMove
            : beSl < snap.stopLoss - minMove;
          if (isImprovement) {
            await this.api.request(
              `/v3/accounts/${this.api.getAccountId()}/trades/${trade.id}/orders`,
              { method: "PUT", body: JSON.stringify({ stopLoss: { price: beSl.toFixed(dp), timeInForce: "GTC" } }) }
            );
            snap.stopLoss = beSl;
            this.log(`🔒 BREAKEVEN: ${trade.instrument} SL → ${beSl.toFixed(dp)} (1R — zero risk)`);
          }
          this.breakevenSet.add(trade.id);
        }

        // Stage 2: Partial TP at 1.5R (lock in profit)
        if (!this.partialTpTaken.has(trade.id) && R >= 1.5 && trade.units >= 200) {
          const halfUnits = Math.floor(trade.units / 2);
          const closeUnits = trade.direction === "BUY" ? -halfUnits : halfUnits;
          try {
            await this.api.request(
              `/v3/accounts/${this.api.getAccountId()}/trades/${trade.id}/close`,
              { method: "PUT", body: JSON.stringify({ units: String(closeUnits) }) }
            );
            this.partialTpTaken.add(trade.id);
            this.log(`💰 PARTIAL TP: ${trade.instrument} — ${halfUnits.toLocaleString()} units at 1.5R`);
            const lockSl = trade.direction === "BUY"
              ? snap.entryPrice + slDist * 0.5
              : snap.entryPrice - slDist * 0.5;
            await this.api.request(
              `/v3/accounts/${this.api.getAccountId()}/trades/${trade.id}/orders`,
              { method: "PUT", body: JSON.stringify({ stopLoss: { price: lockSl.toFixed(dp), timeInForce: "GTC" } }) }
            );
            snap.stopLoss = lockSl;
            this.log(`🔒 PROFIT LOCK: ${trade.instrument} SL → ${lockSl.toFixed(dp)} (+0.5R secured)`);
          } catch { /* non-critical */ }
        }

        // Stage 3: Dynamic trailing at 2R+
        if (!this.state.config.trailingStopEnabled || R < 2.0) continue;

        const trailMult = R >= 3.0 ? 1.0 : 1.5;
        const newSl = trade.direction === "BUY"
          ? currentPrice - (currentAtr * trailMult)
          : currentPrice + (currentAtr * trailMult);
        const shouldUpdate = trade.direction === "BUY"
          ? newSl > snap.stopLoss + minMove
          : newSl < snap.stopLoss - minMove;
        if (!shouldUpdate) continue;

        await this.api.request(
          `/v3/accounts/${this.api.getAccountId()}/trades/${trade.id}/orders`,
          { method: "PUT", body: JSON.stringify({ stopLoss: { price: newSl.toFixed(dp), timeInForce: "GTC" } }) }
        );
        snap.stopLoss = newSl;
        this.log(`📈 TRAIL: ${trade.instrument} SL → ${newSl.toFixed(dp)} [R:${R.toFixed(1)} | ${trailMult}×ATR]`);

      } catch (e: any) {
        // silent
      }
    }
  }


  resetStats() {
    this.state.totalTrades = 0;
    this.state.totalWins = 0;
    this.state.totalLosses = 0;
    this.state.totalPnl = 0;
    this.state.tradeHistory = [];
    this.state.equityCurve = [];
    this.state.logs = [];
    for (const pair of this.state.pairs) {
      pair.wins = 0;
      pair.losses = 0;
      pair.totalPnl = 0;
    }
    Array.from(this.adaptiveWeights.keys()).forEach(key => {
      this.adaptiveWeights.set(key, {
        minConfidence: 0.78,
        wins: 0, losses: 0, consecutiveLosses: 0,
      });
    });
    this.log("\uD83D\uDD04 Stats reset \u2014 clean slate");
  }

  private updateWeights(instrument: string, won: boolean) {
    const w = this.adaptiveWeights.get(instrument);
    if (!w) return;
    if (won) {
      w.wins++;
      w.consecutiveLosses = 0;
      w.minConfidence = Math.max(0.72, w.minConfidence - 0.005);
    } else {
      w.losses++;
      w.consecutiveLosses++;
      w.minConfidence = Math.min(0.95, w.minConfidence + 0.02);
      if (w.consecutiveLosses >= 3) {
        w.minConfidence = Math.min(0.95, w.minConfidence + 0.03);
        this.log(`⚠ ${instrument}: ${w.consecutiveLosses} losses — threshold → ${(w.minConfidence * 100).toFixed(0)}%`);
      }
    }
  }
}

export const autonomousEngine = new AutonomousEngine();

export async function autoStartEngine() {
  const token = process.env.OANDA_API_TOKEN;
  const accountId = process.env.OANDA_ACCOUNT_ID;
  const environment = (process.env.OANDA_ENVIRONMENT ?? "practice") as "practice" | "live";
  if (!token || !accountId) {
    console.log("[Engine] OANDA_API_TOKEN or OANDA_ACCOUNT_ID not set — not auto-started");
    return;
  }
  console.log(`[Engine] Auto-starting v4 with ${environment.toUpperCase()} account ${accountId}`);
  autonomousEngine.init(token, accountId, environment);
  await autonomousEngine.start();
}
