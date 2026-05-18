/**
 * Safety Features Module
 * Simplified safety features that integrate with existing schema
 */

import { getDb } from "./db";
import { eq, desc, and, gte, lte } from "drizzle-orm";
import { trades } from "../drizzle/schema";

/**
 * Trade Confirmation System
 */
export class TradeConfirmationEngine {
  private pendingConfirmations: Map<
    string,
    {
      tradeId: string;
      signal: string;
      instrument: string;
      action: "BUY" | "SELL";
      entryPrice: number;
      stopLoss: number;
      takeProfit: number;
      units: number;
      confidence: number;
      spread: number;
      approvalDeadline: number;
      requiresApproval: boolean;
    }
  > = new Map();

  private approvalTimeoutMs = 5000;

  createConfirmation(data: {
    tradeId: string;
    signal: string;
    instrument: string;
    action: "BUY" | "SELL";
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    units: number;
    confidence: number;
    spread: number;
    requiresApproval: boolean;
  }) {
    const confirmation = {
      ...data,
      approvalDeadline: Date.now() + this.approvalTimeoutMs,
    };

    this.pendingConfirmations.set(data.tradeId, confirmation);

    if (!data.requiresApproval) {
      setTimeout(() => {
        this.pendingConfirmations.delete(data.tradeId);
      }, this.approvalTimeoutMs);
    }

    return confirmation;
  }

  getPendingConfirmations() {
    return Array.from(this.pendingConfirmations.values()).filter(
      (t) => t.approvalDeadline > Date.now()
    );
  }

  approveConfirmation(tradeId: string): boolean {
    const confirmation = this.pendingConfirmations.get(tradeId);
    if (!confirmation) return false;
    this.pendingConfirmations.delete(tradeId);
    return true;
  }

  rejectConfirmation(tradeId: string): boolean {
    return this.pendingConfirmations.delete(tradeId);
  }
}

/**
 * Anomaly Detection
 */
export class AnomalyDetector {
  private spreadHistory: number[] = [];
  private slippageHistory: number[] = [];
  private spreadThreshold = 1.5;
  private slippageThreshold = 0.5;

  detectSpreadWidening(currentSpread: number, normalSpread: number) {
    this.spreadHistory.push(currentSpread);
    if (this.spreadHistory.length > 100) this.spreadHistory.shift();

    const avgSpread =
      this.spreadHistory.reduce((a, b) => a + b, 0) /
      this.spreadHistory.length;
    const ratio = currentSpread / avgSpread;

    if (ratio > this.spreadThreshold) {
      return {
        type: "SPREAD_WIDENING" as const,
        severity: ratio > 2.5 ? ("HIGH" as const) : ("MEDIUM" as const),
        message: `Spread widened to ${currentSpread} pips (${(ratio * 100).toFixed(1)}% above average)`,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  detectSlippageSpike(slippage: number) {
    this.slippageHistory.push(slippage);
    if (this.slippageHistory.length > 100) this.slippageHistory.shift();

    const avgSlippage =
      this.slippageHistory.reduce((a, b) => a + b, 0) /
      this.slippageHistory.length;

    if (slippage > this.slippageThreshold && slippage > avgSlippage * 2) {
      return {
        type: "SLIPPAGE_SPIKE" as const,
        severity: slippage > 1.0 ? ("HIGH" as const) : ("MEDIUM" as const),
        message: `Slippage spike: ${slippage.toFixed(2)} bps (${(slippage / avgSlippage).toFixed(1)}x average)`,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  detectVolatility(atr: number, normalAtr: number) {
    const ratio = atr / normalAtr;
    const volatilityThreshold = 2.0;

    if (ratio > volatilityThreshold) {
      return {
        type: "MARKET_VOLATILITY" as const,
        severity: ratio > 3.0 ? ("HIGH" as const) : ("MEDIUM" as const),
        message: `Market volatility spike: ATR ${atr.toFixed(2)} (${(ratio * 100).toFixed(1)}% above normal)`,
        timestamp: Date.now(),
      };
    }

    return null;
  }
}

/**
 * Losing Streak Detector
 */
export async function detectLosingStreak(userId: number, window: number = 10) {
  const db = await getDb();
  if (!db) return null;

  const recentTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.createdAt))
    .limit(window);

  if (recentTrades.length < 3) return null;

  let losingCount = 0;
  const losingTrades: Array<{ id: number; pnl: number; signal: string }> = [];

  for (const trade of recentTrades) {
    const pnlValue = typeof trade.pnl === "string" ? parseFloat(trade.pnl) : trade.pnl || 0;
    if (pnlValue < 0) {
      losingCount++;
      losingTrades.push({
        id: trade.id,
        pnl: pnlValue,
        signal: trade.signalType || "UNKNOWN",
      });
    } else {
      break;
    }
  }

  if (losingCount < 3) return null;

  const positionScaleFactor = Math.max(0.25, 1 - losingCount * 0.15);

  return {
    count: losingCount,
    trades: losingTrades,
    positionScaleFactor,
    recommendation: `Losing streak of ${losingCount} trades. Scaling positions to ${(positionScaleFactor * 100).toFixed(0)}% of normal.`,
  };
}

/**
 * Execution Quality Analysis
 */
export function analyzeExecutionQuality(
  expectedPrice: number,
  actualPrice: number,
  spread: number,
  targetProfit: number
) {
  const slippage = Math.abs(actualPrice - expectedPrice);
  const slippagePercent = (slippage / expectedPrice) * 100;
  const totalFriction = slippage + spread / 2;
  const profitImpact = (totalFriction / targetProfit) * 100;

  let quality: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  if (profitImpact < 10) quality = "EXCELLENT";
  else if (profitImpact < 25) quality = "GOOD";
  else if (profitImpact < 50) quality = "FAIR";
  else quality = "POOR";

  return {
    expectedPrice,
    actualPrice,
    slippage,
    slippagePercent,
    spread,
    totalFriction,
    profitImpact,
    quality,
  };
}

/**
 * API Health Monitor
 */
export class APIHealthMonitor {
  private lastSuccessfulCall = Date.now();
  private failureCount = 0;
  private maxConsecutiveFailures = 5;
  private isHealthy = true;

  recordSuccess() {
    this.lastSuccessfulCall = Date.now();
    this.failureCount = 0;
    this.isHealthy = true;
  }

  recordFailure() {
    this.failureCount++;
    if (this.failureCount >= this.maxConsecutiveFailures) {
      this.isHealthy = false;
    }
  }

  getHealth() {
    return {
      isHealthy: this.isHealthy,
      failureCount: this.failureCount,
      lastSuccessfulCall: this.lastSuccessfulCall,
      timeSinceLastSuccess: Date.now() - this.lastSuccessfulCall,
    };
  }

  shouldPauseTrading(): boolean {
    return !this.isHealthy;
  }

  reset() {
    this.failureCount = 0;
    this.isHealthy = true;
    this.lastSuccessfulCall = Date.now();
  }
}

/**
 * Performance Report Generator
 */
export async function generatePerformanceReport(
  userId: number,
  period: "DAILY" | "WEEKLY" | "MONTHLY"
) {
  const db = await getDb();
  if (!db) return null;

  const now = new Date();
  let startDate = new Date();

  if (period === "DAILY") {
    startDate.setHours(0, 0, 0, 0);
  } else if (period === "WEEKLY") {
    const day = startDate.getDay();
    startDate.setDate(startDate.getDate() - day);
    startDate.setHours(0, 0, 0, 0);
  } else {
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);
  }

  const periodTrades = await db
    .select()
    .from(trades)
    .where(
      and(
        eq(trades.userId, userId),
        gte(trades.createdAt, startDate),
        lte(trades.createdAt, now)
      )
    );

  if (periodTrades.length === 0) {
    return {
      period,
      startDate,
      endDate: now,
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      avgRR: 0,
      totalPnL: 0,
      bestTrade: { id: 0, pnl: 0 },
      worstTrade: { id: 0, pnl: 0 },
      equityGrowth: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      sortino: 0,
    };
  }

  const wins = periodTrades.filter((t) => {
    const pnl = typeof t.pnl === "string" ? parseFloat(t.pnl) : t.pnl || 0;
    return pnl > 0;
  });

  const losses = periodTrades.filter((t) => {
    const pnl = typeof t.pnl === "string" ? parseFloat(t.pnl) : t.pnl || 0;
    return pnl < 0;
  });

  const totalPnL = periodTrades.reduce((sum, t) => {
    const pnl = typeof t.pnl === "string" ? parseFloat(t.pnl) : t.pnl || 0;
    return sum + pnl;
  }, 0);

  const avgWin =
    wins.length > 0
      ? wins.reduce((sum, t) => {
          const pnl = typeof t.pnl === "string" ? parseFloat(t.pnl) : t.pnl || 0;
          return sum + pnl;
        }, 0) / wins.length
      : 0;

  const avgLoss =
    losses.length > 0
      ? losses.reduce((sum, t) => {
          const pnl = typeof t.pnl === "string" ? parseFloat(t.pnl) : t.pnl || 0;
          return sum + Math.abs(pnl);
        }, 0) / losses.length
      : 0;

  const bestTrade = periodTrades.reduce((best, t) => {
    const bestPnl = typeof best.pnl === "string" ? parseFloat(best.pnl) : best.pnl || 0;
    const tPnl = typeof t.pnl === "string" ? parseFloat(t.pnl) : t.pnl || 0;
    return tPnl > bestPnl ? t : best;
  });

  const worstTrade = periodTrades.reduce((worst, t) => {
    const worstPnl = typeof worst.pnl === "string" ? parseFloat(worst.pnl) : worst.pnl || 0;
    const tPnl = typeof t.pnl === "string" ? parseFloat(t.pnl) : t.pnl || 0;
    return tPnl < worstPnl ? t : worst;
  });

  const bestPnl = typeof bestTrade.pnl === "string" ? parseFloat(bestTrade.pnl) : bestTrade.pnl || 0;
  const worstPnl = typeof worstTrade.pnl === "string" ? parseFloat(worstTrade.pnl) : worstTrade.pnl || 0;

  return {
    period,
    startDate,
    endDate: now,
    totalTrades: periodTrades.length,
    winRate: (wins.length / periodTrades.length) * 100,
    profitFactor: avgWin > 0 && avgLoss > 0 ? avgWin / avgLoss : 0,
    avgRR: avgWin > 0 && avgLoss > 0 ? avgWin / avgLoss : 0,
    totalPnL,
    bestTrade: { id: bestTrade.id, pnl: bestPnl },
    worstTrade: { id: worstTrade.id, pnl: worstPnl },
    equityGrowth: 0,
    maxDrawdown: 0,
    sharpeRatio: 0,
    sortino: 0,
  };
}

/**
 * Manual Trade Close
 */
export async function manuallyClosePosition(
  userId: number,
  tradeId: number,
  closePrice: number,
  reason: string
) {
  const db = await getDb();
  if (!db) {
    return {
      success: false,
      pnl: 0,
      message: "Database unavailable",
    };
  }

  const trade = await db
    .select()
    .from(trades)
    .where(and(eq(trades.id, tradeId), eq(trades.userId, userId)))
    .limit(1);

  if (!trade || trade.length === 0) {
    return {
      success: false,
      pnl: 0,
      message: "Trade not found",
    };
  }

  const t = trade[0];
  const entryPrice = typeof t.entryPrice === "string" ? parseFloat(t.entryPrice) : t.entryPrice || 0;
  const units = t.units || 0;

  if (!entryPrice || !units) {
    return {
      success: false,
      pnl: 0,
      message: "Invalid trade data",
    };
  }

  const pnl =
    (t.direction === "BUY"
      ? closePrice - entryPrice
      : entryPrice - closePrice) * units;

  await db
    .update(trades)
    .set({
      exitPrice: String(closePrice),
      pnl: String(pnl),
    })
    .where(eq(trades.id, tradeId));

  return {
    success: true,
    pnl,
    message: `Position closed. PnL: ${pnl.toFixed(2)}. Reason: ${reason}`,
  };
}
