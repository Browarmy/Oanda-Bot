export interface AthenaConfidenceInput {
  pairScore?: number;
  strategyScore?: number;
  regimeScore?: number;
  memoryScore?: number;
  confidenceCalibration?: number;
  trendScore?: number;
  volatilityScore?: number;
  spreadScore?: number;
  portfolioScore?: number;
  riskScore?: number;
  executionScore?: number;
}

export interface AthenaConfidenceResult {
  score: number;
  confidence: number;
  grade: string;
  approved: boolean;
  expectedEdgeR: number;
  reasons: string[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function evaluateAthenaConfidence(
  input: AthenaConfidenceInput
): AthenaConfidenceResult {
  const weights = {
    pair: 12,
    strategy: 8,
    regime: 7,
    memory: 15,
    calibration: 8,
    trend: 10,
    volatility: 8,
    spread: 8,
    portfolio: 10,
    risk: 10,
    execution: 14,
  };

  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);

  const score =
    (input.pairScore ?? 0.5) * weights.pair +
    (input.strategyScore ?? 0.5) * weights.strategy +
    (input.regimeScore ?? 0.5) * weights.regime +
    (input.memoryScore ?? 0.5) * weights.memory +
    (input.confidenceCalibration ?? 0.5) * weights.calibration +
    (input.trendScore ?? 0.5) * weights.trend +
    (input.volatilityScore ?? 0.5) * weights.volatility +
    (input.spreadScore ?? 0.5) * weights.spread +
    (input.portfolioScore ?? 0.5) * weights.portfolio +
    (input.riskScore ?? 0.5) * weights.risk +
    (input.executionScore ?? 0.5) * weights.execution;

  const confidence = clamp(score / totalWeight, 0, 1);

  let grade = "F";

  if (confidence >= 0.95) grade = "A+";
  else if (confidence >= 0.90) grade = "A";
  else if (confidence >= 0.85) grade = "A-";
  else if (confidence >= 0.80) grade = "B+";
  else if (confidence >= 0.75) grade = "B";
  else if (confidence >= 0.65) grade = "C+";
  else if (confidence >= 0.60) grade = "C";
  else if (confidence >= 0.55) grade = "D";
  else grade = "F";


  // Independent approval gate.
  // This runs after ~20 other trading filters, so it should remain
  // less restrictive than the grading ladder.
  const APPROVAL_THRESHOLD = 0.62;

  const approved = confidence >= APPROVAL_THRESHOLD;

  const expectedEdgeR = (confidence - 0.5) * 4;

  const reasons: string[] = [];

  if ((input.memoryScore ?? 0.5) > 0.7)
    reasons.push("Strong historical memory");

  if ((input.strategyScore ?? 0.5) > 0.7)
    reasons.push("Strategy performing well");

  if ((input.regimeScore ?? 0.5) > 0.7)
    reasons.push("Good regime alignment");

  if ((input.portfolioScore ?? 0.5) < 0.4)
    reasons.push("Portfolio exposure elevated");

  if ((input.spreadScore ?? 0.5) < 0.4)
    reasons.push("Spread reducing quality");

  if ((input.riskScore ?? 0.5) < 0.4)
    reasons.push("Current account risk elevated");

  return {
    score: Math.round(confidence * 100),
    confidence,
    grade,
    approved,
    expectedEdgeR,
    reasons,
  };
}