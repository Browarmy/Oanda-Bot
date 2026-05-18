/**
 * Position Sizing Engine: Fractional Kelly & Geometric Compounding
 * 
 * Implements:
 * - Fractional Kelly Criterion
 * - Dynamic position scaling
 * - Geometric compounding tracking
 * - Win-rate based sizing adjustments
 */

import { getDb } from "./db";

interface PositionSizingConfig {
  balance: number;
  recentWinRate: number;
  avgWinSize: number;
  avgLossSize: number;
  maxRiskPerTrade: number;
  fractionalKellyFactor: number;
  microAccountMode: boolean;
}

interface PositionSizingResult {
  units: number;
  riskAmount: number;
  expectedProfit: number;
  expectedLoss: number;
  riskRewardRatio: number;
  kellyPercentage: number;
  fractionalPercentage: number;
  recommendation: "EXECUTE" | "REDUCE" | "REJECT";
}

export class PositionSizer {
  private userId: number;

  constructor(userId: number) {
    this.userId = userId;
  }

  /**
   * Calculate Fractional Kelly Criterion
   * 
   * Kelly % = (Win% × Avg Win - Loss% × Avg Loss) / Avg Win
   * Fractional Kelly = Kelly % × Fraction (typically 0.15 to 0.50)
   */
  calculateFractionalKelly(
    winRate: number,
    avgWin: number,
    avgLoss: number
  ): number {
    if (avgWin === 0) return 0;

    const lossRate = 1 - winRate;
    const kelly = (winRate * avgWin - lossRate * avgLoss) / avgWin;

    // Clamp Kelly between 0 and 1 (100%)
    return Math.max(0, Math.min(kelly, 1));
  }

  /**
   * Calculate position size based on Kelly Criterion
   */
  calculatePositionSize(config: PositionSizingConfig): PositionSizingResult {
    const {
      balance,
      recentWinRate,
      avgWinSize,
      avgLossSize,
      maxRiskPerTrade,
      fractionalKellyFactor,
      microAccountMode,
    } = config;

    // Calculate full Kelly
    const fullKelly = this.calculateFractionalKelly(
      recentWinRate,
      avgWinSize,
      avgLossSize
    );

    // Apply fractional Kelly (safety factor)
    const fractionalKelly = fullKelly * fractionalKellyFactor;

    // Position size = Fractional Kelly × Balance
    let positionSize = fractionalKelly * balance;

    // Apply micro-account restrictions
    if (microAccountMode) {
      positionSize = Math.min(positionSize, 0.5); // Max £0.50
    } else if (balance < 500) {
      positionSize = Math.min(positionSize, 10.0); // Max £10
    } else {
      positionSize = Math.min(positionSize, 50.0); // Max £50
    }

    // Ensure minimum position size
    positionSize = Math.max(positionSize, 0.01);

    // Ensure position size respects max risk per trade
    const riskAmount = Math.min(positionSize, maxRiskPerTrade);

    // Calculate expected outcomes
    const expectedProfit = recentWinRate * avgWinSize;
    const expectedLoss = (1 - recentWinRate) * avgLossSize;
    const riskRewardRatio = avgWinSize / avgLossSize;

    // Determine recommendation
    let recommendation: "EXECUTE" | "REDUCE" | "REJECT" = "EXECUTE";

    if (fractionalKelly < 0.05) {
      recommendation = "REJECT"; // Kelly too small
    } else if (fractionalKelly < 0.15 && microAccountMode) {
      recommendation = "REDUCE"; // Reduce size in micro-account
    } else if (riskRewardRatio < 1.0) {
      recommendation = "REJECT"; // Expected loss > expected profit
    }

    return {
      units: Math.floor(positionSize * 100), // Convert to units (assuming 1 unit = 0.01)
      riskAmount,
      expectedProfit,
      expectedLoss,
      riskRewardRatio,
      kellyPercentage: fullKelly * 100,
      fractionalPercentage: fractionalKelly * 100,
      recommendation,
    };
  }

  /**
   * Calculate geometric compounding projection
   */
  calculateGeometricCompounding(
    startingBalance: number,
    monthlyGrowthRate: number,
    months: number
  ): {
    projectedBalance: number;
    totalReturn: number;
    cagr: number;
  } {
    // Compound monthly: Final = Initial × (1 + Rate) ^ Months
    const projectedBalance = startingBalance * Math.pow(1 + monthlyGrowthRate, months);
    const totalReturn = ((projectedBalance - startingBalance) / startingBalance) * 100;

    // CAGR = (Ending / Beginning) ^ (1 / Years) - 1
    const years = months / 12;
    const cagr = (Math.pow(projectedBalance / startingBalance, 1 / years) - 1) * 100;

    return {
      projectedBalance,
      totalReturn,
      cagr,
    };
  }

  /**
   * Calculate optimal position size for target profit
   */
  calculatePositionSizeForTargetProfit(
    balance: number,
    targetProfit: number,
    winRate: number,
    avgWin: number,
    avgLoss: number
  ): number {
    // Position size = Target Profit / Expected Value per unit
    const expectedValue = winRate * avgWin - (1 - winRate) * avgLoss;

    if (expectedValue <= 0) return 0;

    const positionSize = targetProfit / expectedValue;

    // Ensure it doesn't exceed balance
    return Math.min(positionSize, balance);
  }

  /**
   * Scale position size based on drawdown
   */
  scalePositionByDrawdown(
    basePositionSize: number,
    currentDrawdownPercent: number,
    maxDrawdownPercent: number = 2.0
  ): number {
    // If drawdown is approaching limit, reduce position size
    const drawdownRatio = currentDrawdownPercent / maxDrawdownPercent;

    if (drawdownRatio > 0.8) {
      return basePositionSize * 0.5; // Reduce by 50%
    } else if (drawdownRatio > 0.5) {
      return basePositionSize * 0.75; // Reduce by 25%
    }

    return basePositionSize;
  }

  /**
   * Scale position size based on losing streak
   */
  scalePositionByLosingStreak(
    basePositionSize: number,
    consecutiveLosses: number
  ): number {
    if (consecutiveLosses >= 5) {
      return basePositionSize * 0.25; // Reduce by 75%
    } else if (consecutiveLosses >= 4) {
      return basePositionSize * 0.5; // Reduce by 50%
    } else if (consecutiveLosses >= 3) {
      return basePositionSize * 0.75; // Reduce by 25%
    }

    return basePositionSize;
  }

  /**
   * Scale position size based on spread widening
   */
  scalePositionBySpreadWidening(
    basePositionSize: number,
    currentSpread: number,
    normalSpread: number
  ): number {
    const spreadRatio = currentSpread / normalSpread;

    if (spreadRatio > 3.0) {
      return 0; // Reject trade
    } else if (spreadRatio > 2.0) {
      return basePositionSize * 0.25; // Reduce by 75%
    } else if (spreadRatio > 1.5) {
      return basePositionSize * 0.5; // Reduce by 50%
    }

    return basePositionSize;
  }

  /**
   * Calculate stop loss and take profit levels
   */
  calculateStopAndProfit(
    entryPrice: number,
    atr: number,
    direction: "BUY" | "SELL",
    slMultiplier: number = 1.0,
    tpMultiplier: number = 2.0
  ): {
    stopLoss: number;
    takeProfit: number;
    riskRewardRatio: number;
  } {
    const risk = atr * slMultiplier;
    const reward = atr * tpMultiplier;

    let stopLoss: number;
    let takeProfit: number;

    if (direction === "BUY") {
      stopLoss = entryPrice - risk;
      takeProfit = entryPrice + reward;
    } else {
      stopLoss = entryPrice + risk;
      takeProfit = entryPrice - reward;
    }

    return {
      stopLoss,
      takeProfit,
      riskRewardRatio: reward / risk,
    };
  }

  /**
   * Validate position size against risk constraints
   */
  validatePositionSize(
    positionSize: number,
    balance: number,
    maxRiskPercent: number = 2.0,
    maxDrawdownPercent: number = 5.0
  ): { valid: boolean; reason?: string } {
    const maxRiskAmount = (balance * maxRiskPercent) / 100;
    const maxDrawdownAmount = (balance * maxDrawdownPercent) / 100;

    if (positionSize > maxRiskAmount) {
      return {
        valid: false,
        reason: `Position size £${positionSize.toFixed(2)} exceeds max risk £${maxRiskAmount.toFixed(2)}`,
      };
    }

    if (positionSize > maxDrawdownAmount) {
      return {
        valid: false,
        reason: `Position size £${positionSize.toFixed(2)} exceeds max drawdown £${maxDrawdownAmount.toFixed(2)}`,
      };
    }

    if (positionSize > balance) {
      return {
        valid: false,
        reason: `Position size £${positionSize.toFixed(2)} exceeds balance £${balance.toFixed(2)}`,
      };
    }

    return { valid: true };
  }

  /**
   * Calculate compounding schedule (month-by-month projection)
   */
  calculateCompoundingSchedule(
    startingBalance: number,
    monthlyGrowthRate: number,
    months: number
  ): Array<{ month: number; balance: number; growth: number }> {
    const schedule = [];
    let currentBalance = startingBalance;

    for (let month = 1; month <= months; month++) {
      currentBalance = currentBalance * (1 + monthlyGrowthRate);
      const growth = ((currentBalance - startingBalance) / startingBalance) * 100;

      schedule.push({
        month,
        balance: currentBalance,
        growth,
      });
    }

    return schedule;
  }

  /**
   * Recommend position size adjustment based on performance
   */
  recommendPositionAdjustment(
    recentWinRate: number,
    previousWinRate: number,
    currentPositionSize: number
  ): {
    adjustment: "INCREASE" | "MAINTAIN" | "DECREASE";
    newPositionSize: number;
    reason: string;
  } {
    const winRateChange = recentWinRate - previousWinRate;

    if (winRateChange > 0.1) {
      // Win rate improved by 10%+
      return {
        adjustment: "INCREASE",
        newPositionSize: currentPositionSize * 1.15,
        reason: "Win rate improved significantly",
      };
    } else if (winRateChange < -0.1) {
      // Win rate declined by 10%+
      return {
        adjustment: "DECREASE",
        newPositionSize: currentPositionSize * 0.85,
        reason: "Win rate declined significantly",
      };
    }

    return {
      adjustment: "MAINTAIN",
      newPositionSize: currentPositionSize,
      reason: "Win rate stable",
    };
  }
}
