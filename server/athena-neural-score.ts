export interface AthenaNeuralInput {
  qualityScore: number;
  confidenceScore: number;
  expectedValueR: number;
  metaScore: number;
  executionScore: number;
  safetyScore: number;
  portfolioScore: number;
}

export interface AthenaNeuralResult {
  score: number;
  approved: boolean;
  grade: "A+" | "A" | "B" | "C" | "D";
  reason: string;
}

export function evaluateAthenaNeuralScore(
  input: AthenaNeuralInput
): AthenaNeuralResult {
  const evScore = Math.max(0, Math.min(100, 50 + input.expectedValueR * 50));

  const score =
    input.qualityScore * 0.22 +
    input.confidenceScore * 0.20 +
    evScore * 0.18 +
    input.metaScore * 100 * 0.15 +
    input.executionScore * 0.10 +
    input.safetyScore * 0.08 +
    input.portfolioScore * 0.07;

  const rounded = Math.round(score);

  const grade =
    rounded >= 90 ? "A+" :
    rounded >= 82 ? "A" :
    rounded >= 72 ? "B" :
    rounded >= 62 ? "C" : "D";

  return {
    score: rounded,
    approved: rounded >= 72 && input.expectedValueR > 0,
    grade,
    reason: `Neural ${rounded}/100 ${grade} | EV ${input.expectedValueR.toFixed(2)}R`,
  };
}