import { eq, and, desc, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  trades,
  equitySnapshots,
  signalPerformance,
  sessionConfig,
  dailyLossGuard,
  adaptiveThresholds,
  InsertTrade,
  InsertEquitySnapshot,
  InsertSignalPerformance,
  InsertSessionConfig,
  InsertDailyLossGuard,
  InsertAdaptiveThreshold,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

/**
 * Log a completed trade to the database
 */
export async function logTrade(userId: number, trade: InsertTrade) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(trades).values({
    ...trade,
    userId,
  } as any);
  
  return result;
}

/**
 * Record an equity snapshot after trade close
 */
export async function recordEquitySnapshot(userId: number, snapshot: InsertEquitySnapshot) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(equitySnapshots).values({
    ...snapshot,
    userId,
  } as any);
}

/**
 * Record signal performance for adaptive learning
 */
export async function recordSignalPerformance(userId: number, performance: InsertSignalPerformance) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(signalPerformance).values({
    ...performance,
    userId,
  } as any);
}

/**
 * Get all trades for a user within a date range
 */
export async function getUserTrades(userId: number, startDate?: Date, endDate?: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const conditions = [eq(trades.userId, userId)];
  if (startDate) conditions.push(gte(trades.entryTime, startDate));
  if (endDate) conditions.push(lte(trades.entryTime, endDate));
  
  return db
    .select()
    .from(trades)
    .where(and(...conditions))
    .orderBy(desc(trades.entryTime));
}

/**
 * Get equity curve data for a user
 */
export async function getEquityCurve(userId: number, limit = 500) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return db
    .select()
    .from(equitySnapshots)
    .where(eq(equitySnapshots.userId, userId))
    .orderBy(equitySnapshots.timestamp)
    .limit(limit);
}

/**
 * Calculate analytics from trade history
 */
export async function calculateAnalytics(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const userTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.userId, userId));
  
  if (userTrades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      totalPnL: 0,
      bestTrade: null,
      worstTrade: null,
      averageRR: 0,
      bySignalType: {},
    };
  }
  
  const wins = userTrades.filter(t => parseFloat(t.pnl.toString()) > 0);
  const losses = userTrades.filter(t => parseFloat(t.pnl.toString()) < 0);
  
  const winRate = (wins.length / userTrades.length) * 100;
  const totalWins = wins.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0);
  const totalLosses = Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
  const totalPnL = userTrades.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0);
  
  const bestTrade = userTrades.reduce((best, t) => {
    const pnl = parseFloat(t.pnl.toString());
    return pnl > parseFloat(best.pnl.toString()) ? t : best;
  });
  
  const worstTrade = userTrades.reduce((worst, t) => {
    const pnl = parseFloat(t.pnl.toString());
    return pnl < parseFloat(worst.pnl.toString()) ? t : worst;
  });
  
  // Calculate average risk/reward
  const avgRR = userTrades.reduce((sum, t) => {
    const sl = Math.abs(parseFloat(t.stopLossPrice.toString()) - parseFloat(t.entryPrice.toString()));
    const tp = Math.abs(parseFloat(t.takeProfitPrice.toString()) - parseFloat(t.entryPrice.toString()));
    return sum + (sl > 0 ? tp / sl : 0);
  }, 0) / userTrades.length;
  
  // Break down by signal type
  const bySignalType: Record<string, any> = {};
  const signalTypes = ["CROSSOVER_BUY", "CROSSOVER_SELL", "RSI_PULLBACK_BUY", "RSI_PULLBACK_SELL"];
  
  for (const sigType of signalTypes) {
    const sigTrades = userTrades.filter(t => t.signalType === sigType);
    if (sigTrades.length > 0) {
      const sigWins = sigTrades.filter(t => parseFloat(t.pnl.toString()) > 0);
      const sigWinRate = (sigWins.length / sigTrades.length) * 100;
      const sigPnL = sigTrades.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0);
      
      bySignalType[sigType] = {
        count: sigTrades.length,
        winRate: sigWinRate,
        totalPnL: sigPnL,
      };
    }
  }
  
  return {
    totalTrades: userTrades.length,
    winRate,
    profitFactor,
    totalPnL,
    bestTrade,
    worstTrade,
    averageRR: avgRR,
    bySignalType,
  };
}

/**
 * Get or create session config for a user
 */
export async function getSessionConfig(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const configs = await db
    .select()
    .from(sessionConfig)
    .where(eq(sessionConfig.userId, userId));
  
  // If no configs exist, create defaults
  if (configs.length === 0) {
    const defaults: InsertSessionConfig[] = [
      {
        userId,
        sessionName: "LONDON",
        enabled: true,
        startHour: 8,
        startMinute: 0,
        endHour: 16,
        endMinute: 30,
        description: "London trading session (UTC)",
      },
      {
        userId,
        sessionName: "NEW_YORK",
        enabled: true,
        startHour: 13,
        startMinute: 30,
        endHour: 21,
        endMinute: 0,
        description: "New York trading session (UTC)",
      },
      {
        userId,
        sessionName: "TOKYO",
        enabled: true,
        startHour: 0,
        startMinute: 0,
        endHour: 8,
        endMinute: 30,
        description: "Tokyo trading session (UTC)",
      },
      {
        userId,
        sessionName: "SYDNEY",
        enabled: true,
        startHour: 22,
        startMinute: 0,
        endHour: 6,
        endMinute: 0,
        description: "Sydney trading session (UTC)",
      },
    ];
    
    await db.insert(sessionConfig).values(defaults);
    return defaults;
  }
  
  return configs;
}

/**
 * Update session config
 */
export async function updateSessionConfig(userId: number, sessionName: string, updates: Partial<InsertSessionConfig>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(sessionConfig)
    .set(updates)
    .where(and(eq(sessionConfig.userId, userId), eq(sessionConfig.sessionName, sessionName as any)));
}

/**
 * Check if current time is within an active session
 */
export async function isInActiveSession(userId: number): Promise<boolean> {
  const configs = await getSessionConfig(userId);
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  
  for (const config of configs) {
    if (!config.enabled) continue;
    
    const startTime = config.startHour * 60 + (config.startMinute ?? 0);
    const endTime = config.endHour * 60 + (config.endMinute ?? 0);
    const currentTime = utcHour * 60 + utcMinute;
    
    // Handle sessions that wrap around midnight (e.g., Sydney)
    if (startTime > endTime) {
      if (currentTime >= startTime || currentTime < endTime) return true;
    } else {
      if (currentTime >= startTime && currentTime < endTime) return true;
    }
  }
  
  return false;
}

/**
 * Get or create daily loss guard for today
 */
export async function getDailyLossGuard(userId: number, maxDrawdownPercent: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const today = new Date().toISOString().split("T")[0];
  
  const existing = await db
    .select()
    .from(dailyLossGuard)
    .where(and(eq(dailyLossGuard.userId, userId), eq(dailyLossGuard.date, today)))
    .limit(1);
  
  if (existing.length > 0) {
    return existing[0];
  }
  
  // Create new daily guard
  const guard: InsertDailyLossGuard = {
    userId,
    date: today,
    maxDrawdownPercent: maxDrawdownPercent.toString() as any,
    currentDrawdownPercent: '0.0000' as any,
    isPaused: false,
    initialNav: 0 as any,
    peakNav: 0 as any,
  };
  
  await db.insert(dailyLossGuard).values(guard);
  return guard;
}

/**
 * Update daily loss guard drawdown and check if paused
 */
export async function updateDailyLossGuard(
  userId: number,
  currentNav: number,
  peakNav: number
): Promise<{ isPaused: boolean; drawdownPercent: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const today = new Date().toISOString().split("T")[0];
  
  const guard = await db
    .select()
    .from(dailyLossGuard)
    .where(and(eq(dailyLossGuard.userId, userId), eq(dailyLossGuard.date, today)))
    .limit(1);
  
  if (guard.length === 0) {
    return { isPaused: false, drawdownPercent: 0 };
  }
  
  const drawdownPercent = ((peakNav - currentNav) / peakNav) * 100;
  const maxDrawdown = parseFloat(guard[0].maxDrawdownPercent.toString());
  const shouldPause = drawdownPercent >= maxDrawdown;
  
  await db
    .update(dailyLossGuard)
    .set({
      currentDrawdownPercent: drawdownPercent.toString() as any,
      isPaused: shouldPause,
      pausedAt: shouldPause ? new Date() : null,
    })
    .where(eq(dailyLossGuard.id, guard[0].id));
  
  return { isPaused: shouldPause, drawdownPercent };
}

/**
 * Get adaptive thresholds for a signal type
 */
export async function getAdaptiveThresholds(userId: number, signalType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const existing = await db
    .select()
    .from(adaptiveThresholds)
    .where(and(eq(adaptiveThresholds.userId, userId), eq(adaptiveThresholds.signalType, signalType as any)))
    .limit(1);
  
  if (existing.length > 0) {
    return existing[0];
  }
  
  // Create default thresholds
  const defaults: InsertAdaptiveThreshold = {
    userId,
    signalType: signalType as any,
    rsiLowerBand: (signalType.includes("BUY") ? 25 : 60).toString() as any,
    rsiUpperBand: (signalType.includes("BUY") ? 40 : 75).toString() as any,
    confidenceThreshold: 60,
    winRate: '0.00' as any,
    lastUpdated: new Date(),
  };
  
  await db.insert(adaptiveThresholds).values(defaults);
  return defaults;
}

/**
 * Update adaptive thresholds based on recent performance
 */
export async function updateAdaptiveThresholds(userId: number, signalType: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get recent signal performance (last 20 trades)
  const recentPerformance = await db
    .select()
    .from(signalPerformance)
    .where(and(eq(signalPerformance.userId, userId), eq(signalPerformance.signalType, signalType as any)))
    .orderBy(desc(signalPerformance.recordedAt))
    .limit(20);
  
  if (recentPerformance.length === 0) return;
  
  const wins = recentPerformance.filter(p => p.outcome === "WIN");
  const winRate = (wins.length / recentPerformance.length) * 100;
  
  // Adjust RSI bands based on winning trades
  if (wins.length > 0) {
    const avgWinRsi = wins.reduce((sum, p) => sum + parseFloat(p.rsiAtEntry.toString()), 0) / wins.length;
    const avgWinLower = wins.reduce((sum, p) => sum + parseFloat(p.rsiLowerBand.toString()), 0) / wins.length;
    const avgWinUpper = wins.reduce((sum, p) => sum + parseFloat(p.rsiUpperBand.toString()), 0) / wins.length;
    
    // Tighten bands around winning RSI levels (move 10% towards the average winning RSI)
    const newLower = avgWinLower * 0.9 + avgWinRsi * 0.1;
    const newUpper = avgWinUpper * 0.9 + avgWinRsi * 0.1;
    
    // Adjust confidence based on win rate
    const newConfidence = Math.min(95, Math.max(40, Math.round(winRate * 1.2)));
    
    await db
      .update(adaptiveThresholds)
      .set({
        rsiLowerBand: newLower.toString() as any,
        rsiUpperBand: newUpper.toString() as any,
        confidenceThreshold: newConfidence,
        winRate: winRate.toString() as any,
        lastUpdated: new Date(),
      })
      .where(and(eq(adaptiveThresholds.userId, userId), eq(adaptiveThresholds.signalType, signalType as any)));
  }
}
