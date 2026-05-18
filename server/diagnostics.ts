/**
 * Diagnostics Module
 * Provides comprehensive debugging and monitoring endpoints
 */

import { getDb } from "./db";
import { eq, desc } from "drizzle-orm";
import { trades } from "../drizzle/schema";

export interface DiagnosticResult {
  status: "HEALTHY" | "WARNING" | "ERROR";
  timestamp: number;
  details: Record<string, unknown>;
}

/**
 * Test OANDA Connection
 */
export async function testOandaConnection(token: string, accountId: string) {
  try {
    const response = await fetch(`https://api-fxpractice.oanda.com/v3/accounts/${accountId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        status: "HEALTHY" as const,
        message: "OANDA connection successful",
        accountBalance: data.account.balance,
        currency: data.account.currency,
        timestamp: Date.now(),
      };
    } else {
      return {
        status: "ERROR" as const,
        message: `OANDA API error: ${response.statusText}`,
        statusCode: response.status,
        timestamp: Date.now(),
      };
    }
  } catch (error) {
    return {
      status: "ERROR" as const,
      message: `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      timestamp: Date.now(),
    };
  }
}

/**
 * Test Database Connection
 */
export async function testDatabaseConnection() {
  try {
    const db = await getDb();
    if (!db) {
      return {
        status: "ERROR" as const,
        message: "Database not initialized",
        timestamp: Date.now(),
      };
    }

    const result = await db.select().from(trades).limit(1);
    return {
      status: "HEALTHY" as const,
      message: "Database connection successful",
      tradesCount: result.length,
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      status: "ERROR" as const,
      message: `Database error: ${error instanceof Error ? error.message : "Unknown error"}`,
      timestamp: Date.now(),
    };
  }
}

/**
 * Get Debug Information
 */
export async function getDebugInfo(userId: number) {
  const db = await getDb();
  if (!db) {
    return {
      status: "ERROR" as const,
      message: "Database unavailable",
      timestamp: Date.now(),
    };
  }

  const recentTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.createdAt))
    .limit(20);

  const totalTrades = recentTrades.length;
  const wins = recentTrades.filter((t) => {
    const pnl = typeof t.pnl === "string" ? parseFloat(t.pnl) : t.pnl || 0;
    return pnl > 0;
  }).length;

  const totalPnL = recentTrades.reduce((sum, t) => {
    const pnl = typeof t.pnl === "string" ? parseFloat(t.pnl) : t.pnl || 0;
    return sum + pnl;
  }, 0);

  return {
    status: "HEALTHY" as const,
    timestamp: Date.now(),
    trades: {
      total: totalTrades,
      wins,
      losses: totalTrades - wins,
      winRate: totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) + "%" : "N/A",
      totalPnL: totalPnL.toFixed(2),
      avgPnLPerTrade: totalTrades > 0 ? (totalPnL / totalTrades).toFixed(2) : "N/A",
    },
    recentTrades: recentTrades.slice(0, 5).map((t) => ({
      id: t.id,
      instrument: t.instrument,
      direction: t.direction,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      pnl: t.pnl,
      signalType: t.signalType,
      createdAt: t.createdAt,
    })),
  };
}

/**
 * Validate Configuration
 */
export function validateConfiguration(config: {
  riskPerTrade?: number;
  dailyLossGuard?: number;
  confidenceThreshold?: number;
  sessionFilter?: { name: string; enabled: boolean }[];
}) {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.riskPerTrade !== undefined) {
    if (config.riskPerTrade < 1 || config.riskPerTrade > 5) {
      warnings.push(`Risk per trade ${config.riskPerTrade}% is outside recommended range (1-5%)`);
    }
  }

  if (config.dailyLossGuard !== undefined) {
    if (config.dailyLossGuard < 5 || config.dailyLossGuard > 50) {
      warnings.push(`Daily loss guard ${config.dailyLossGuard}% is outside recommended range (5-50%)`);
    }
  }

  if (config.confidenceThreshold !== undefined) {
    if (config.confidenceThreshold < 50 || config.confidenceThreshold > 90) {
      errors.push(`Confidence threshold ${config.confidenceThreshold}% must be between 50-90%`);
    }
  }

  if (config.sessionFilter) {
    const enabledSessions = config.sessionFilter.filter((s) => s.enabled).length;
    if (enabledSessions === 0) {
      errors.push("At least one session must be enabled");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    timestamp: Date.now(),
  };
}

/**
 * Validate Equity Curve Data
 */
export async function validateEquityCurveData(userId: number) {
  const db = await getDb();
  if (!db) {
    return {
      status: "ERROR" as const,
      message: "Database unavailable",
      timestamp: Date.now(),
    };
  }

  const allTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.createdAt));

  const issues: string[] = [];
  let runningBalance = 0;

  for (const trade of allTrades) {
    const pnl = typeof trade.pnl === "string" ? parseFloat(trade.pnl) : trade.pnl || 0;
    runningBalance += pnl;

    if (!trade.entryPrice || !trade.exitPrice) {
      issues.push(`Trade ${trade.id} missing entry or exit price`);
    }

    if (isNaN(pnl)) {
      issues.push(`Trade ${trade.id} has invalid PnL`);
    }
  }

  return {
    status: issues.length === 0 ? ("HEALTHY" as const) : ("WARNING" as const),
    totalTrades: allTrades.length,
    totalPnL: runningBalance.toFixed(2),
    issues,
    timestamp: Date.now(),
  };
}

/**
 * Get Signal Performance
 */
export async function getSignalPerformance(userId: number) {
  const db = await getDb();
  if (!db) {
    return {
      status: "ERROR" as const,
      message: "Database unavailable",
      timestamp: Date.now(),
    };
  }

  const allTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.userId, userId));

  const signalTypes = [
    "CROSSOVER_BUY",
    "CROSSOVER_SELL",
    "RSI_PULLBACK_BUY",
    "RSI_PULLBACK_SELL",
  ];

  const performance: Record<
    string,
    { total: number; wins: number; losses: number; totalPnL: number; winRate: string }
  > = {};

  for (const signalType of signalTypes) {
    const tradesOfType = allTrades.filter((t) => t.signalType === signalType);
    const wins = tradesOfType.filter((t) => {
      const pnl = typeof t.pnl === "string" ? parseFloat(t.pnl) : t.pnl || 0;
      return pnl > 0;
    }).length;

    const totalPnL = tradesOfType.reduce((sum, t) => {
      const pnl = typeof t.pnl === "string" ? parseFloat(t.pnl) : t.pnl || 0;
      return sum + pnl;
    }, 0);

    performance[signalType] = {
      total: tradesOfType.length,
      wins,
      losses: tradesOfType.length - wins,
      totalPnL,
      winRate:
        tradesOfType.length > 0
          ? ((wins / tradesOfType.length) * 100).toFixed(2) + "%"
          : "N/A",
    };
  }

  return {
    status: "HEALTHY" as const,
    performance,
    timestamp: Date.now(),
  };
}

/**
 * Get Position Sizing Explanation
 */
export function explainPositionSizing(accountBalance: number, riskPerTrade: number) {
  const riskAmount = accountBalance * (riskPerTrade / 100);
  const kellyPercentage = 0.25; // Fractional Kelly (25% of full Kelly)
  const positionSize = (accountBalance * kellyPercentage) / 100;

  return {
    accountBalance,
    riskPerTrade: `${riskPerTrade}%`,
    riskAmount: riskAmount.toFixed(2),
    kellyPercentage: `${(kellyPercentage * 100).toFixed(1)}%`,
    recommendedPositionSize: positionSize.toFixed(2),
    explanation: `With £${accountBalance} account and ${riskPerTrade}% risk per trade, you risk £${riskAmount.toFixed(2)} per trade. Position size is calculated using Fractional Kelly Criterion (${(kellyPercentage * 100).toFixed(1)}% of full Kelly) to ensure optimal growth while minimizing drawdown risk.`,
    timestamp: Date.now(),
  };
}

/**
 * Deployment Checklist
 */
export async function getDeploymentChecklist(config: {
  oandaTokenValid?: boolean;
  oandaAccountIdValid?: boolean;
  databaseConnected?: boolean;
  githubRepoReady?: boolean;
  railwayDeployed?: boolean;
}) {
  const checks = {
    oandaTokenValid: config.oandaTokenValid || false,
    oandaAccountIdValid: config.oandaAccountIdValid || false,
    databaseConnected: config.databaseConnected || false,
    githubRepoReady: config.githubRepoReady || false,
    railwayDeployed: config.railwayDeployed || false,
  };

  const allPassed = Object.values(checks).every((v) => v === true);

  return {
    status: allPassed ? ("HEALTHY" as const) : ("WARNING" as const),
    checks,
    readyToTest: allPassed,
    nextSteps: !allPassed
      ? Object.entries(checks)
          .filter(([, v]) => !v)
          .map(([k]) => `Complete: ${k}`)
      : ["All checks passed. Ready to test!"],
    timestamp: Date.now(),
  };
}
