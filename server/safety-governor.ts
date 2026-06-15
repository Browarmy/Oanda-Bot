export interface SafetyGovernorInput {
  consecutiveLosses: number;
  currentDrawdownPct: number;
  todayWinRate: number;
  tradesToday: number;
  portfolioHeatPct: number;

  regimeRisk: number;
  metaScore: number;
  confidence: number;
}

export interface SafetyGovernorResult {
  approved: boolean;
  riskMultiplier: number;
  reason: string;
  dangerScore: number;
}

export function evaluateSafetyGovernor(
  input: SafetyGovernorInput
): SafetyGovernorResult {

  let danger = 0;
  const reasons: string[] = [];

  // Losing streak
  if (input.consecutiveLosses >= 3) {
    danger += 25;
    reasons.push("3+ consecutive losses");
  }

  if (input.consecutiveLosses >= 5) {
    danger += 25;
    reasons.push("5+ consecutive losses");
  }

  // Drawdown
  if (input.currentDrawdownPct >= 4) {
    danger += 20;
    reasons.push("drawdown >4%");
  }

  if (input.currentDrawdownPct >= 8) {
    danger += 25;
    reasons.push("drawdown >8%");
  }

  // Poor daily performance
  if (
    input.tradesToday >= 8 &&
    input.todayWinRate < 0.35
  ) {
    danger += 15;
    reasons.push("poor daily win rate");
  }

  // Portfolio heat
  if (input.portfolioHeatPct > 3.5) {
    danger += 10;
    reasons.push("high portfolio heat");
  }

  // Weak meta confidence
  if (input.metaScore < 0.45) {
    danger += 10;
    reasons.push("weak meta score");
  }

  if (input.confidence < 0.75) {
    danger += 10;
    reasons.push("low confidence");
  }

  // High-risk regime
  if (input.regimeRisk > 0.80) {
    danger += 15;
    reasons.push("dangerous market regime");
  }

  // Emergency stop
  if (danger >= 60) {
    return {
      approved: false,
      riskMultiplier: 0,
      dangerScore: danger,
      reason: reasons.join(", "),
    };
  }

  // Reduce risk
  if (danger >= 40) {
    return {
      approved: true,
      riskMultiplier: 0.5,
      dangerScore: danger,
      reason: reasons.join(", "),
    };
  }

  if (danger >= 20) {
    return {
      approved: true,
      riskMultiplier: 0.75,
      dangerScore: danger,
      reason: reasons.join(", "),
    };
  }

  return {
    approved: true,
    riskMultiplier: 1,
    dangerScore: danger,
    reason: "system healthy",
  };
}