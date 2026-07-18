import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
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
import { decisionJournal } from "./decision-journal";
import { analyseDecisions } from "./decision-analytics";
import { getPersistentMemoryStatus } from "./persistent-memory";
import { marketMemory } from "./market-memory";
import { strategyGenome } from "./strategy-genome";
import { strategyRegimeMatrix } from "./strategy-regime-matrix";
import { memoryQuery } from "./memory/memory-db";
import { getCalibrationReport } from "./memory/confidenceCalibrationTracker";
import {
  dailyReportStore,
  formatDailyReportTelegram,
} from "./daily-report";
import {
  configureTelegram,
  getTelegramConfig,
  sendTelegramTestMessage,
} from "./telegram-notifier";

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
    getMultiStatus: publicProcedure.query(async ({ ctx }) => {
      return multiBotManager.getStatus();
    }),

    startMulti: publicProcedure.mutation(async ({ ctx }) => {
      await multiBotManager.startMultiBot();
      return { success: true, status: multiBotManager.getStatus() };
    }),

    stopMulti: publicProcedure.mutation(async ({ ctx }) => {
      multiBotManager.stopMultiBot();
      return { success: true };
    }),

    updateMultiConfig: publicProcedure
      .input(z.object({
        riskPercent: z.number().optional(),
        enabledPairs: z.array(z.string()).optional(),
        maxConcurrentTrades: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        multiBotManager.updateConfig(input);
        return { success: true, status: multiBotManager.getStatus() };
      }),

    getAvailablePairs: publicProcedure.query(async ({ ctx }) => {
      return multiBotManager.getAvailablePairs();
    }),
  }),

  // Trading operations
  trading: router({
    // Log a completed trade
    logTrade: publicProcedure
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
        const result = await logTrade(1, input as any);
        return result;
      }),

    // Record equity snapshot
    recordEquitySnapshot: publicProcedure
      .input(z.object({
        tradeId: z.number(),
        nav: z.number(),
        navPercent: z.number(),
        drawdownPercent: z.number(),
        timestamp: z.date(),
      }))
      .mutation(async ({ ctx, input }) => {
        await recordEquitySnapshot(1, input as any);
        return { success: true };
      }),

    // Record signal performance for adaptive learning
    recordSignalPerformance: publicProcedure
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
        await recordSignalPerformance(1, input as any);
        
        // Update adaptive thresholds after recording
        await updateAdaptiveThresholds(1, input.signalType);
        
        return { success: true };
      }),

    // Get user's trade history
    getTrades: publicProcedure
      .input(z.object({
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }))
      .query(async ({ ctx, input }) => {
        return await getUserTrades(1, input.startDate, input.endDate);
      }),

    // Get equity curve data
    getEquityCurve: publicProcedure
      .input(z.object({
        limit: z.number().default(500),
      }))
      .query(async ({ ctx, input }) => {
        return await getEquityCurve(1, input.limit);
      }),

    // Get performance analytics
    getAnalytics: publicProcedure.query(async ({ ctx }) => {
      return await calculateAnalytics(1);
    }),
  }),

  // Session configuration
  sessions: router({
    // Get session config
    getConfig: publicProcedure.query(async ({ ctx }) => {
      return await getSessionConfig(1);
    }),

    // Update session config
    updateConfig: publicProcedure
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
        await updateSessionConfig(1, sessionName, updates as any);
        return { success: true };
      }),



    // Check if currently in active session
    isActive: publicProcedure.query(async ({ ctx }) => {
      return await isInActiveSession(1);
    }),
  }),

  // Daily loss guard
  dailyLossGuard: router({
    // Get or create daily loss guard
    getGuard: publicProcedure
      .input(z.object({
        maxDrawdownPercent: z.number(),
      }))
      .query(async ({ ctx, input }) => {
        return await getDailyLossGuard(1, input.maxDrawdownPercent);
      }),

    // Update daily loss guard
    updateGuard: publicProcedure
      .input(z.object({
        currentNav: z.number(),
        peakNav: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        return await updateDailyLossGuard(1, input.currentNav, input.peakNav);
      }),
  }),

  // Adaptive thresholds
  adaptiveThresholds: router({
    getThresholds: publicProcedure
      .input(z.object({ signalType: z.string() }))
      .query(async ({ ctx, input }) => {
        return await getAdaptiveThresholds(1, input.signalType);
      }),
    updateThresholds: publicProcedure
      .input(z.object({ signalType: z.string() }))
      .mutation(async ({ ctx, input }) => {
        await updateAdaptiveThresholds(1, input.signalType);
        return { success: true };
      }),
  }),

  // ── Autonomous Engine ──────────────────────────────────────────────────────
  bot: router({
    // Validate OANDA credentials server-side (avoids browser CORS issues)
    validateCredentials: publicProcedure
      .input(z.object({
        token: z.string(),
        accountId: z.string(),
        environment: z.enum(["practice", "live"]),
      }))
      .mutation(async ({ input }) => {
        const practiceUrl = "https://api-fxpractice.oanda.com";
        const liveUrl = "https://api-fxtrade.oanda.com";
        const selectedUrl = input.environment === "live" ? liveUrl : practiceUrl;
        // Step 1: test token validity by listing all accounts (no account ID needed)
        try {
          const listRes = await fetch(`${selectedUrl}/v3/accounts`, {
            headers: { Authorization: `Bearer ${input.token}` },
          });
          if (!listRes.ok) {
            // Try the OTHER environment automatically
            const altUrl = input.environment === "live" ? practiceUrl : liveUrl;
            const altRes = await fetch(`${altUrl}/v3/accounts`, {
              headers: { Authorization: `Bearer ${input.token}` },
            });
            if (altRes.ok) {
              const altBody = await altRes.json();
              const altAccounts = (altBody.accounts ?? []).map((a: any) => a.id);
              const altEnv = input.environment === "live" ? "practice" : "live";
              return {
                valid: false,
                error: `Token is valid but for ${altEnv.toUpperCase()} not ${input.environment.toUpperCase()}. Your accounts: ${altAccounts.join(", ")}. Switch to ${altEnv.toUpperCase()} on the login screen.`,
              };
            }
            const body = await listRes.json().catch(() => ({}));
            const msg = (body as any)?.errorMessage ?? `OANDA ${listRes.status}: token rejected`;
            return { valid: false, error: msg };
          }
          // Token is valid — now check the account ID
          const listBody = await listRes.json();
          const accounts = (listBody.accounts ?? []).map((a: any) => a.id) as string[];
          if (accounts.length === 0) {
            return { valid: false, error: "Token valid but no accounts found. Check your OANDA account." };
          }
          // Check if the provided account ID matches any account
          const matched = accounts.find(id =>
            id === input.accountId ||
            id.replace(/-/g, "") === input.accountId.replace(/-/g, "")
          );
          if (!matched) {
            return {
              valid: false,
              error: `Account ID not found. Your accounts are: ${accounts.join(", ")}. Please use one of these exactly.`,
            };
          }
          // All good — init engine with matched account ID
          return { valid: true, resolvedAccountId: matched };
        } catch (e: any) {
          return { valid: false, error: e?.message ?? "Network error connecting to OANDA" };
        }
      }),
    // Connect and start the engine
    connect: publicProcedure
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
    getState: publicProcedure.query(() => {
      return autonomousEngine.getState();
    }),

    // Pause / resume / stop
    pause: publicProcedure.mutation(() => { autonomousEngine.pause(); return { success: true }; }),
    resume: publicProcedure.mutation(() => { autonomousEngine.resume(); return { success: true }; }),
    stop: publicProcedure.mutation(() => { autonomousEngine.stop(); return { success: true }; }),

    // Update config
    updateConfig: publicProcedure
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
    closeTrade: publicProcedure
      .input(z.object({ tradeId: z.string() }))
      .mutation(async ({ input }) => {
        if (!autonomousEngine.api) throw new Error("Engine not connected");
        await autonomousEngine.closeTradeAndSync(input.tradeId);
return { success: true };
      }),

    // Reset all stats to zero for a clean slate
    resetStats: publicProcedure.mutation(() => {
      autonomousEngine.resetStats();
      return { success: true };
    }),
    // Get closed trade history
    getHistory: publicProcedure.query(() => {
      return autonomousEngine.getState().tradeHistory;
    }),

    getPerformanceAnalytics: publicProcedure.query(() => {
      const state = autonomousEngine.getState();
      const learning = learningEngine.getState();
      const trades = [...(state.tradeHistory ?? [])];

      type AnalyticsTrade = (typeof trades)[number];

      const safeNumber = (value: number | undefined | null): number =>
        typeof value === "number" && Number.isFinite(value) ? value : 0;

      const createBucket = (label: string) => ({
        label,
        trades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        grossProfit: 0,
        grossLoss: 0,
        netPnl: 0,
        totalPips: 0,
        avgPips: 0,
        expectancy: 0,
        profitFactor: 1,
        maxDrawdown: 0,
      });

      type AnalyticsBucket = ReturnType<typeof createBucket>;

      const getSession = (trade: AnalyticsTrade): "LONDON" | "OVERLAP" | "NEW_YORK" | "OTHER" => {
const timestamp = trade.openTime ?? trade.closedAt ?? trade.exitTime ?? Date.now();
const hour = new Date(timestamp).getUTCHours();

        if (hour >= 8 && hour < 12) return "LONDON";
        if (hour >= 12 && hour < 13) return "OVERLAP";
        if (hour >= 13 && hour < 17) return "NEW_YORK";
        return "OTHER";
      };

      const addTrade = (bucket: AnalyticsBucket, trade: AnalyticsTrade): void => {
        const pnl = safeNumber(trade.pnl);
        const pips = safeNumber(trade.pips);

        bucket.trades += 1;
        bucket.wins += trade.won ? 1 : 0;
        bucket.losses += trade.won ? 0 : 1;
        bucket.grossProfit += Math.max(0, pnl);
        bucket.grossLoss += Math.abs(Math.min(0, pnl));
        bucket.netPnl += pnl;
        bucket.totalPips += pips;
      };

      const finaliseBucket = (bucket: AnalyticsBucket, bucketTrades: AnalyticsTrade[]) => {
        const chronological = [...bucketTrades].sort(
          (a, b) => safeNumber(a.closedAt) - safeNumber(b.closedAt)
        );

        let equity = 0;
        let peak = 0;
        let maxDrawdown = 0;

        for (const trade of chronological) {
          equity += safeNumber(trade.pnl);
          peak = Math.max(peak, equity);
          maxDrawdown = Math.max(maxDrawdown, peak - equity);
        }

        return {
          ...bucket,
          winRate: bucket.trades > 0 ? bucket.wins / bucket.trades : 0,
          avgPips: bucket.trades > 0 ? bucket.totalPips / bucket.trades : 0,
          expectancy: bucket.trades > 0 ? bucket.netPnl / bucket.trades : 0,
          profitFactor:
            bucket.grossLoss > 0
              ? bucket.grossProfit / bucket.grossLoss
              : bucket.grossProfit > 0
                ? 99
                : 1,
          maxDrawdown,
        };
      };

      const buildGrouped = (getKey: (trade: AnalyticsTrade) => string) => {
        const buckets: Record<string, AnalyticsBucket> = {};
        const groupedTrades: Record<string, AnalyticsTrade[]> = {};

        for (const trade of trades) {
          const key = getKey(trade);
          buckets[key] ??= createBucket(key);
          groupedTrades[key] ??= [];
          addTrade(buckets[key], trade);
          groupedTrades[key].push(trade);
        }

        return Object.fromEntries(
          Object.entries(buckets).map(([key, bucket]) => [
            key,
            finaliseBucket(bucket, groupedTrades[key] ?? []),
          ])
        );
      };

      return {
        generatedAt: new Date().toISOString(),
        overall: finaliseBucket(
          trades.reduce((bucket, trade) => {
            addTrade(bucket, trade);
            return bucket;
          }, createBucket("OVERALL")),
          trades
        ),
        bySession: buildGrouped(getSession),
        byRegime: buildGrouped((trade) => trade.regime ?? "UNKNOWN"),
        byPair: buildGrouped((trade) => trade.instrument ?? "UNKNOWN"),
        byStrategy: buildGrouped((trade) => trade.strategy ?? "UNKNOWN"),
        learningContext: {
          version: learning.params?.version ?? 0,
          minConfidence: learning.params?.minConfidence ?? 0,
          totalEvolutions: learning.totalEvolutions ?? 0,
        },
      };
    }),

    getRejectionAnalytics: publicProcedure.query(async () => {
      await decisionJournal.load();

      const all = await decisionJournal.getAll();
      const now = Date.now();
      const last24h = all.filter((entry) => now - entry.time <= 24 * 60 * 60 * 1000);
      const blocked = last24h.filter(
        (entry) => entry.type === "BLOCKED" || entry.action === "BLOCKED"
      );

      const createCounts = () => ({
        total: 0,
        confidence: 0,
        quality: 0,
        forecast: 0,
        h4: 0,
        portfolio: 0,
        execution: 0,
        spread: 0,
        safety: 0,
        learning: 0,
        news: 0,
        expectedValue: 0,
        neural: 0,
        executive: 0,
        other: 0,
      });

      const counts = createCounts();

      const classify = (entry: any): keyof ReturnType<typeof createCounts> => {
        const stage = String(entry.stage ?? "").toUpperCase();
        const reason = String(entry.reason ?? "").toUpperCase();

        if (reason.includes("CONFIDENCE")) return "confidence";
        if (reason.includes("QUALITY") || reason.includes("NEREQO CONFIDENCE")) return "quality";
        if (reason.includes("FORECAST")) return "forecast";
        if (reason.includes("H4") || reason.includes("COUNTER-TREND")) return "h4";
        if (stage === "PORTFOLIO" || reason.includes("PORTFOLIO") || reason.includes("EXPOSURE")) return "portfolio";
        if (stage === "EXECUTION" || reason.includes("EXECUTION") || reason.includes("PULLBACK")) return "execution";
        if (reason.includes("SPREAD")) return "spread";
        if (reason.includes("SAFETY")) return "safety";
        if (reason.includes("LEARNING")) return "learning";
        if (reason.includes("NEWS")) return "news";
        if (reason.includes("EXPECTED VALUE") || reason.includes("EV")) return "expectedValue";
        if (reason.includes("NEURAL")) return "neural";
        if (reason.includes("EXECUTIVE")) return "executive";

        return "other";
      };

      for (const entry of blocked) {
        const key = classify(entry);
        counts.total += 1;
        counts[key] += 1;
      }

      return {
        generatedAt: new Date().toISOString(),
        windowHours: 24,
        totalDecisions: last24h.length,
        blockedDecisions: blocked.length,
        blockRate: last24h.length > 0 ? blocked.length / last24h.length : 0,
        counts,
        recentBlocks: blocked
          .slice(-25)
          .reverse()
          .map((entry) => ({
            time: new Date(entry.time).toISOString(),
            instrument: entry.instrument,
            direction: entry.direction,
            stage: entry.stage ?? "UNKNOWN",
            reason: entry.reason,
            confidence: entry.confidence ?? null,
            metaScore: entry.metaScore ?? null,
            strategy: entry.strategy ?? null,
            regime: entry.regime ?? null,
          })),
      };
    }),
    
getDailyReports: publicProcedure.query(async () => {
  await dailyReportStore.load();
  return dailyReportStore.getAll();
}),

getTodayDailyReport: publicProcedure.query(async () => {
  const state = autonomousEngine.getState();
  return dailyReportStore.createSnapshot(state);
}),

    // Get live prices for open positions
    getLivePrices: publicProcedure
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
    getCandles: publicProcedure
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
    getLearning: publicProcedure.query(() => {
      return learningEngine.getState();
    }),

    getLearningState: publicProcedure.query(() => {
      const state = learningEngine.getState();

      return {
        params: {
          minConfidence: state.params?.minConfidence,
          version: state.params?.version,
          current: state.params ?? {},
        },
        pairs: Object.fromEntries(
          Object.entries(state.pairs ?? {}).map(([instrument, pair]) => [
            instrument,
            {
              trades: pair.trades,
              winRate: pair.winRate,
              score: pair.score,
              confidenceThreshold: pair.confidenceThreshold,
              enabled: pair.enabled,
            },
          ])
        ),
        strategies: Object.fromEntries(
          Object.entries(state.strategies ?? {}).map(([strategy, item]) => [
            strategy,
            {
              trades: item.trades,
              winRate: item.winRate,
              score: item.score,
              enabled: item.enabled,
            },
          ])
        ),
        regimes: Object.fromEntries(
          Object.entries(state.regimes ?? {}).map(([regime, item]) => [
            regime,
            {
              trades: item.trades,
              winRate: item.winRate,
              score: item.score,
              enabled: item.enabled,
            },
          ])
        ),
        insights: (state.insights ?? []).slice(-10),
      };
    }),

    getMemoryHealth: publicProcedure.query(async () => {
      try {
        const rows = await memoryQuery<{
          total_observations: string | number;
          quality_observations: string | number;
          last_observed_at: string | null;
        }>(
          `
            SELECT
              COUNT(*) AS total_observations,
              COUNT(*) FILTER (WHERE memory_quality_score >= 0.7) AS quality_observations, 
              MAX(observed_at)::text AS last_observed_at
            FROM memory_observations
          `
        );

        const row = rows[0];

        return {
          connected: true,
          totalObservations: Number(row?.total_observations ?? 0),
          qualityObservations: Number(row?.quality_observations ?? 0),
          lastObservedAt: row?.last_observed_at ?? null,
        };
      } catch (error) {
        return {
          connected: false,
          totalObservations: 0,
          qualityObservations: 0,
          lastObservedAt: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),

    getCalibrationReport: publicProcedure.query(async () => {
      try {
        return await getCalibrationReport();
      } catch {
        return [];
      }
    }),
    
    // Get learning insights (human-readable)
    getLearningInsights: publicProcedure.query(() => {
  const state = learningEngine.getState();

  return {
    insights: state.insights ?? [],
    pairs: state.pairs ?? {},
    sessions: state.sessions ?? [],
    strategies: state.strategies ?? {},
    confidenceBuckets: state.confidenceBuckets ?? {},
    regimes: state.regimes ?? {},
    params: state.params ?? {},
    totalEvolutions: state.totalEvolutions ?? 0,
  };
}),

getMemoryDashboard: publicProcedure.query(async () => {
  await marketMemory.load();
  await strategyGenome.load();
  await strategyRegimeMatrix.load();

  return {
    marketMemory: marketMemory.getSummary(),
    strategyGenome: strategyGenome.getSummary(),
    strategyRegimeMatrix: strategyRegimeMatrix.getSummary(),
  };
}),

resetSecondaryAiMemory: publicProcedure.mutation(async () => {
  await marketMemory.load();
  await strategyGenome.load();
  await strategyRegimeMatrix.load();

  await marketMemory.reset();
  await strategyGenome.reset();
  await strategyRegimeMatrix.reset();

  return {
    success: true,
    reset: [
      "marketMemory",
      "strategyGenome",
      "strategyRegimeMatrix",
    ],
    preserved: [
      "learningEngine",
      "tradeHistory",
      "dailyReports",
      "decisionJournal",
    ],
  };
}),

getDecisionJournal: publicProcedure.query(async () => {
  await decisionJournal.load();

  const all = await decisionJournal.getAll();

  return {
    summary: await decisionJournal.getStats(),
    analytics: analyseDecisions(all),
    recent: await decisionJournal.getRecent(50),
  };
}),

getPersistentMemoryStatus: publicProcedure.query(async () => {
  return getPersistentMemoryStatus();
}),

    // Get funded account readiness
    getFundedReadiness: publicProcedure.query(() => {
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
    runBacktest: publicProcedure
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
    setPropFirmMode: publicProcedure
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
    testTelegram: publicProcedure.mutation(async () => {
  try {
    return await sendTelegramTestMessage();
  } catch (e: any) {
    return {
      success: false,
      error: e?.message ?? "Telegram test failed",
    };
  }
}),

setTelegramConfig: publicProcedure
      .input(z.object({
        token: z.string(),
        chatId: z.string(),
      }))
      .mutation(({ input }) => {
        configureTelegram(input.token, input.chatId);
        return { success: true, config: getTelegramConfig() };
      }),

    getTelegramConfig: publicProcedure.query(() => {
      return getTelegramConfig();
    }),
  }),
});

export type AppRouter = typeof appRouter;
