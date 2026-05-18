/**
 * Risk Engine: Capital Preservation & Optimization
 * 
 * Implements:
 * - Sortino Ratio optimization
 * - Maximum Drawdown constraints
 * - Alpha/Beta dynamic scaling
 * - Micro-Account Mode
 * - Live spread integration
 * - Risk of Ruin calculation
 */

import { getDb } from "./db";

interface RiskMetrics {
  currentBalance: number;
  maxRiskPerTrade: number;
  maxDrawdownPercent: number;
  alpha: number;
  beta: number;
  microAccountMode: boolean;
  fractionalKelly: number;
  sortino: number;
  riskOfRuin: number;
  recentWinRate: number;
  recentLosses: number[];
  recentWins: number[];
}

interface LiveSpreadData {
  bid: number;
  ask: number;
  spread: number; // in pips
  timestamp: number;
}

interface PositionSizingInput {
  balance: number;
  recentWinRate: number;
  avgWin: number;
  avgLoss: number;
  liveSpread: number;
  commission: number;
}

export class RiskEngine {
  private userId: number;
  private baseAlpha: number = 2.0;
  private baseBeta: number = 3.0;
  private microAccountThreshold: number = 100;
  private maxDrawdownPercent: number = 2.0;
  private frictionThreshold: Map<string, number> = new Map([
    ["micro", 0.30],
    ["standard", 0.50],
    ["aggressive", 0.70],
  ]);

  constructor(userId: number) {
    this.userId = userId;
  }

  /**
   * Calculate all risk metrics for current account state
   */
  async calculateRiskMetrics(
    balance: number,
    recentTrades: any[]
  ): Promise<RiskMetrics> {
    // Extract recent wins and losses
    const recentWins = recentTrades
      .filter((t) => parseFloat(t.pnl) > 0)
      .map((t) => parseFloat(t.pnl));
    const recentLosses = recentTrades
      .filter((t) => parseFloat(t.pnl) < 0)
      .map((t) => Math.abs(parseFloat(t.pnl)));

    const recentWinRate = recentWins.length / Math.max(recentTrades.length, 1);

    // Calculate Sortino Ratio
    const sortino = this.calculateSortino(recentWins, recentLosses);

    // Calculate Alpha and Beta (inversely proportional to balance)
    const alpha = this.calculateAlpha(balance);
    const beta = this.calculateBeta(balance);

    // Determine if in Micro-Account Mode
    const microAccountMode = balance < this.microAccountThreshold;

    // Calculate max risk per trade
    const maxRiskPerTrade = balance * (this.maxDrawdownPercent / 100);

    // Calculate Fractional Kelly
    const fractionalKelly = this.calculateFractionalKelly(balance);

    // Calculate Risk of Ruin
    const riskOfRuin = this.calculateRiskOfRuin(
      recentWinRate,
      balance,
      maxRiskPerTrade
    );

    return {
      currentBalance: balance,
      maxRiskPerTrade,
      maxDrawdownPercent: this.maxDrawdownPercent,
      alpha,
      beta,
      microAccountMode,
      fractionalKelly,
      sortino,
      riskOfRuin,
      recentWinRate,
      recentLosses,
      recentWins,
    };
  }

  /**
   * Calculate Sortino Ratio (penalize downside only)
   */
  private calculateSortino(wins: number[], losses: number[]): number {
    if (wins.length + losses.length === 0) return 0;

    // Average return
    const avgReturn =
      (wins.reduce((a, b) => a + b, 0) - losses.reduce((a, b) => a + b, 0)) /
      (wins.length + losses.length);

    // Downside deviation (only losses count)
    if (losses.length === 0) return 10; // Perfect record
    const downsideDeviation = Math.sqrt(
      losses.reduce((sum, loss) => sum + loss * loss, 0) / losses.length
    );

    // Sortino = avg return / downside deviation
    return downsideDeviation > 0 ? avgReturn / downsideDeviation : 0;
  }

  /**
   * Calculate Alpha (risk aversion weight)
   * Inversely proportional to balance
   */
  private calculateAlpha(balance: number): number {
    return this.baseAlpha * (this.microAccountThreshold / balance);
  }

  /**
   * Calculate Beta (fee sensitivity weight)
   * Inversely proportional to balance
   */
  private calculateBeta(balance: number): number {
    return this.baseBeta * (this.microAccountThreshold / balance);
  }

  /**
   * Calculate Fractional Kelly based on account size
   */
  private calculateFractionalKelly(balance: number): number {
    if (balance < 50) return 0.15;
    if (balance < 100) return 0.25;
    if (balance < 500) return 0.35;
    return 0.50;
  }

  /**
   * Calculate Risk of Ruin (Gambler's Ruin)
   */
  private calculateRiskOfRuin(
    winRate: number,
    balance: number,
    riskPerTrade: number
  ): number {
    if (winRate === 0.5) return 1; // 50/50 game = guaranteed ruin
    if (riskPerTrade === 0) return 0; // No risk = no ruin

    const capitalUnits = balance / riskPerTrade;
    const ratio = (1 - winRate) / (1 + winRate);

    // P(Ruin) = ratio ^ capitalUnits
    const riskOfRuin = Math.pow(ratio, capitalUnits);

    return Math.min(riskOfRuin, 1); // Cap at 100%
  }

  /**
   * Calculate position size using Fractional Kelly Criterion
   */
  calculatePositionSize(input: PositionSizingInput): number {
    const { balance, recentWinRate, avgWin, avgLoss, liveSpread, commission } =
      input;

    // Kelly Fraction = (Win% × AvgWin - Loss% × AvgLoss) / AvgWin
    const lossRate = 1 - recentWinRate;
    const kellyFraction =
      (recentWinRate * avgWin - lossRate * avgLoss) / avgWin;

    // Fractional Kelly (safety factor)
    const fractionalKelly = this.calculateFractionalKelly(balance);
    const kellySized = fractionalKelly * kellyFraction;

    // Position size = Kelly-sized fraction × balance
    let positionSize = kellySized * balance;

    // Apply micro-account restrictions
    if (balance < 100) {
      positionSize = Math.min(positionSize, 0.50); // Max £0.50
    } else if (balance < 500) {
      positionSize = Math.min(positionSize, 10.0); // Max £10
    }

    // Ensure minimum position size
    positionSize = Math.max(positionSize, 0.01);

    return positionSize;
  }

  /**
   * Calculate transaction costs (spread + commission + slippage)
   */
  calculateTransactionCosts(
    positionSize: number,
    liveSpread: number,
    commission: number = 0.01,
    slippage: number = 0.5
  ): number {
    // Convert pips to decimal (GBP/USD: 1 pip = 0.0001)
    const spreadCost = liveSpread * 0.0001 * positionSize;
    const commissionCost = (commission / 100) * positionSize;
    const slippageCost = slippage * 0.0001 * positionSize;

    return spreadCost + commissionCost + slippageCost;
  }

  /**
   * Calculate Expected Value (EV) of a trade
   */
  calculateExpectedValue(
    winRate: number,
    avgProfit: number,
    avgLoss: number,
    transactionCosts: number
  ): number {
    const lossRate = 1 - winRate;
    const ev = winRate * avgProfit - lossRate * avgLoss - transactionCosts;
    return ev;
  }

  /**
   * Calculate Friction Ratio (transaction costs as % of expected profit)
   */
  calculateFrictionRatio(
    expectedProfit: number,
    transactionCosts: number
  ): number {
    if (expectedProfit === 0) return Infinity;
    return transactionCosts / expectedProfit;
  }

  /**
   * Determine if a signal should be rejected based on friction
   */
  shouldRejectSignalByFriction(
    balance: number,
    frictionRatio: number,
    expectedProfit: number
  ): boolean {
    // Determine account tier
    let tier = "standard";
    if (balance < 100) tier = "micro";
    else if (balance > 500) tier = "aggressive";

    const threshold = this.frictionThreshold.get(tier) || 0.5;

    // Reject if friction exceeds threshold
    if (frictionRatio > threshold) {
      console.log(
        `[RISK] Signal rejected: Friction ${(frictionRatio * 100).toFixed(1)}% > ${(threshold * 100).toFixed(1)}% threshold`
      );
      return true;
    }

    // Reject if expected profit is too small for account size
    if (balance < 50 && expectedProfit < 0.1) {
      console.log(`[RISK] Signal rejected: Expected profit £${expectedProfit.toFixed(2)} too small for micro account`);
      return true;
    }

    if (balance < 100 && expectedProfit < 0.25) {
      console.log(`[RISK] Signal rejected: Expected profit £${expectedProfit.toFixed(2)} too small`);
      return true;
    }

    return false;
  }

  /**
   * Apply Micro-Account Mode restrictions
   */
  getMicroAccountRestrictions(balance: number): any {
    if (balance >= this.microAccountThreshold) {
      return null; // Not in micro-account mode
    }

    return {
      maxRiskPerTrade: 0.005, // 0.5%
      fractionalKelly: 0.15,
      maxSpreadTolerance: 1.0, // pips
      minTradeDuration: 300, // 5 minutes
      maxTradesPerDay: 10,
      frictionThreshold: 0.30,
      allowedInstruments: ["GBP_USD", "EUR_USD"],
      allowedStrategies: ["CROSSOVER_BUY", "CROSSOVER_SELL"],
      mandatoryBreakAfterTrades: 5,
      mandatoryBreakDuration: 7200, // 2 hours
    };
  }

  /**
   * Calculate reward function (complete optimization metric)
   */
  calculateRewardFunction(
    tradeReturn: number,
    downsideDrawdown: number,
    transactionCosts: number,
    alpha: number,
    beta: number
  ): number {
    return (
      tradeReturn - alpha * downsideDrawdown - beta * transactionCosts
    );
  }

  /**
   * Adjust signal confidence based on Sortino Ratio
   */
  adjustConfidenceByRisk(baseConfidence: number, sortino: number): number {
    if (sortino < 0.5) return baseConfidence * 0.0; // Reject
    if (sortino < 1.0) return baseConfidence * 0.8; // Reduce by 20%
    if (sortino > 2.0) return Math.min(baseConfidence * 1.2, 1.0); // Boost by 20%
    return baseConfidence;
  }

  /**
   * Detect losing streak and trigger alerts
   */
  detectLosingStreak(recentTrades: any[]): { alert: boolean; severity: string } {
    if (recentTrades.length < 5) return { alert: false, severity: "none" };

    const lastFive = recentTrades.slice(-5);
    const losses = lastFive.filter((t) => parseFloat(t.pnl) < 0).length;

    if (losses === 5) {
      return { alert: true, severity: "critical" }; // 5 consecutive losses
    }
    if (losses >= 4) {
      return { alert: true, severity: "high" }; // 4 out of 5 losses
    }
    if (losses >= 3) {
      return { alert: true, severity: "medium" }; // 3 out of 5 losses
    }

    return { alert: false, severity: "none" };
  }

  /**
   * Detect spread widening event
   */
  detectSpreadWidening(
    currentSpread: number,
    historicalAverage: number
  ): { widened: boolean; severity: string } {
    const ratio = currentSpread / historicalAverage;

    if (ratio > 3.0) return { widened: true, severity: "critical" }; // 3x wider
    if (ratio > 2.0) return { widened: true, severity: "high" }; // 2x wider
    if (ratio > 1.5) return { widened: true, severity: "medium" }; // 1.5x wider

    return { widened: false, severity: "none" };
  }
}
