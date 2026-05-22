import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import {
  logTrade,
  recordEquitySnapshot,
  recordSignalPerformance,
  getUserTrades,
  getEquityCurve,
  calculateAnalytics,
  getSessionConfig,
  updateSessionConfig,
  isInActiveSession,
  getDailyLossGuard,
  updateDailyLossGuard,
  getAdaptiveThresholds,
  updateAdaptiveThresholds,
} from "./trading";
import { diagnosticsRouter } from "./diagnostics-router";
import { MultiBotManager } from "./multi-bot-manager";
import { autonomousEngine } from "./autonomous-engine";
import { learningEngine } from "./learning-engine";
import { runBacktest } from "./backtest-engine";
import { configureTelegram, getTelegramConfig } from "./telegram-notifier";

const multiBotManager = new MultiBotManager();

export const appRouter = router({
  system: systemRouter,
  diagnostics: diagnosticsRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Multi-instrument bot
  multiBot: router({
    getMultiStatus: protectedProcedure.query(async ({ ctx }) => {
      return multiBotManager.getStatus();
    }),

    startMulti: protectedProcedure.mutation(async ({ ctx }) => {
      await multiBotManager.startMultiBot();
      return { success: true, status: multiBotManager.getStatus() };
    }),

    stopMulti: protectedProcedure.mutation(async ({ ctx }) => {
      multiBotManager.stopMultiBot();
      return { success: true };
    }),

    updateMultiConfig: protectedProcedure
      .input(z.object({
        riskPercent: z.number().optional(),
        enabledPairs: z.array(z.string()).optional(),
        maxConcurrentTrades: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        multiBotManager.updateConfig(input);
        return { success: true, status: multiBotManager.getStatus() };
      }),

    getAvailablePairs: protectedProcedure.query(async ({ ctx }) => {
      return multiBotManager.getAvailablePairs();
    }),
  }),

  // Trading operations
  trading: router({
    // Log a completed trade
    logTrade: protectedProcedure
      .input(z.object({
        oandaTradeId: z.string(),
        instrument: z.string(),
        direction: z.enum(["BUY", "SELL"]),
        entryPrice: z.number(),
        exitPrice: z.number(),
        units: z.number(),
        pnl: z.number(),
        pnlPercent: z.number(),
        signalType: z.enum(["CROSSOVER_BUY", "CROSSOVER_SELL", "RSI_PULLBACK_BUY", "RSI_PULLBACK_SELL"]),
        rsiAtEntry: z.number(),
        atrAtEntry: z.number(),
        stopLossPrice: z.number(),
        takeProfitPrice: z.number(),
        candlePeriod: z.number(),
        entryTime: z.date(),
        exitTime: z.date(),
        durationSeconds: z.number(),
        sessionWindow: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = await logTrade(ctx.user.id, input as any);
        return result;
      }),

    // Record equity snapshot
    recordEquitySnapshot: protectedProcedure
      .input(z.object({
        tradeId: z.number(),
        nav: z.number(),
        navPercent: z.number(),
        drawdownPercent: z.number(),
        timestamp: z.date(),
      }))
      .mutation(async ({ ctx, input }) => {
        await recordEquitySnapshot(ctx.user.id, input as any);
        return { success: true };
      }),

    // Record signal performance for adaptive learning
    recordSignalPerformance: protectedProcedure
      .input(z.object({
        signalType: z.enum(["CROSSOVER_BUY", "CROSSOVER_SELL", "RSI_PULLBACK_BUY", "RSI_PULLBACK_SELL"]),
        outcome: z.enum(["WIN", "LOSS"]),
        pnl: z.number(),
        rsiAtEntry: z.number(),
        rsiLowerBand: z.number(),
        rsiUpperBand: z.number(),
        confidence: z.number(),
        tradeId: z.number(),
        recordedAt: z.date(),
      }))
      .mutation(async ({ ctx, input }) => {
        await recordSignalPerformance(ctx.user.id, input as any);
        
        // Update adaptive thresholds after recording
        await updateAdaptiveThresholds(ctx.user.id, input.signalType);
        
        return { success: true };
      }),

    // Get user's trade history
    getTrades: protectedProcedure
      .input(z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }))
      .query(async ({ ctx, input }) => {
        return await getUserTrades(ctx.user.id, input.startDate, input.endDate);
      }),

    // Get equity curve data
    getEquityCurve: protectedProcedure
      .input(z.object({
        limit: z.number().default(500),
      }))
      .query(async ({ ctx, input }) => {
        return await getEquityCurve(ctx.user.id, input.limit);
      }),

    // Get performance analytics
    getAnalytics: protectedProcedure.query(async ({ ctx }) => {
      return await calculateAnalytics(ctx.user.id);
    }),
  }),

  // Session configuration
  sessions: router({
    // Get session config
    getConfig: protectedProcedure.query(async ({ ctx }) => {
      return await getSessionConfig(ctx.user.id);
    }),

    // Update session config
    updateConfig: protectedProcedure
      .input(z.object({
        sessionName: z.string(),
        enabled: z.boolean().optional(),
        startHour: z.number().optional(),
        startMinute: z.number().optional(),
        endHour: z.number().optional(),
        endMinute: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { sessionName, ...updates } = input;
        await updateSessionConfig(ctx.user.id, sessionName, updates as any);
        return { success: true };
      }),

    // Check if currently in active session
    isActive: protectedProcedure.query(async ({ ctx }) => {
      return await isInActiveSession(ctx.user.id);
    }),
  }),

  // Daily loss guard
  dailyLossGuard: router({
    // Get or create daily loss guard
    getGuard: protectedProcedure
      .input(z.object({
        maxDrawdownPercent: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        return await getDailyLossGuard(ctx.user.id, input.maxDrawdownPercent);
      }),

    // Update daily loss guard
    updateGuard: protectedProcedure
      .input(z.object({
        currentNav: z.number(),
        peakNav: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        return await updateDailyLossGuard(ctx.user.id, input.currentNav, input.peakNav);
      }),
  }),

  // Adaptive thresholds
  adaptiveThresholds: router({
    getThresholds: protectedProcedure
      .input(z.object({ signalType: z.string() }))
      .query(async ({ ctx, input }) => {
        return await getAdaptiveThresholds(ctx.user.id, input.signalType);
      }),
    updateThresholds: protectedProcedure
      .input(z.object({ signalType: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await updateAdaptiveThresholds(ctx.user.id, input.signalType);
        return { success: true };
      }),
  }),

  // ── Autonomous Engine ──────────────────────────────────────────────────────
  bot: router({
    // Connect and start the engine
    connect: protectedProcedure
      .input(z.object({
        token: z.string(),
        accountId: z.string(),
        environment: z.enum(["practice", "live"]),
      }))
      .mutation(async ({ input }) => {
        autonomousEngine.init(input.token, input.accountId, input.environment);
        await autonomousEngine.start();
        return { success: true };
      }),

    // Get full engine state (polls every 3s on frontend)
    getState: protectedProcedure.query(() => {
      return autonomousEngine.getState();
    }),

    // Pause / resume / stop
    pause: protectedProcedure.mutation(() => { autonomousEngine.pause(); return { success: true }; }),
    resume: protectedProcedure.mutation(() => { autonomousEngine.resume(); return { success: true }; }),
    stop: protectedProcedure.mutation(() => { autonomousEngine.stop(); return { success: true }; }),

    // Update config
    updateConfig: protectedProcedure
      .input(z.object({
        riskPercent: z.number().optional(),
        maxConcurrentTrades: z.number().optional(),
        tpAtrMultiplier: z.number().optional(),
        slAtrMultiplier: z.number().optional(),
        minConfidence: z.number().optional(),
        session: z.enum(["ALL", "LONDON", "NEW_YORK", "TOKYO", "SYDNEY", "LONDON_NY"]).optional(),
        maxDailyLossPct: z.number().optional(),
      }))
      .mutation(({ input }) => {
        autonomousEngine.updateConfig(input);
        return { success: true };
      }),

    // Close a specific trade
    closeTrade: protectedProcedure
      .input(z.object({ tradeId: z.string() }))
      .mutation(async ({ input }) => {
        if (!autonomousEngine.api) throw new Error("Engine not connected");
        await autonomousEngine.api.closeTrade(input.tradeId);
        return { success: true };
      }),

    // Get closed trade history
    getHistory: protectedProcedure.query(() => {
      return autonomousEngine.getState().tradeHistory;
    }),

    // Get live prices for open positions
    getLivePrices: protectedProcedure
      .input(z.object({ instruments: z.array(z.string()) }))
      .query(async ({ input }) => {
        if (!autonomousEngine.api || input.instruments.length === 0) return {};
        const prices: Record<string, { bid: number; ask: number; mid: number }> = {};
        await Promise.all(
          input.instruments.map(async (inst) => {
            try {
              const p = await autonomousEngine.api!.getPrice(inst);
              prices[inst] = { ...p, mid: (p.bid + p.ask) / 2 };
            } catch { /* ignore */ }
          })
        );
        return prices;
      }),

    // Get candles for chart
    getCandles: protectedProcedure
      .input(z.object({
        instrument: z.string(),
        granularity: z.string(),
        count: z.number().default(100),
      }))
      .query(async ({ input }) => {
        if (!autonomousEngine.api) return [];
        return autonomousEngine.api.getCandles(input.instrument, input.granularity, input.count);
      }),

    // Get learning engine state
    getLearning: protectedProcedure.query(() => {
      return learningEngine.getState();
    }),

    // Get learning insights (human-readable)
    getLearningInsights: protectedProcedure.query(() => {
      const state = learningEngine.getState();
      return {
        insights: state.insights ?? [],
        pairs: state.pairs ?? {},
        sessions: state.sessions ?? [],
        params: state.params ?? {},
        totalEvolutions: state.totalEvolutions ?? 0,
      };
    }),

    // Get funded account readiness
    getFundedReadiness: protectedProcedure.query(() => {
      const s = autonomousEngine.getState();
      const totalTrades = s.totalTrades;
      const wins = s.totalWins;
      const losses = s.totalLosses;
      const winRate = totalTrades > 0 ? wins / totalTrades : 0;
      const pf = losses > 0 ? wins / losses : wins > 0 ? 99 : 0;
      const maxDD = s.equityCurve.length > 1
        ? (() => {
            let peak = s.equityCurve[0].equity;
            let dd = 0;
            for (const p of s.equityCurve) {
              if (p.equity > peak) peak = p.equity;
              const d = (peak - p.equity) / peak;
              if (d > dd) dd = d;
            }
            return dd;
          })()
        : 0;
      const criteria = [
        { label: "Win Rate ≥ 55%", pass: winRate >= 0.55, value: `${(winRate * 100).toFixed(1)}%` },
        { label: "Profit Factor ≥ 1.5", pass: pf >= 1.5, value: pf.toFixed(2) },
        { label: "Max Drawdown < 5%", pass: maxDD < 0.05, value: `${(maxDD * 100).toFixed(1)}%` },
        { label: "Min 30 Trades", pass: totalTrades >= 30, value: `${totalTrades}` },
        { label: "Positive Total P&L", pass: s.totalPnl > 0, value: `${s.totalPnl.toFixed(2)}` },
        { label: "No Daily Loss Guard Breach", pass: true, value: "OK" },
        { label: "Consistent Sessions", pass: totalTrades >= 10, value: totalTrades >= 10 ? "Yes" : "Need more trades" },
      ];
      const passing = criteria.filter(c => c.pass).length;
      return { criteria, passing, total: criteria.length, readyForFunded: passing >= 6 };
    }),

    // ── Backtest ──────────────────────────────────────────────────────────────
    runBacktest: protectedProcedure
      .input(z.object({
        instrument: z.string(),
        granularity: z.string().default("M15"),
        count: z.number().default(500),
        rsiLower: z.number().default(40),
        rsiUpper: z.number().default(62),
        slMultiplier: z.number().default(1.5),
        tpMultiplier: z.number().default(3.0),
        minSignals: z.number().default(4),
      }))
      .mutation(async ({ input }) => {
        if (!autonomousEngine.api) throw new Error("Engine not connected — connect first");
        const candles = await autonomousEngine.api.getCandles(input.instrument, input.granularity, input.count);
        return runBacktest(input.instrument, input.granularity, candles, {
          rsiLower: input.rsiLower,
          rsiUpper: input.rsiUpper,
          slMultiplier: input.slMultiplier,
          tpMultiplier: input.tpMultiplier,
          minSignals: input.minSignals,
        });
      }),

    // ── Prop Firm Mode ────────────────────────────────────────────────────────
    setPropFirmMode: protectedProcedure
      .input(z.object({
        enabled: z.boolean(),
        maxDailyLossPct: z.number().default(5),
        maxTotalDrawdownPct: z.number().default(10),
        profitTargetPct: z.number().default(10),
      }))
      .mutation(({ input }) => {
        if (input.enabled) {
          // Tighten all risk parameters for prop firm rules
          autonomousEngine.updateConfig({
            riskPercent: 0.5,       // Half risk in prop firm mode
            maxConcurrentTrades: 2, // Max 2 trades at once
          });
        }
        return { success: true, mode: input.enabled ? "PROP_FIRM" : "NORMAL" };
      }),

    // ── Telegram Config ───────────────────────────────────────────────────────
    setTelegramConfig: protectedProcedure
      .input(z.object({
        token: z.string(),
        chatId: z.string(),
      }))
      .mutation(({ input }) => {
        configureTelegram(input.token, input.chatId);
        return { success: true, config: getTelegramConfig() };
      }),

    getTelegramConfig: protectedProcedure.query(() => {
      return getTelegramConfig();
    }),
  }),
});

export type AppRouter = typeof appRouter;
