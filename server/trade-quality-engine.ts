export type TradeQualityGrade = "A+" | "A" | "B" | "C" | "D" | "F";

export interface TradeQualityInput {
  instrument: string;
  direction: "BUY" | "SELL";
  strategy: string;
  regime: string;
  confidence: number;
  pairScore?: number;
  strategyScore?: number;
  regimeScore?: number;
  memoryScore?: number;
  portfolioScore?: number;
  riskScore?: number;
  spreadPips?: number;
  maxSpreadPips?: number;
}

export interface TradeQualityResult {
  score: number;
  grade: TradeQualityGrade;
  approved: boolean;
  expectedEdgeR: number;
  reason: string;
  components: {
    confidence: number;
    pair: number;
    strategy: number;
    regime: number;
    memory: number;
    portfolio: number;
    risk: number;
    spread: number;
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function gradeFromScore(score: number): TradeQualityGrade {
  if (score >= 92) return "A+";
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 65) return "C";
  if (score >= 55) return "D";
  return "F";
}

export function evaluateTradeQuality(input: TradeQualityInput): TradeQualityResult {
  const confidence = clamp01(input.confidence);
  const pair = clamp01(input.pairScore ?? 0.5);
  const strategy = clamp01(input.strategyScore ?? 0.5);
  const regime = clamp01(input.regimeScore ?? 0.5);
  const memory = clamp01(input.memoryScore ?? 0.5);
  const portfolio = clamp01(input.portfolioScore ?? 0.75);
  const risk = clamp01(input.riskScore ?? 0.75);

  const spreadRatio =
    input.maxSpreadPips && input.maxSpreadPips > 0 && typeof input.spreadPips === "number"
      ? input.spreadPips / input.maxSpreadPips
      : 0.5;

  const spread = clamp01(1 - Math.max(0, spreadRatio - 0.5));

  const rawScore =
    confidence * 22 +
    pair * 12 +
    strategy * 14 +
    regime * 12 +
    memory * 14 +
    portfolio * 10 +
    risk * 10 +
    spread * 6;

  const score = Math.round(rawScore * 10) / 10;
  const grade = gradeFromScore(score);

  const expectedEdgeR = Math.round(((score - 50) / 50) * 100) / 100;

  const approved =
    score >= 64 &&
    expectedEdgeR > 0.25 &&
    spread >= 0.25 &&
    risk >= 0.35 &&
    portfolio >= 0.35;

  return {
    score,
    grade,
    approved,
    expectedEdgeR,
    reason: approved
      ? `Nereqo quality ${grade} (${score}/100), expected edge +${expectedEdgeR.toFixed(2)}R`
: `Nereqo quality ${grade} (${score}/100) below execution standard`,
    components: {
      confidence,
      pair,
      strategy,
      regime,
      memory,
      portfolio,
      risk,
      spread,
    },
  };
}