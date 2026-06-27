export interface AthenaExecutiveInput {
  confidence: number;
  metaScore: number;
  athenaQualityScore: number;
  athenaConfidenceScore: number;
  neuralScore: number;
  expectedValueR: number;

  cioScore: number;
  forecastScore: number;
  strategyRotationScore: number;
  executionScore: number;
  safetyDangerScore: number;
}

export interface AthenaExecutiveDecision {
  approved: boolean;
  score: number;
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  riskMultiplier: number;
  reason: string;
}

export function evaluateAthenaExecutiveBrain(
  input: AthenaExecutiveInput
): AthenaExecutiveDecision {
  const confidenceScore = input.confidence * 100;
  const meta = input.metaScore * 100;
  const safetyScore = Math.max(0, 100 - input.safetyDangerScore);

  const evScore =
    input.expectedValueR >= 0.5 ? 100 :
    input.expectedValueR >= 0.25 ? 80 :
    input.expectedValueR >= 0.1 ? 60 :
    input.expectedValueR >= 0 ? 45 :
    20;

  const score =
    confidenceScore * 0.10 +
    meta * 0.12 +
    input.athenaQualityScore * 0.15 +
    input.athenaConfidenceScore * 0.12 +
    input.neuralScore * 0.16 +
    evScore * 0.10 +
    input.cioScore * 0.10 +
    input.forecastScore * 0.06 +
    input.strategyRotationScore * 0.05 +
    input.executionScore * 0.08 +
    safetyScore * 0.06;

  const finalScore = Math.max(0, Math.min(100, score));

  const grade: AthenaExecutiveDecision["grade"] =
    finalScore >= 90 ? "A+" :
    finalScore >= 82 ? "A" :
    finalScore >= 72 ? "B" :
    finalScore >= 62 ? "C" :
    finalScore >= 50 ? "D" :
    "F";

  if (finalScore < 60) {
    return {
      approved: false,
      score: finalScore,
      grade,
      riskMultiplier: 0,
      reason: `executive score too low: ${finalScore.toFixed(0)}/100`,
    };
  }

  return {
    approved: true,
    score: finalScore,
    grade,
    riskMultiplier:
      finalScore >= 88 ? 1.1 :
      finalScore >= 78 ? 1.0 :
      finalScore >= 68 ? 0.8 :
      0.6,
    reason: `executive grade ${grade}, score ${finalScore.toFixed(0)}/100`,
  };
}