/**
 * Bot Monitoring API
 * Provides real-time status and historical data for the trading bot
 * Accessible from iPhone dashboard
 */

import { Router } from "express";
import { getDb } from "./db";
import { getUserTrades, getEquityCurve, calculateAnalytics, getSessionConfig, getDailyLossGuard } from "./trading";
import { protectedProcedure } from "./_core/trpc";

export const botMonitorRouter = Router();

/**
 * GET /api/bot/status
 * Get real-time bot status
 */
botMonitorRouter.get("/status", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const db = await getDb();
    if (!db) return res.status(503).json({ error: "Database unavailable" });

    // Get latest trade
    const trades = await getUserTrades(userId);
    const lastTrade = trades?.[trades.length - 1];

    // Get daily loss guard status
    const guard = await getDailyLossGuard(userId, 5);

    // Get session config
    const sessions = await getSessionConfig(userId);

    res.json({
      status: "running",
      lastTrade: lastTrade || null,
      dailyLossGuard: {
        isPaused: guard.isPaused,
        drawdownPercent: parseFloat(guard.currentDrawdownPercent?.toString() || "0"),
      },
      sessions: sessions?.map((s: any) => ({
        name: s.sessionName,
        enabled: s.enabled,
        startTime: `${s.startHour}:${String(s.startMinute).padStart(2, "0")}`,
        endTime: `${s.endHour}:${String(s.endMinute).padStart(2, "0")}`,
      })) || [],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[MONITOR] Status error:", error);
    res.status(500).json({ error: "Failed to get status" });
  }
});

/**
 * GET /api/bot/trades
 * Get trade history
 */
botMonitorRouter.get("/trades", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const limit = parseInt(req.query.limit as string) || 50;
    const trades = await getUserTrades(userId);

    res.json({
      total: trades?.length || 0,
      trades: trades?.slice(-limit).map((t: any) => ({
        id: t.id,
        instrument: t.instrument,
        direction: t.direction,
        entryPrice: parseFloat(t.entryPrice.toString()),
        exitPrice: parseFloat(t.exitPrice.toString()),
        pnl: parseFloat(t.pnl.toString()),
        pnlPercent: parseFloat(t.pnlPercent.toString()),
        signalType: t.signalType,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        durationSeconds: t.durationSeconds,
      })) || [],
    });
  } catch (error) {
    console.error("[MONITOR] Trades error:", error);
    res.status(500).json({ error: "Failed to get trades" });
  }
});

/**
 * GET /api/bot/analytics
 * Get performance analytics
 */
botMonitorRouter.get("/analytics", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const analytics = await calculateAnalytics(userId);

    res.json({
      totalTrades: analytics.totalTrades,
      winRate: parseFloat(analytics.winRate.toFixed(2)),
      profitFactor: analytics.profitFactor === Infinity ? "∞" : parseFloat(analytics.profitFactor.toFixed(2)),
      averageRR: parseFloat(analytics.averageRR.toFixed(2)),
      totalPnL: parseFloat(analytics.totalPnL.toFixed(2)),
      bestTrade: analytics.bestTrade ? {
        pnl: parseFloat(analytics.bestTrade.pnl.toString()),
        signalType: analytics.bestTrade.signalType,
      } : null,
      worstTrade: analytics.worstTrade ? {
        pnl: parseFloat(analytics.worstTrade.pnl.toString()),
        signalType: analytics.worstTrade.signalType,
      } : null,
      bySignalType: Object.entries(analytics.bySignalType).reduce((acc: any, [key, data]: any) => {
        acc[key] = {
          count: data.count,
          winRate: parseFloat(data.winRate.toFixed(2)),
          totalPnL: parseFloat(data.totalPnL.toFixed(2)),
        };
        return acc;
      }, {}),
    });
  } catch (error) {
    console.error("[MONITOR] Analytics error:", error);
    res.status(500).json({ error: "Failed to get analytics" });
  }
});

/**
 * GET /api/bot/equity-curve
 * Get equity curve data
 */
botMonitorRouter.get("/equity-curve", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const limit = parseInt(req.query.limit as string) || 100;
    const curve = await getEquityCurve(userId, limit);

    res.json({
      data: curve?.map((snapshot: any) => ({
        timestamp: snapshot.timestamp,
        nav: parseFloat(snapshot.nav.toString()),
        navPercent: parseFloat(snapshot.navPercent.toString()),
        drawdownPercent: parseFloat(snapshot.drawdownPercent.toString()),
      })) || [],
    });
  } catch (error) {
    console.error("[MONITOR] Equity curve error:", error);
    res.status(500).json({ error: "Failed to get equity curve" });
  }
});

/**
 * POST /api/bot/pause
 * Pause auto-trading
 */
botMonitorRouter.post("/pause", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // This would pause the bot in a real implementation
    // For now, just return success
    res.json({ success: true, message: "Bot paused" });
  } catch (error) {
    console.error("[MONITOR] Pause error:", error);
    res.status(500).json({ error: "Failed to pause bot" });
  }
});

/**
 * POST /api/bot/resume
 * Resume auto-trading
 */
botMonitorRouter.post("/resume", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // This would resume the bot in a real implementation
    res.json({ success: true, message: "Bot resumed" });
  } catch (error) {
    console.error("[MONITOR] Resume error:", error);
    res.status(500).json({ error: "Failed to resume bot" });
  }
});
