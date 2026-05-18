/**
 * OANDA v3 Trading Bot Engine — Mathematically Optimized
 * 
 * Integrates:
 * - Risk Engine (Sortino, Alpha/Beta, Risk of Ruin)
 * - Position Sizer (Fractional Kelly, Geometric Compounding)
 * - Signal Filter (EV vs Transaction Cost)
 * - Live Spread Integration (OANDA Streaming API)
 * - Micro-Account Mode
 */

import { EventEmitter } from "events";
import { getDb } from "./db";
import { RiskEngine } from "./risk-engine";
import { PositionSizer } from "./position-sizer";
import { SignalFilter } from "./signal-filter";
import {
  logTrade,
  recordEquitySnapshot,
  recordSignalPerformance,
  isInActiveSession,
  getDailyLossGuard,
  updateDailyLossGuard,
} from "./trading";

interface BotConfig {
  userId: number;
  oandaToken: string;
  accountId: string;
  instrument: string;
  candlePeriod: number;
  riskPercent: number;
  tpMultiplier: number;
  slMultiplier: number;
  maxOpenTrades: number;
}

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Signal {
  action: "BUY" | "SELL" | "WAIT";
  signalType: string;
  confidence: number;
  rsi: number;
  e9: number;
  e21: number;
  atr: number;
  reason: string;
}

export class OptimizedTradingBotEngine extends EventEmitter {
  private config: BotConfig;
  private riskEngine: RiskEngine;
  private positionSizer: PositionSizer;
  private signalFilter: SignalFilter;
  private candles: Map<number, Candle[]> = new Map();
  private currentCandle: Candle | null = null;
  private bid: number = 0;
  private ask: number = 0;
  private liveSpread: number = 1.5; // Default 1.5 pips
  private streaming: boolean = false;
  private autoTrading: boolean = false;
  private positions: any[] = [];
  private recentTrades: any[] = [];
  private accountBalance: number = 20; // Starting balance

  constructor(config: BotConfig) {
    super();
    this.config = config;
    this.riskEngine = new RiskEngine(config.userId);
    this.positionSizer = new PositionSizer(config.userId);
    this.signalFilter = new SignalFilter(config.userId, this.riskEngine);
  }

  /**
   * Start the optimized trading bot
   */
  async start() {
    console.log(`[BOT] Starting optimized trading engine for ${this.config.instrument}...`);

    try {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await this.startStreaming();
      this.autoTrading = true;

      this.emit("started");
      console.log(`[BOT] Optimized trading engine started`);
    } catch (error) {
      console.error("[BOT] Failed to start:", error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Start SSE streaming with live spread tracking
   */
  private async startStreaming() {
    const url = `https://stream-fxpractice.oanda.com/v3/accounts/${this.config.accountId}/pricing/stream?instruments=${this.config.instrument}`;

    const headers = {
      Authorization: `Bearer ${this.config.oandaToken}`,
      "Accept-Encoding": "identity",
    };

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      this.streaming = true;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      let buffer = "";
      const decoder = new TextDecoder();

      while (this.streaming) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              await this.processPriceData(data);
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (error) {
      console.error("[STREAM] Error:", error);
      this.streaming = false;
      setTimeout(() => this.startStreaming(), 5000);
    }
  }

  /**
   * Process incoming price tick with full optimization
   */
  private async processPriceData(data: any) {
    if (data.type === "PRICE") {
      this.bid = parseFloat(data.bids[0].price);
      this.ask = parseFloat(data.asks[0].price);
      const mid = (this.bid + this.ask) / 2;

      // Update live spread (in pips)
      this.liveSpread = (this.ask - this.bid) * 10000;

      // Build candle
      this.updateCandle(data.time, mid);

      // Get risk metrics
      const riskMetrics = await this.riskEngine.calculateRiskMetrics(
        this.accountBalance,
        this.recentTrades.slice(-20) // Last 20 trades
      );

      // Evaluate signal
      const signal = await this.evaluateSignal(riskMetrics);

      // Execute if signal passes all filters
      if (signal.action !== "WAIT" && this.autoTrading) {
        await this.executeSignal(signal, riskMetrics);
      }

      this.emit("tick", {
        bid: this.bid,
        ask: this.ask,
        mid,
        spread: this.liveSpread,
        signal,
        riskMetrics,
      });
    }
  }

  /**
   * Evaluate signal with full mathematical optimization
   */
  private async evaluateSignal(riskMetrics: any): Promise<Signal> {
    const closes = this.getRecentCloses(50);
    if (closes.length < 21) {
      return {
        action: "WAIT",
        signalType: "",
        confidence: 0,
        rsi: 0,
        e9: 0,
        e21: 0,
        atr: 0.001,
        reason: "Insufficient data",
      };
    }

    // Calculate indicators
    const e9 = this.calculateEMA(closes, 9);
    const e21 = this.calculateEMA(closes, 21);
    const rsi = this.calculateRSI(closes, 14);
    const atr = this.calculateATR(closes, 14);

    // Check session filter
    const inSession = await isInActiveSession(this.config.userId);
    if (!inSession) {
      return {
        action: "WAIT",
        signalType: "",
        confidence: 0,
        rsi,
        e9,
        e21,
        atr,
        reason: "Outside trading session",
      };
    }

    // Check daily loss guard
    const guard = await getDailyLossGuard(this.config.userId, 5);
    if (guard.isPaused) {
      return {
        action: "WAIT",
        signalType: "",
        confidence: 0,
        rsi,
        e9,
        e21,
        atr,
        reason: "Daily loss limit reached",
      };
    }

    // Generate base signals
    let baseSignal: Signal = {
      action: "WAIT",
      signalType: "",
      confidence: 0,
      rsi,
      e9,
      e21,
      atr,
      reason: "No signal",
    };

    // EMA Crossover
    if (e9 > e21) {
      baseSignal = {
        action: "BUY",
        signalType: "CROSSOVER_BUY",
        confidence: 0.8,
        rsi,
        e9,
        e21,
        atr,
        reason: "EMA 9 above EMA 21",
      };
    } else if (e9 < e21) {
      baseSignal = {
        action: "SELL",
        signalType: "CROSSOVER_SELL",
        confidence: 0.8,
        rsi,
        e9,
        e21,
        atr,
        reason: "EMA 9 below EMA 21",
      };
    }

    if (baseSignal.action === "WAIT") {
      return baseSignal;
    }

    // Apply signal filter with EV calculation
    const filterResult = this.signalFilter.evaluateSignal({
      signalType: baseSignal.signalType,
      direction: baseSignal.action,
      confidence: baseSignal.confidence,
      expectedProfit: 10, // 10 pips target
      expectedLoss: 5, // 5 pips stop loss
      balance: this.accountBalance,
      liveSpread: this.liveSpread,
      commission: 0.01,
      slippage: 0.5,
      recentWinRate: riskMetrics.recentWinRate,
      sortino: riskMetrics.sortino,
      alpha: riskMetrics.alpha,
      beta: riskMetrics.beta,
      microAccountMode: riskMetrics.microAccountMode,
      marketRegime: this.detectMarketRegime(e9, e21, rsi),
    });

    if (!filterResult.shouldExecute) {
      return {
        ...baseSignal,
        action: "WAIT",
        reason: filterResult.reason,
        confidence: filterResult.adjustedConfidence,
      };
    }

    // Adjust confidence based on risk metrics
    const adjustedConfidence = this.riskEngine.adjustConfidenceByRisk(
      filterResult.adjustedConfidence,
      riskMetrics.sortino
    );

    return {
      ...baseSignal,
      confidence: adjustedConfidence,
      reason: `${baseSignal.reason} | EV: ${filterResult.expectedValue.toFixed(2)} pips | Friction: ${(filterResult.frictionRatio * 100).toFixed(1)}%`,
    };
  }

  /**
   * Execute signal with optimized position sizing
   */
  private async executeSignal(signal: Signal, riskMetrics: any) {
    try {
      if (this.positions.length >= this.config.maxOpenTrades) {
        console.log("[EXEC] Max open trades reached");
        return;
      }

      const mid = (this.bid + this.ask) / 2;

      // Calculate position size using Fractional Kelly
      const positionSizingResult = this.positionSizer.calculatePositionSize({
        balance: this.accountBalance,
        recentWinRate: riskMetrics.recentWinRate,
        avgWinSize: 0.50,
        avgLossSize: 0.20,
        maxRiskPerTrade: riskMetrics.maxRiskPerTrade,
        fractionalKellyFactor: riskMetrics.fractionalKelly,
        microAccountMode: riskMetrics.microAccountMode,
      });

      if (positionSizingResult.recommendation !== "EXECUTE") {
        console.log(`[EXEC] Position sizing recommendation: ${positionSizingResult.recommendation}`);
        return;
      }

      // Calculate stop loss and take profit
      const { stopLoss, takeProfit, riskRewardRatio } =
        this.positionSizer.calculateStopAndProfit(
          mid,
          signal.atr,
          signal.action as "BUY" | "SELL",
          this.config.slMultiplier,
          this.config.tpMultiplier
        );

      console.log(
        `[EXEC] ${signal.action} ${positionSizingResult.units} units @ ${mid.toFixed(5)}`
      );
      console.log(
        `       SL: ${stopLoss.toFixed(5)} | TP: ${takeProfit.toFixed(5)} | RR: ${riskRewardRatio.toFixed(2)}`
      );
      console.log(
        `       Kelly: ${positionSizingResult.kellyPercentage.toFixed(1)}% | Fractional: ${positionSizingResult.fractionalPercentage.toFixed(1)}%`
      );
      console.log(
        `       Risk: £${positionSizingResult.riskAmount.toFixed(2)} | Expected Profit: £${positionSizingResult.expectedProfit.toFixed(2)}`
      );

      // Log trade
      if (signal.action !== "WAIT") {
        await logTrade(this.config.userId, {
          oandaTradeId: `trade-${Date.now()}`,
          instrument: this.config.instrument,
          direction: signal.action as "BUY" | "SELL",
        entryPrice: mid.toString(),
        exitPrice: mid.toString(),
        units: positionSizingResult.units,
        pnl: "0.00",
        pnlPercent: "0.00",
        signalType: signal.signalType as "CROSSOVER_BUY" | "CROSSOVER_SELL" | "RSI_PULLBACK_BUY" | "RSI_PULLBACK_SELL",
        rsiAtEntry: signal.rsi.toString(),
        atrAtEntry: signal.atr.toString(),
        stopLossPrice: stopLoss.toString(),
        takeProfitPrice: takeProfit.toString(),
        candlePeriod: this.config.candlePeriod,
        entryTime: new Date(),
        exitTime: new Date(),
        durationSeconds: 0,
        } as any);
      }
      this.emit("trade", {
        signal,
        positionSize: positionSizingResult,
        stopLoss,
        takeProfit,
        riskMetrics,
      });
    } catch (error) {
      console.error("[EXEC] Error:", error);
      this.emit("error", error);
    }
  }

  /**
   * Detect market regime (trending vs ranging vs volatile)
   */
  private detectMarketRegime(
    e9: number,
    e21: number,
    rsi: number
  ): "TRENDING" | "RANGING" | "VOLATILE" {
    const emaDiff = Math.abs(e9 - e21) / e21;

    if (emaDiff > 0.02) {
      return "TRENDING";
    } else if (rsi > 40 && rsi < 60) {
      return "RANGING";
    }

    return "VOLATILE";
  }

  /**
   * Update candle
   */
  private updateCandle(timestamp: string, price: number) {
    const ts = new Date(timestamp).getTime();
    const candleKey = Math.floor(ts / (this.config.candlePeriod * 1000));

    if (!this.candles.has(candleKey)) {
      this.candles.set(candleKey, []);
    }

    const candles = this.candles.get(candleKey)!;
    if (candles.length === 0) {
      candles.push({
        timestamp: candleKey * this.config.candlePeriod * 1000,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 1,
      });
    } else {
      const candle = candles[candles.length - 1];
      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
      candle.volume++;
    }

    this.currentCandle = candles[candles.length - 1];
  }

  /**
   * Calculate EMA
   */
  private calculateEMA(closes: number[], period: number): number {
    if (closes.length < period) return closes[closes.length - 1];
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b) / period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
  }

  /**
   * Calculate RSI
   */
  private calculateRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;
    let gains = 0,
      losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    const rs = gains / losses || 0;
    return 100 - 100 / (1 + rs);
  }

  /**
   * Calculate ATR
   */
  private calculateATR(closes: number[], period: number): number {
    if (closes.length < period) return 0.001;
    let tr = 0;
    for (let i = Math.max(0, closes.length - period); i < closes.length; i++) {
      const h = closes[i];
      const l = closes[i];
      const c = i > 0 ? closes[i - 1] : closes[i];
      tr += Math.max(h - l, Math.abs(h - c), Math.abs(l - c));
    }
    return tr / period;
  }

  /**
   * Get recent closes
   */
  private getRecentCloses(count: number): number[] {
    const closes: number[] = [];
    const sortedKeys = Array.from(this.candles.keys()).sort((a, b) => a - b);
    for (const key of sortedKeys.slice(-count)) {
      const candles = this.candles.get(key);
      if (candles && candles.length > 0) {
        closes.push(candles[candles.length - 1].close);
      }
    }
    return closes;
  }

  /**
   * Get bot status
   */
  getStatus() {
    return {
      streaming: this.streaming,
      autoTrading: this.autoTrading,
      positions: this.positions.length,
      balance: this.accountBalance,
      bid: this.bid,
      ask: this.ask,
      spread: this.liveSpread,
      currentCandle: this.currentCandle,
    };
  }

  /**
   * Stop the bot
   */
  async stop() {
    console.log("[BOT] Stopping optimized trading engine...");
    this.autoTrading = false;
    this.streaming = false;
    this.emit("stopped");
  }
}
