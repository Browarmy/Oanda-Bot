export interface PortfolioCioInput {
  accountBalance: number;
  accountEquity: number;
  dailyStartBalance: number;
  openTradesCount: number;
  maxConcurrentTrades: number;
  currentDrawdownPct: number;
  portfolioHeatPct: number;
  recentTrades: {
    pnl: number;
    won: boolean;
    closedAt: number;
  }[];
}

export interface PortfolioCioDecision {
  approved: boolean;
  riskMultiplier: number;
  score: number;
  mood: "AGGRESSIVE" | "NORMAL" | "DEFENSIVE" | "LOCKDOWN";
  reason: string;
}

export function evaluatePortfolioCio(
  input: PortfolioCioInput
): PortfolioCioDecision {
  let score = 100;
  let riskMultiplier = 1;
  const reasons: string[] = [];

  const dailyPnl =
    input.accountBalance - input.dailyStartBalance;

  const dailyPnlPct =
    input.dailyStartBalance > 0
      ? (dailyPnl / input.dailyStartBalance) * 100
      : 0;

  const today = new Date().toDateString();

  const todayTrades = input.recentTrades.filter(
    t => new Date(t.closedAt).toDateString() === today
  );

  const todayLosses = todayTrades.filter(t => !t.won).length;
  const todayWins = todayTrades.filter(t => t.won).length;

  const recentLosses = input.recentTrades
    .slice(-5)
    .filter(t => !t.won).length;

  if (dailyPnlPct <= -2.5) {
    return {
      approved: false,
      riskMultiplier: 0,
      score: 0,
      mood: "LOCKDOWN",
      reason: `daily loss ${dailyPnlPct.toFixed(2)}% near funded limit`,
    };
  }

  if (input.currentDrawdownPct >= 4) {
    return {
      approved: false,
      riskMultiplier: 0,
      score: 0,
      mood: "LOCKDOWN",
      reason: `drawdown ${input.currentDrawdownPct.toFixed(2)}% too high`,
    };
  }

  if (input.openTradesCount >= input.maxConcurrentTrades) {
    return {
      approved: false,
      riskMultiplier: 0,
      score: 0,
      mood: "LOCKDOWN",
      reason: "max concurrent trades reached",
    };
  }

  if (input.portfolioHeatPct >= 3.5) {
    score -= 25;
    riskMultiplier *= 0.65;
    reasons.push(`portfolio heat ${input.portfolioHeatPct.toFixed(1)}%`);
  }

  if (input.currentDrawdownPct >= 2) {
    score -= 25;
    riskMultiplier *= 0.6;
    reasons.push(`drawdown ${input.currentDrawdownPct.toFixed(2)}%`);
  }

  if (dailyPnlPct < -1) {
    score -= 20;
    riskMultiplier *= 0.7;
    reasons.push(`daily P&L ${dailyPnlPct.toFixed(2)}%`);
  }

  if (recentLosses >= 3) {
    score -= 20;
    riskMultiplier *= 0.65;
    reasons.push(`${recentLosses}/5 recent losses`);
  }

  if (todayTrades.length >= 6 && todayLosses > todayWins) {
    score -= 15;
    riskMultiplier *= 0.75;
    reasons.push(`weak day ${todayWins}W/${todayLosses}L`);
  }

  if (dailyPnlPct >= 1.5) {
    score -= 10;
    riskMultiplier *= 0.8;
    reasons.push(`daily profit protected ${dailyPnlPct.toFixed(2)}%`);
  }

  score = Math.max(0, Math.min(100, score));

  const mood: PortfolioCioDecision["mood"] =
    score < 35 ? "LOCKDOWN" :
    score < 55 ? "DEFENSIVE" :
    score > 85 && dailyPnlPct >= 0 ? "AGGRESSIVE" :
    "NORMAL";

  if (mood === "LOCKDOWN") {
    return {
      approved: false,
      riskMultiplier: 0,
      score,
      mood,
      reason: reasons.join(" | ") || "portfolio conditions unsafe",
    };
  }

  return {
    approved: true,
    riskMultiplier: Math.max(0.25, Math.min(1.25, riskMultiplier)),
    score,
    mood,
    reason: reasons.join(" | ") || "portfolio conditions healthy",
  };
}