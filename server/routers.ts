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

export const appRouter = router({
  system: systemRouter,
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
    // Get thresholds for a signal type
    getThresholds: protectedProcedure
      .input(z.object({
        signalType: z.string(),
      }))
      .query(async ({ ctx, input }) => {
        return await getAdaptiveThresholds(ctx.user.id, input.signalType);
      }),

    // Update thresholds
    updateThresholds: protectedProcedure
      .input(z.object({
        signalType: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        await updateAdaptiveThresholds(ctx.user.id, input.signalType);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
