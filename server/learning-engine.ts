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

import { loadPersistentState, savePersistentState } from "./persistent-memory";

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

  athenaQualityScore?: number;
  athenaConfidenceScore?: number;
  athenaNeuralScore?: number;
  athenaEV?: number;
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

export interface RegimeLearning {
  regime: string;
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

export interface LearningState {
  pairs: Record<string, PairLearning>;
  sessions: SessionLearning[];
  strategies: Record<string, StrategyLearning>;
  confidenceBuckets: Record<string, ConfidenceBucketLearning>;
  regimes: Record<string, RegimeLearning>;
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

function defaultRegimeLearning(regime: string): RegimeLearning {
  return {
    regime,
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

function computeRegimeScore(regime: RegimeLearning): number {
  if (regime.trades < 5) return 0.5;

  const wrScore = regime.winRate;
  const pfScore = Math.min(regime.profitFactor / 2.5, 1);
  const pnlScore = regime.avgPnl > 0 ? 0.75 : 0.25;

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
private readonly MAX_PAIR_CONFIDENCE_THRESHOLD = 0.88;
private readonly CONFIDENCE_DECAY_START_MS = 48 * 60 * 60 * 1000;
private readonly CONFIDENCE_DECAY_RATE_PER_DAY = 0.01;
  private readonly MAX_PATTERNS = 500;

  constructor() {
    this.state = {
      pairs: {},
      sessions: Array.from({ length: 24 }, (_, h) => defaultSessionLearning(h)),
      strategies: {},
      confidenceBuckets: {},
      regimes: {},
      params: { ...DEFAULT_PARAMS },
      patterns: [],
      totalEvolutions: 0,
      lastEvolution: Date.now(),
      insights: [],
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

 async load() {
  try {
    const saved = await loadPersistentState<any>("learningEngine", {});

    this.state.pairs = saved.pairs ?? this.state.pairs;
    this.state.sessions = saved.sessions ?? this.state.sessions;
    this.state.strategies = saved.strategies ?? this.state.strategies;
    this.state.confidenceBuckets = saved.confidenceBuckets ?? this.state.confidenceBuckets;
    this.state.regimes = saved.regimes ?? this.state.regimes;
    this.state.params = { ...DEFAULT_PARAMS, ...(saved.params ?? {}) };
    this.state.patterns = saved.patterns ?? this.state.patterns;
    this.state.totalEvolutions = saved.totalEvolutions ?? this.state.totalEvolutions;
    this.state.lastEvolution = saved.lastEvolution ?? this.state.lastEvolution;
    this.state.insights = saved.insights ?? this.state.insights;

    this.lastEvolutionTradeCount =
      saved.lastEvolutionTradeCount ?? this.lastEvolutionTradeCount;

    console.log(
      `[Learning] Loaded persistent state: ${Object.keys(this.state.pairs).length} pairs, ` +
      `${this.state.patterns.length} patterns, v${this.state.params.version}`
    );
  } catch (e: any) {
    console.log(`[Learning] Load failed: ${e?.message ?? e}`);
  }

  if (!this.saveTimer) {
    this.saveTimer = setInterval(() => {
      if (this.dirty) this.save();
    }, 120_000);
  }
}

async save() {
  try {
    await savePersistentState("learningEngine", {
      pairs: this.state.pairs,
      sessions: this.state.sessions,
      strategies: this.state.strategies,
      confidenceBuckets: this.state.confidenceBuckets,
      regimes: this.state.regimes,
      params: this.state.params,
      patterns: this.state.patterns.slice(-this.MAX_PATTERNS),
      totalEvolutions: this.state.totalEvolutions,
      lastEvolution: this.state.lastEvolution,
      insights: this.state.insights.slice(-50),
      lastEvolutionTradeCount: this.lastEvolutionTradeCount,
    });

    this.dirty = false;
  } catch (e: any) {
    console.error("[Learning] Save failed");
    console.error("Message:", e?.message);
    console.error("Code:", e?.code);
    console.error("SQL Message:", e?.sqlMessage);
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
athenaQualityScore?: number;
athenaConfidenceScore?: number;
athenaNeuralScore?: number;
athenaEV?: number;
    }) {
    // Prevent historical OANDA backfill from re-teaching the AI every restart.
    // Backfill should seed learning only when the learning DB is empty.
    if (
      (trade.strategy ?? "") === "BACKFILLED" &&
      this.getTotalLearnedTrades() > 0
    ) {
      return;
    }

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

    // Adaptive confidence threshold per pair — capped at 0.88 to prevent deadlock
    if (trade.won) {
      pair.confidenceThreshold = Math.max(0.72, pair.confidenceThreshold - 0.003);
    } else {
      pair.confidenceThreshold = Math.min(0.88, pair.confidenceThreshold + 0.015);
      if (pair.consecutiveLosses >= 3) {
        pair.confidenceThreshold = Math.min(0.88, pair.confidenceThreshold + 0.02);
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

// 2d. Update regime learning
const regimeName = trade.regime ?? "UNKNOWN";

if (!this.state.regimes[regimeName]) {
  this.state.regimes[regimeName] = defaultRegimeLearning(regimeName);
}

const regimeLearning = this.state.regimes[regimeName];

regimeLearning.trades++;

if (trade.won) {
  regimeLearning.wins++;
  regimeLearning.grossProfit += Math.max(0, trade.pnl);
} else {
  regimeLearning.losses++;
  regimeLearning.grossLoss += Math.abs(Math.min(0, trade.pnl));
}

regimeLearning.winRate =
  regimeLearning.wins / Math.max(1, regimeLearning.trades);

regimeLearning.avgPnl =
  ema1([regimeLearning.avgPnl, trade.pnl], 0.2);

regimeLearning.profitFactor =
  regimeLearning.grossLoss > 0
    ? regimeLearning.grossProfit / regimeLearning.grossLoss
    : regimeLearning.grossProfit > 0
      ? 99
      : 1;

regimeLearning.score = computeRegimeScore(regimeLearning);
regimeLearning.lastUpdated = Date.now();

if (
  regimeLearning.trades >= 10 &&
  regimeLearning.score < 0.35 &&
  regimeLearning.enabled
) {
  regimeLearning.enabled = false;
  this.addInsight(
    `🚫 Regime ${regimeName} disabled — score ${(regimeLearning.score * 100).toFixed(0)}%, WR ${(regimeLearning.winRate * 100).toFixed(0)}%`
  );
}

if (
  regimeLearning.trades >= 10 &&
  regimeLearning.score >= 0.45 &&
  !regimeLearning.enabled
) {
  regimeLearning.enabled = true;
  this.addInsight(
    `✅ Regime ${regimeName} re-enabled — score ${(regimeLearning.score * 100).toFixed(0)}%, WR ${(regimeLearning.winRate * 100).toFixed(0)}%`
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

  athenaQualityScore: trade.athenaQualityScore,
  athenaConfidenceScore: trade.athenaConfidenceScore,
  athenaNeuralScore: trade.athenaNeuralScore,
  athenaEV: trade.athenaEV,
});
    if (this.state.patterns.length > this.MAX_PATTERNS) {
      this.state.patterns.shift();
    }

const athenaPatterns = this.state.patterns.filter(
  p => typeof p.athenaNeuralScore === "number"
);

if (athenaPatterns.length >= 10 && athenaPatterns.length % 10 === 0) {
  const highNeural = athenaPatterns.filter(p => (p.athenaNeuralScore ?? 0) >= 80);
  const highNeuralWins = highNeural.filter(p => p.won).length;
  const highNeuralWR = highNeural.length > 0 ? highNeuralWins / highNeural.length : 0;

  const avgEV =
    athenaPatterns.reduce((sum, p) => sum + (p.athenaEV ?? 0), 0) /
    athenaPatterns.length;

  this.addInsight(
`🧠 Nereqo calibration: ${athenaPatterns.length} scored trades | ` +
    `80+ Neural WR ${(highNeuralWR * 100).toFixed(0)}% | ` +
    `Avg EV ${avgEV.toFixed(2)}R`
  );
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

  if (!p) {
    return Math.min(this.MAX_PAIR_CONFIDENCE_THRESHOLD, this.state.params.minConfidence);
  }

  const baseThreshold = Math.min(this.MAX_PAIR_CONFIDENCE_THRESHOLD, this.state.params.minConfidence);
  const cappedThreshold = Math.min(this.MAX_PAIR_CONFIDENCE_THRESHOLD, p.confidenceThreshold);
  const idleMs = Date.now() - p.lastUpdated;

  if (idleMs <= this.CONFIDENCE_DECAY_START_MS || cappedThreshold <= baseThreshold) {
    if (p.confidenceThreshold !== cappedThreshold) {
      p.confidenceThreshold = cappedThreshold;
      this.dirty = true;
    }

    return cappedThreshold;
  }

  const decayDays = (idleMs - this.CONFIDENCE_DECAY_START_MS) / 86_400_000;
  const decayAmount = decayDays * this.CONFIDENCE_DECAY_RATE_PER_DAY;
  const decayedThreshold = Math.max(baseThreshold, cappedThreshold - decayAmount);
  const roundedThreshold = Number(decayedThreshold.toFixed(4));

  if (roundedThreshold < p.confidenceThreshold) {
    p.confidenceThreshold = roundedThreshold;
    this.dirty = true;
  }

  return roundedThreshold;
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

getRegimeLearning(regime: string): RegimeLearning {
  return this.state.regimes[regime] ?? defaultRegimeLearning(regime);
}

isRegimeEnabled(regime: string): boolean {
  const r = this.state.regimes[regime];
  if (!r) return true;
  return r.enabled;
}

getTopRegimes(n = 5): RegimeLearning[] {
  return Object.values(this.state.regimes)
    .filter(r => r.trades >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

getWorstRegimes(n = 5): RegimeLearning[] {
  return Object.values(this.state.regimes)
    .filter(r => r.trades >= 3)
    .sort((a, b) => a.score - b.score)
    .slice(0, n);
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
