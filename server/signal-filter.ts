/**
 * Signal Rejection Filter: EV vs Transaction Cost Calculation
 *
 * Implements:
 * - Expected Value (EV) calculation
 * - Transaction cost modeling
 * - Signal rejection based on friction
 * - Micro-account mode strategy filtering
 * - Market regime detection
 */

import { RiskEngine } from "./risk-engine";

interface SignalEvaluationInput {
  signalType: string;
  direction: "BUY" | "SELL";
  confidence: number;
  expectedProfit: number;
  expectedLoss: number;
  balance: number;
  liveSpread: number;
  commission: number;
  slippage: number;
  recentWinRate: number;
  sortino: number;
  alpha: number;
  beta: number;
  microAccountMode: boolean;
  marketRegime: "TRENDING" | "RANGING" | "VOLATILE";
}

interface SignalFilterResult {
  shouldExecute: boolean;
  reason: string;
  expectedValue: number;
  frictionRatio: number;
  adjustedConfidence: number;
  riskScore: number;
}

export class SignalFilter {
  private riskEngine: RiskEngine;
  private userId: number;

  constructor(userId: number, riskEngine: RiskEngine) {
    this.userId = userId;
    this.riskEngine = riskEngine;
  }

  evaluateSignal(input: SignalEvaluationInput): SignalFilterResult {
    const transactionCosts = this.calculateTransactionCosts(
      input.expectedProfit,
      input.liveSpread,
      input.commission,
      input.slippage
    );

    const expectedValue = this.calculateExpectedValue(
      input.recentWinRate,
      input.expectedProfit,
      input.expectedLoss,
      transactionCosts
    );

    const frictionRatio = this.calculateFrictionRatio(
      input.expectedProfit,
      transactionCosts
    );

    const adjustedConfidence = this.adjustConfidenceByRisk(
      input.confidence,
      input.sortino,
      input.alpha,
      frictionRatio,
      input.balance
    );

    const riskScore = this.calculateRiskScore(
      frictionRatio,
      input.recentWinRate,
      input.sortino,
      input.marketRegime
    );

    const { shouldExecute, reason } = this.applyRejectionLogic(
      input,
      expectedValue,
      frictionRatio,
      adjustedConfidence,
      riskScore
    );

    return {
      shouldExecute,
      reason,
      expectedValue,
      frictionRatio,
      adjustedConfidence,
      riskScore,
    };
  }

  private calculateTransactionCosts(
    expectedProfitPips: number,
    liveSpreadPips: number,
    commissionPercent: number,
    slippagePips: number
  ): number {
    const spreadCost = liveSpreadPips * 1.0;
    const commissionCost = (commissionPercent / 100) * 0.1;
    const slippageCost = slippagePips * 1.0;
    return spreadCost + commissionCost + slippageCost;
  }

  private calculateExpectedValue(
    winRate: number,
    expectedProfitPips: number,
    expectedLossPips: number,
    transactionCostsPips: number
  ): number {
    const lossRate = 1 - winRate;
    const ev =
      winRate * expectedProfitPips -
      lossRate * expectedLossPips -
      transactionCostsPips;
    return ev;
  }

  private calculateFrictionRatio(
    expectedProfitPips: number,
    transactionCostsPips: number
  ): number {
    if (expectedProfitPips === 0) return Infinity;
    return transactionCostsPips / expectedProfitPips;
  }

  private adjustConfidenceByRisk(
    baseConfidence: number,
    sortino: number,
    alpha: number,
    frictionRatio: number,
    balance: number
  ): number {
    let adjustedConfidence = baseConfidence;

    if (sortino < 0.5) {
      adjustedConfidence *= 0.5;
    } else if (sortino < 1.0) {
      adjustedConfidence *= 0.8;
    } else if (sortino > 2.0) {
      adjustedConfidence *= 1.2;
    }

    if (alpha > 5.0) {
      adjustedConfidence *= 0.7;
    } else if (alpha > 2.0) {
      adjustedConfidence *= 0.85;
    }

    if (frictionRatio > 0.5) {
      adjustedConfidence *= 0.6;
    } else if (frictionRatio > 0.3) {
      adjustedConfidence *= 0.8;
    }

    return Math.max(0, Math.min(adjustedConfidence, 1));
  }

  private calculateRiskScore(
    frictionRatio: number,
    winRate: number,
    sortino: number,
    marketRegime: string
  ): number {
    let riskScore = 0;

    if (frictionRatio > 0.5) {
      riskScore += 30;
    } else if (frictionRatio > 0.3) {
      riskScore += 20;
    } else if (frictionRatio > 0.1) {
      riskScore += 10;
    }

    if (winRate < 0.4) {
      riskScore += 30;
    } else if (winRate < 0.5) {
      riskScore += 20;
    } else if (winRate < 0.6) {
      riskScore += 10;
    }

    if (sortino < 0.5) {
      riskScore += 20;
    } else if (sortino < 1.0) {
      riskScore += 10;
    }

    if (marketRegime === "VOLATILE") {
      riskScore += 15;
    } else if (marketRegime === "RANGING") {
      riskScore += 10;
    }

    return Math.min(riskScore, 100);
  }

  private applyRejectionLogic(
    input: SignalEvaluationInput,
    expectedValue: number,
    frictionRatio: number,
    adjustedConfidence: number,
    riskScore: number
  ): { shouldExecute: boolean; reason: string } {
    if (input.microAccountMode) {
      if (input.expectedProfit < 5) {
        return {
          shouldExecute: false,
          reason: "Scalping rejected in micro-account mode",
        };
      }

      if (frictionRatio > 0.3) {
        return {
          shouldExecute: false,
          reason: `Friction ${(frictionRatio * 100).toFixed(1)}% exceeds 30% threshold`,
        };
      }

      if (
        input.balance < 50 &&
        (input.signalType === "RSI_PULLBACK_BUY" ||
          input.signalType === "RSI_PULLBACK_SELL")
      ) {
        return {
          shouldExecute: false,
          reason: "RSI pullback rejected under £50 balance",
        };
      }

      if (input.liveSpread > 3.0) {
        return {
          shouldExecute: false,
          reason: `Spread ${input.liveSpread.toFixed(1)} pips too wide`,
        };
      }
    }

    if (expectedValue < 0) {
      return {
        shouldExecute: false,
        reason: `Negative EV: ${expectedValue.toFixed(2)} pips`,
      };
    }

    const frictionThreshold = input.balance < 100 ? 0.3 : 0.5;
    if (frictionRatio > frictionThreshold) {
      return {
        shouldExecute: false,
        reason: `Friction exceeds ${(frictionThreshold * 100).toFixed(0)}% threshold`,
      };
    }

    if (adjustedConfidence < 0.3) {
      return {
        shouldExecute: false,
        reason: `Confidence ${(adjustedConfidence * 100).toFixed(0)}% below 30%`,
      };
    }

    if (riskScore > 80) {
      return {
        shouldExecute: false,
        reason: `Risk score ${riskScore}/100 exceeds 80`,
      };
    }

    if (input.recentWinRate < 0.35) {
      return {
        shouldExecute: false,
        reason: `Win rate ${(input.recentWinRate * 100).toFixed(0)}% below 35%`,
      };
    }

    if (input.sortino < 0.3) {
      return {
        shouldExecute: false,
        reason: `Sortino ${input.sortino.toFixed(2)} below 0.3`,
      };
    }

    if (input.marketRegime === "VOLATILE" && adjustedConfidence < 0.6) {
      return {
        shouldExecute: false,
        reason: "Volatile market + low confidence",
      };
    }

    return {
      shouldExecute: true,
      reason: "Signal passed all filters",
    };
  }

  recommendStrategyType(
    balance: number,
    marketRegime: string,
    recentWinRate: number
  ): string[] {
    const strategies: string[] = [];

    if (balance < 50) {
      strategies.push("CROSSOVER_BUY", "CROSSOVER_SELL");
    } else if (balance < 100) {
      strategies.push(
        "CROSSOVER_BUY",
        "CROSSOVER_SELL",
        "RSI_PULLBACK_BUY",
        "RSI_PULLBACK_SELL"
      );
    } else if (balance < 500) {
      strategies.push(
        "CROSSOVER_BUY",
        "CROSSOVER_SELL",
        "RSI_PULLBACK_BUY",
        "RSI_PULLBACK_SELL"
      );
    } else {
      strategies.push(
        "CROSSOVER_BUY",
        "CROSSOVER_SELL",
        "RSI_PULLBACK_BUY",
        "RSI_PULLBACK_SELL"
      );
    }

    if (marketRegime === "RANGING") {
      return strategies.filter((s) => s.includes("PULLBACK"));
    } else if (marketRegime === "TRENDING") {
      return strategies.filter((s) => s.includes("CROSSOVER"));
    }

    return strategies;
  }

  calculateMinimumProfitTarget(
    balance: number,
    liveSpread: number,
    commission: number,
    slippage: number
  ): number {
    const transactionCosts = this.calculateTransactionCosts(
      10,
      liveSpread,
      commission,
      slippage
    );

    const minimumTarget = transactionCosts * 2;

    if (balance < 50) {
      return Math.max(minimumTarget, 5);
    } else if (balance < 100) {
      return Math.max(minimumTarget, 3);
    }

    return Math.max(minimumTarget, 2);
  }
}
