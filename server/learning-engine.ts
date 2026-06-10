/**
 * Self-Learning Engine v1
 *
 * The bot learns from every closed trade and evolves its own parameters.
 * All learning state is persisted to the database so it survives restarts.
 *
 * What it learns:
 * 1. PAIR SCORING — win rate per pair → auto-disable losers, promote winners
 * 2. SESSION SCORING — which UTC hours produce wins → shift weight to best hours
 * 3. SIGNAL PARAMETER EVOLUTION — RSI range, ATR multiplier, confidence threshold
 *    drift toward values that correlate with winning trades
 * 4. PATTERN MEMORY — stores indicator snapshot at entry; finds winning combos
 * 5. CONFIDENCE CALIBRATION — per-pair threshold adjusts faster based on streaks
 *
 * Learning algorithm: Exponential Moving Average of win/loss outcomes.
 * No neural nets needed — simple Bayesian-style weight updates are faster to
 * converge on small datasets (100-500 trades) than deep learning.
 */

import { getDb } from "./db";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PairLearning {
  instrument: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;         // 0-1
  avgPnl: number;
  avgWinPips: number;
  avgLossPips: number;
  profitFactor: number;
  score: number;           // composite score 0-1
  enabled: boolean;        // auto-disabled if score < threshold
  bestSession: string;
  bestDirection: "BUY" | "SELL" | "BOTH";
  confidenceThreshold: number;  // learned minimum confidence for this pair
  consecutiveLosses: number;
  lastUpdated: number;
}

export interface SessionLearning {
  hour: number;            // 0-23 UTC
  trades: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  weight: number;          // 0-1, how much to favour this hour
  lastUpdated: number;
}

export interface SignalParams {
  rsiLower: number;        // BUY zone lower bound (default 40)
  rsiUpper: number;        // BUY zone upper bound (default 62)
  rsiSellLower: number;    // SELL zone lower bound (default 38)
  rsiSellUpper: number;    // SELL zone upper bound (default 60)
  atrSlMultiplier: number; // SL = ATR * this (default 1.5)
  atrTpMultiplier: number; // TP = ATR * this (default 3.0)
  minSignals: number;      // 3-5
  minConfidence: number;   // 0.72-0.95
  maxSpreadPips: number;
  riskPercent: number;
  version: number;         // increments on each evolution
  lastEvolved: number;
}

export interface TradePattern {
  rsi: number;
  macd: number;
  bbPosition: number;
  atrNorm: number;
  emaSpread: number;
  hour: number;
  won: boolean;
  pnl: number;
  strategy?: string;
  regime?: string;
  instrument?: string;
  confidence?: number;
  confidenceBucket?: string;
}

export interface StrategyLearning {
  strategy: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  score: number;
  enabled: boolean;
  lastUpdated: number;
}

export interface ConfidenceBucketLearning {
  bucket: string;
  minConfidence: number;
  maxConfidence: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  calibratedScore: number;
  lastUpdated: number;
}

export interface LearningState {
  pairs: Record<string, PairLearning>;
  sessions: SessionLearning[];
  strategies: Record<string, StrategyLearning>;
  confidenceBuckets: Record<string, ConfidenceBucketLearning>;
  params: SignalParams;
  patterns: TradePattern[];
  totalEvolutions: number;
  lastEvolution: number;
  insights: string[];
}

// ─── Default state ────────────────────────────────────────────────────────────

const DEFAULT_PARAMS: SignalParams = {
  rsiLower: 40,
  rsiUpper: 62,
  rsiSellLower: 38,
  rsiSellUpper: 60,
  atrSlMultiplier: 1.5,
  atrTpMultiplier: 3.0,
  minSignals: 4,
  minConfidence: 0.78,
  maxSpreadPips: 2.0,
  riskPercent: 1.0,
  version: 1,
  lastEvolved: Date.now(),
};

function defaultPairLearning(instrument: string): PairLearning {
  return {
    instrument,
    trades: 0, wins: 0, losses: 0,
    winRate: 0.5, avgPnl: 0, avgWinPips: 0, avgLossPips: 0,
    profitFactor: 1.0, score: 0.5,
    enabled: true,
    bestSession: "LONDON",
    bestDirection: "BOTH",
    confidenceThreshold: 0.78,
    consecutiveLosses: 0,
    lastUpdated: Date.now(),
  };
}

function defaultSessionLearning(hour: number): SessionLearning {
  // Pre-weight London (7-16) and NY (12-21) hours higher
  const londonNy = (hour >= 7 && hour < 21);
  return {
    hour, trades: 0, wins: 0, winRate: 0.5,
    avgPnl: 0,
    weight: londonNy ? 0.7 : 0.3,
    lastUpdated: Date.now(),
  };
}

function defaultStrategyLearning(strategy: string): StrategyLearning {
  return {
    strategy,
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: 0.5,
    avgPnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    profitFactor: 1.0,
    score: 0.5,
    enabled: true,
    lastUpdated: Date.now(),
  };
}

function getConfidenceBucketName(confidence: number): string {
  const pct = Math.max(0, Math.min(99, Math.floor(confidence * 100)));
  const bucketStart = Math.floor(pct / 10) * 10;
  const bucketEnd = bucketStart + 10;
  return `${bucketStart}-${bucketEnd}`;
}

function defaultConfidenceBucket(bucket: string): ConfidenceBucketLearning {
  const [minRaw, maxRaw] = bucket.split("-").map(Number);

  return {
    bucket,
    minConfidence: minRaw / 100,
    maxConfidence: maxRaw / 100,
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: 0.5,
    avgPnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    profitFactor: 1.0,
    calibratedScore: 0.5,
    lastUpdated: Date.now(),
  };
}

function computeConfidenceCalibrationScore(
  bucket: ConfidenceBucketLearning
): number {
  if (bucket.trades < 5) return 0.5;

  const expectedMidpoint =
    (bucket.minConfidence + bucket.maxConfidence) / 2;

  const accuracyGap =
    Math.abs(bucket.winRate - expectedMidpoint);

  const reliabilityScore =
    Math.max(0, 1 - accuracyGap * 2);

  const pfScore =
    Math.min(bucket.profitFactor / 2.5, 1);

  const pnlScore =
    bucket.avgPnl > 0 ? 0.75 : 0.25;

  return Math.max(
    0,
    Math.min(
      1,
      reliabilityScore * 0.45 +
      pfScore * 0.35 +
      pnlScore * 0.20
    )
  );
}

function computeStrategyScore(strategy: StrategyLearning): number {
  if (strategy.trades < 5) return 0.5;

  const wrScore = strategy.winRate;
  const pfScore = Math.min(strategy.profitFactor / 2.5, 1);
  const pnlScore = strategy.avgPnl > 0 ? 0.75 : 0.25;

  return Math.max(
    0,
    Math.min(
      1,
      wrScore * 0.45 + pfScore * 0.35 + pnlScore * 0.20
    )
  );
}

// ─── Learning Engine ──────────────────────────────────────────────────────────

export class LearningEngine {
  private state: LearningState;
  private dirty = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly EVOLUTION_MIN_TRADES = 20;  // evolve params after N new learned trades
  private lastEvolutionTradeCount = 0;
  private readonly PAIR_DISABLE_THRESHOLD = 0.35;  // disable pair if win rate < 35%
  private readonly PAIR_ENABLE_THRESHOLD = 0.45;   // re-enable if win rate recovers to 45%
  private readonly MAX_PATTERNS = 500;

  constructor() {
this.state = {
  pairs: {},
  sessions: Array.from({ length: 24 }, (_, h) => defaultSessionLearning(h)),
  strategies: {},
  confidenceBuckets: {},
  params: { ...DEFAULT_PARAMS },
  patterns: [],
  totalEvolutions: 0,
  lastEvolution: Date.now(),
  insights: [],
};

  // ── Persistence ──────────────────────────────────────────────────────────────

  async load() {
    try {
      const db = await getDb();
      if (!db) { console.log("[Learning] DB not available — starting fresh"); return; }
      const rows = await db.execute(sql`SELECT \`key\`, \`value\` FROM bot_learning_state`);
      const data = (rows[0] as unknown) as any[];
      for (const row of data) {
        try {
          const parsed = JSON.parse(row.value);
          if (row.key === "pairs") this.state.pairs = parsed;
if (row.key === "sessions") this.state.sessions = parsed;
if (row.key === "strategies") this.state.strategies = parsed;
if (row.key === "confidenceBuckets") this.state.confidenceBuckets = parsed;
if (row.key === "params") this.state.params = { ...DEFAULT_PARAMS, ...parsed };
          if (row.key === "patterns") this.state.patterns = parsed;
 if (row.key === "meta") {
  this.state.totalEvolutions = parsed.totalEvolutions ?? 0;
  this.state.lastEvolution = parsed.lastEvolution ?? Date.now();
  this.state.insights = parsed.insights ?? [];
  this.lastEvolutionTradeCount = parsed.lastEvolutionTradeCount ?? 0;
}
        } catch { /* skip malformed */ }
      }
      console.log(`[Learning] Loaded state: ${Object.keys(this.state.pairs).length} pairs, ${this.state.patterns.length} patterns, v${this.state.params.version}`);
    } catch (e: any) {
      // Table may not exist yet — will be created on first save
      console.log(`[Learning] No saved state found (${e.message}) — starting fresh`);
    }
    // Start auto-save every 2 minutes
    this.saveTimer = setInterval(() => { if (this.dirty) this.save(); }, 120_000);
  }

  async save() {
    try {
      const db = await getDb();
      if (!db) { console.log("[Learning] DB not available — cannot save"); return; }
      const upsert = async (key: string, value: any) => {
        const json = JSON.stringify(value);
        await db.execute(sql`
          INSERT INTO bot_learning_state (\`key\`, \`value\`, updated_at)
          VALUES (${key}, ${json}, NOW())
          ON DUPLICATE KEY UPDATE \`value\` = ${json}, updated_at = NOW()
        `);
      };
      await upsert("pairs", this.state.pairs);
await upsert("sessions", this.state.sessions);
await upsert("strategies", this.state.strategies);
await upsert("confidenceBuckets", this.state.confidenceBuckets);
await upsert("params", this.state.params);
      await upsert("patterns", this.state.patterns.slice(-this.MAX_PATTERNS));
await upsert("meta", {
  totalEvolutions: this.state.totalEvolutions,
  lastEvolution: this.state.lastEvolution,
  lastEvolutionTradeCount: this.lastEvolutionTradeCount,
  insights: this.state.insights.slice(-50),
});
      this.dirty = false;
    } catch (e: any) {
      console.log(`[Learning] Save failed: ${e.message}`);
    }
  }

  // ── Core learning: called after every trade closes ────────────────────────

  recordTrade(trade: {
    instrument: string;
    direction: "BUY" | "SELL";
    won: boolean;
    pnl: number;
    pips: number;
    rsi: number;
    macd: number;
    bbPosition: number;
    atr: number;
    entryPrice: number;
    ema9: number;
    ema21: number;
    openTime: number;
closedAt: number;
strategy?: string;
regime?: string;
confidence?: number;
  }) {
    const hour = new Date(trade.openTime).getUTCHours();

    // 1. Update pair learning
    if (!this.state.pairs[trade.instrument]) {
      this.state.pairs[trade.instrument] = defaultPairLearning(trade.instrument);
    }
    const pair = this.state.pairs[trade.instrument];
    pair.trades++;
    if (trade.won) {
      pair.wins++;
      pair.consecutiveLosses = 0;
      pair.avgWinPips = ema1([pair.avgWinPips, trade.pips], 0.2);
    } else {
      pair.losses++;
      pair.consecutiveLosses++;
      pair.avgLossPips = ema1([pair.avgLossPips, Math.abs(trade.pips)], 0.2);
    }
    pair.winRate = pair.wins / pair.trades;
    pair.avgPnl = ema1([pair.avgPnl, trade.pnl], 0.15);
    const totalWinPnl = pair.wins > 0 ? pair.avgWinPips * pair.wins : 0.001;
    const totalLossPnl = pair.losses > 0 ? pair.avgLossPips * pair.losses : 0.001;
    pair.profitFactor = totalWinPnl / totalLossPnl;
    pair.score = computePairScore(pair);
    pair.lastUpdated = Date.now();

    // Auto-disable/enable pairs
    if (pair.trades >= 10 && pair.winRate < this.PAIR_DISABLE_THRESHOLD && pair.enabled) {
      pair.enabled = false;
      this.addInsight(`🚫 Auto-disabled ${trade.instrument} (win rate ${(pair.winRate * 100).toFixed(0)}% after ${pair.trades} trades)`);
    }
    if (pair.trades >= 10 && pair.winRate >= this.PAIR_ENABLE_THRESHOLD && !pair.enabled) {
      pair.enabled = true;
      this.addInsight(`✅ Re-enabled ${trade.instrument} (win rate recovered to ${(pair.winRate * 100).toFixed(0)}%)`);
    }

    // Adaptive confidence threshold per pair
    if (trade.won) {
      pair.confidenceThreshold = Math.max(0.72, pair.confidenceThreshold - 0.003);
    } else {
      pair.confidenceThreshold = Math.min(0.95, pair.confidenceThreshold + 0.015);
      if (pair.consecutiveLosses >= 3) {
        pair.confidenceThreshold = Math.min(0.95, pair.confidenceThreshold + 0.02);
        this.addInsight(`⚠ ${trade.instrument}: ${pair.consecutiveLosses} consecutive losses — raising threshold to ${(pair.confidenceThreshold * 100).toFixed(0)}%`);
      }
    }

    // Track best direction
    if (pair.trades >= 10) {
      const buyWins = this.state.patterns.filter(p => p.won && p.rsi > 0).length; // proxy
      pair.bestDirection = "BOTH"; // refined in evolve()
    }

    // 2. Update session learning
    const sess = this.state.sessions[hour];
    sess.trades++;
    if (trade.won) sess.wins++;
    sess.winRate = sess.wins / sess.trades;
    sess.avgPnl = ema1([sess.avgPnl, trade.pnl], 0.2);
    // Weight: sessions with >50% win rate get boosted, <40% get penalised
    if (sess.trades >= 5) {
      if (sess.winRate > 0.55) sess.weight = Math.min(1.0, sess.weight + 0.05);
      else if (sess.winRate < 0.40) sess.weight = Math.max(0.1, sess.weight - 0.05);
    }
    sess.lastUpdated = Date.now();

// 2b. Update strategy learning
const strategyName = trade.strategy ?? "UNKNOWN";

if (!this.state.strategies[strategyName]) {
  this.state.strategies[strategyName] = defaultStrategyLearning(strategyName);
}

const strat = this.state.strategies[strategyName];
strat.trades++;

if (trade.won) {
  strat.wins++;
  strat.grossProfit += Math.max(0, trade.pnl);
} else {
  strat.losses++;
  strat.grossLoss += Math.abs(Math.min(0, trade.pnl));
}

strat.winRate = strat.wins / Math.max(1, strat.trades);
strat.avgPnl = ema1([strat.avgPnl, trade.pnl], 0.2);
strat.profitFactor =
  strat.grossLoss > 0
    ? strat.grossProfit / strat.grossLoss
    : strat.grossProfit > 0
      ? 99
      : 1;

strat.score = computeStrategyScore(strat);
strat.lastUpdated = Date.now();

if (strat.trades >= 10 && strat.score < 0.35 && strat.enabled) {
  strat.enabled = false;
  this.addInsight(
    `🚫 Strategy ${strategyName} disabled — score ${(strat.score * 100).toFixed(0)}%, WR ${(strat.winRate * 100).toFixed(0)}%`
  );
}

if (strat.trades >= 10 && strat.score >= 0.45 && !strat.enabled) {
  strat.enabled = true;
  this.addInsight(
    `✅ Strategy ${strategyName} re-enabled — score ${(strat.score * 100).toFixed(0)}%, WR ${(strat.winRate * 100).toFixed(0)}%`
  );
}

// 2c. Update confidence calibration
const confidence = Math.max(0, Math.min(0.99, trade.confidence ?? 0));
const confidenceBucketName = getConfidenceBucketName(confidence);

if (!this.state.confidenceBuckets[confidenceBucketName]) {
  this.state.confidenceBuckets[confidenceBucketName] =
    defaultConfidenceBucket(confidenceBucketName);
}

const bucket = this.state.confidenceBuckets[confidenceBucketName];

bucket.trades++;

if (trade.won) {
  bucket.wins++;
  bucket.grossProfit += Math.max(0, trade.pnl);
} else {
  bucket.losses++;
  bucket.grossLoss += Math.abs(Math.min(0, trade.pnl));
}

bucket.winRate = bucket.wins / Math.max(1, bucket.trades);
bucket.avgPnl = ema1([bucket.avgPnl, trade.pnl], 0.2);
bucket.profitFactor =
  bucket.grossLoss > 0
    ? bucket.grossProfit / bucket.grossLoss
    : bucket.grossProfit > 0
      ? 99
      : 1;

bucket.calibratedScore = computeConfidenceCalibrationScore(bucket);
bucket.lastUpdated = Date.now();

if (bucket.trades === 10) {
  this.addInsight(
    `🎯 Confidence ${bucket.bucket}% calibrated: WR ${(bucket.winRate * 100).toFixed(0)}%, PF ${bucket.profitFactor.toFixed(2)}`
  );
}

    // 3. Store pattern
    const atrNorm = trade.entryPrice > 0 ? trade.atr / trade.entryPrice : 0;
    const emaSpread = trade.ema21 > 0 ? (trade.ema9 - trade.ema21) / trade.ema21 : 0;
this.state.patterns.push({
  rsi: trade.rsi,
  macd: trade.macd,
  bbPosition: trade.bbPosition,
  atrNorm,
  emaSpread,
  hour,
  won: trade.won,
  pnl: trade.pnl,
  strategy: trade.strategy ?? "UNKNOWN",
  regime: trade.regime ?? "UNKNOWN",
  instrument: trade.instrument,
  confidence,
  confidenceBucket: confidenceBucketName,
});
    if (this.state.patterns.length > this.MAX_PATTERNS) {
      this.state.patterns.shift();
    }

    this.dirty = true;

// 4. Evolve parameters reliably after enough NEW learned trades.
// Do not use modulo. Modulo can miss evolution after restarts or skipped events.
const totalTrades = this.getTotalLearnedTrades();
const tradesSinceEvolution = totalTrades - this.lastEvolutionTradeCount;

if (tradesSinceEvolution >= this.EVOLUTION_MIN_TRADES) {
  this.evolve("auto");
}
  }

  // ── Parameter evolution — the core "self-learning" ───────────────────────

public evolve(reason: "auto" | "manual" | "startup" = "manual"): boolean {
const patterns = this.state.patterns;
const totalTrades = this.getTotalLearnedTrades();

if (patterns.length < 15) {
  this.addInsight(`⚠ Evolution skipped (${reason}) — only ${patterns.length}/15 patterns available`);
  console.log(`[Learning] Evolution skipped (${reason}) — only ${patterns.length}/15 patterns available`);
  return false;
}

const wins = patterns.filter(p => p.won);
const losses = patterns.filter(p => !p.won);

if (wins.length < 5 || losses.length < 5) {
  this.addInsight(`⚠ Evolution skipped (${reason}) — needs at least 5 wins and 5 losses. Current: ${wins.length}W/${losses.length}L`);
  console.log(`[Learning] Evolution skipped (${reason}) — insufficient win/loss mix: ${wins.length}W/${losses.length}L`);
  this.lastEvolutionTradeCount = totalTrades;
  this.dirty = true;
  return false;
}
    const prev = { ...this.state.params };
    const p = this.state.params;

    // ── RSI: find the RSI range where wins cluster ──
    const winRsi = wins.map(w => w.rsi);
    const lossRsi = losses.map(l => l.rsi);
    const winRsiMean = mean(winRsi);
    const lossRsiMean = mean(lossRsi);
    const winRsiStd = std(winRsi);

    // Shift RSI bounds toward the winning cluster
    const targetLower = Math.max(30, winRsiMean - winRsiStd * 1.2);
    const targetUpper = Math.min(70, winRsiMean + winRsiStd * 1.2);
    p.rsiLower = lerp(p.rsiLower, targetLower, 0.15);
    p.rsiUpper = lerp(p.rsiUpper, targetUpper, 0.15);
    p.rsiSellLower = lerp(p.rsiSellLower, 100 - targetUpper, 0.15);
    p.rsiSellUpper = lerp(p.rsiSellUpper, 100 - targetLower, 0.15);

    // ── ATR multiplier: if avg loss > avg win, widen SL ──
    const avgWinPips = mean(wins.map(w => w.pnl));
    const avgLossPips = mean(losses.map(l => Math.abs(l.pnl)));
    const currentRR = avgWinPips / (avgLossPips || 1);
    if (currentRR < 1.5 && p.atrSlMultiplier < 2.5) {
      // Losses are too big relative to wins — widen SL
      p.atrSlMultiplier = Math.min(2.5, p.atrSlMultiplier + 0.05);
      p.atrTpMultiplier = Math.min(4.0, p.atrTpMultiplier + 0.1);
    } else if (currentRR > 2.5 && p.atrSlMultiplier > 1.0) {
      // RR is great — can tighten slightly
      p.atrSlMultiplier = Math.max(1.0, p.atrSlMultiplier - 0.02);
    }

    // ── Confidence threshold: based on overall win rate ──
    const overallWinRate = wins.length / patterns.length;
    if (overallWinRate > 0.65) {
      p.minConfidence = Math.max(0.72, p.minConfidence - 0.01);
    } else if (overallWinRate < 0.45) {
      p.minConfidence = Math.min(0.92, p.minConfidence + 0.02);
    }

    // ── Hour weighting: find best hours ──
    const hourWinRates = this.state.sessions
      .filter(s => s.trades >= 3)
      .sort((a, b) => b.winRate - a.winRate);
    const bestHours = hourWinRates.slice(0, 8).map(s => s.hour);

    p.version++;
    p.lastEvolved = Date.now();
    this.state.totalEvolutions++;
    this.state.lastEvolution = Date.now();

    // Generate insight
    const rsiChange = `RSI ${prev.rsiLower.toFixed(0)}-${prev.rsiUpper.toFixed(0)} → ${p.rsiLower.toFixed(0)}-${p.rsiUpper.toFixed(0)}`;
    const slChange = `SL ${prev.atrSlMultiplier.toFixed(2)}x → ${p.atrSlMultiplier.toFixed(2)}x ATR`;
    const confChange = `Conf ${(prev.minConfidence * 100).toFixed(0)}% → ${(p.minConfidence * 100).toFixed(0)}%`;
    const insight = `🧠 Evolution v${p.version}: ${rsiChange} | ${slChange} | ${confChange} | WR ${(overallWinRate * 100).toFixed(0)}% | Best hours: ${bestHours.slice(0, 4).join(',')}h UTC`;
    this.addInsight(insight);
    console.log(`[Learning] ${insight}`);
this.lastEvolutionTradeCount = totalTrades;
this.dirty = true;
return true;
  }

  // ── Getters used by the engine ────────────────────────────────────────────

  getParams(): SignalParams {
    return { ...this.state.params };
  }

  getPairLearning(instrument: string): PairLearning {
    return this.state.pairs[instrument] ?? defaultPairLearning(instrument);
  }

  isPairEnabled(instrument: string): boolean {
    const p = this.state.pairs[instrument];
    if (!p) return true; // new pair — allow
    return p.enabled;
  }

  isHourActive(hour: number): boolean {
    const sess = this.state.sessions[hour];
    if (!sess || sess.trades < 5) return true; // not enough data — allow
    return sess.weight >= 0.3;
  }

  getPairConfidenceThreshold(instrument: string): number {
    const p = this.state.pairs[instrument];
    return p?.confidenceThreshold ?? this.state.params.minConfidence;
  }

  getState(): LearningState {
    return JSON.parse(JSON.stringify(this.state));
  }

  getTopPairs(n = 5): PairLearning[] {
    return Object.values(this.state.pairs)
      .filter(p => p.trades >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, n);
  }

getStrategyLearning(strategy: string): StrategyLearning {
  return this.state.strategies[strategy] ?? defaultStrategyLearning(strategy);
}

isStrategyEnabled(strategy: string): boolean {
  const s = this.state.strategies[strategy];
  if (!s) return true;
  return s.enabled;
}

getTopStrategies(n = 5): StrategyLearning[] {
  return Object.values(this.state.strategies)
    .filter(s => s.trades >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

  getWorstPairs(n = 5): PairLearning[] {
    return Object.values(this.state.pairs)
      .filter(p => p.trades >= 3)
      .sort((a, b) => a.score - b.score)
      .slice(0, n);
  }

  getBestHours(): SessionLearning[] {
    return this.state.sessions
      .filter(s => s.trades >= 3)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 6);
  }

getTotalLearnedTrades(): number {
  return Object.values(this.state.pairs).reduce((sum, pair) => sum + pair.trades, 0);
}

getEvolutionStatus() {
  const totalTrades = this.getTotalLearnedTrades();
  const tradesSinceEvolution = totalTrades - this.lastEvolutionTradeCount;
  const tradesRemaining = Math.max(0, this.EVOLUTION_MIN_TRADES - tradesSinceEvolution);

  return {
    totalLearnedTrades: totalTrades,
    lastEvolutionTradeCount: this.lastEvolutionTradeCount,
    tradesSinceEvolution,
    tradesRemaining,
    evolutionInterval: this.EVOLUTION_MIN_TRADES,
    currentVersion: this.state.params.version,
    totalEvolutions: this.state.totalEvolutions,
    lastEvolution: this.state.lastEvolution,
  };
}

getConfidenceBuckets(): ConfidenceBucketLearning[] {
  return Object.values(this.state.confidenceBuckets)
    .sort((a, b) => a.minConfidence - b.minConfidence);
}

getBestConfidenceBuckets(n = 3): ConfidenceBucketLearning[] {
  return Object.values(this.state.confidenceBuckets)
    .filter(b => b.trades >= 5)
    .sort((a, b) => b.calibratedScore - a.calibratedScore)
    .slice(0, n);
}

getConfidenceCalibration(confidence: number): ConfidenceBucketLearning {
  const bucketName = getConfidenceBucketName(confidence);
  return this.state.confidenceBuckets[bucketName] ?? defaultConfidenceBucket(bucketName);
}

  private addInsight(msg: string) {
    this.state.insights.unshift(`[${new Date().toISOString().slice(0, 16)}] ${msg}`);
    if (this.state.insights.length > 50) this.state.insights.pop();
  }

  destroy() {
    if (this.saveTimer) clearInterval(this.saveTimer);
  }
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

/** Exponential moving average update: new = old * (1-alpha) + value * alpha */
function ema1(values: number[], alpha: number): number {
  if (values.length === 0) return 0;
  let v = values[0];
  for (let i = 1; i < values.length; i++) v = v * (1 - alpha) + values[i] * alpha;
  return v;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 5;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function computePairScore(p: PairLearning): number {
  if (p.trades === 0) return 0.5;
  const wrScore = p.winRate;                          // 0-1
  const pfScore = Math.min(p.profitFactor / 3, 1);   // cap at 3x PF
  const sampleScore = Math.min(p.trades / 20, 1);    // more trades = more reliable
  const streakPenalty = Math.max(0, 1 - p.consecutiveLosses * 0.1);
  return (wrScore * 0.4 + pfScore * 0.35 + sampleScore * 0.15 + streakPenalty * 0.1);
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const learningEngine = new LearningEngine();
