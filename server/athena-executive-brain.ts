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

export interface AthenaExecutiveBreakdown {
  confidence: number;
  meta: number;
  quality: number;
  neuralScore: number;
  expectedValue: number;
  cio: number;
  forecast: number;
  strategyRotation: number;
  execution: number;
  safety: number;
}

export interface AthenaExecutiveDecision {
  approved: boolean;
  score: number;
  grade: "A+" | "A" | "B" | "C" | "D" | "F";
  riskMultiplier: number;
  reason: string;
  breakdown?: AthenaExecutiveBreakdown;
}

function formatComponentList(components: Array<[string, number]>, count: number = 3): string {
  return components
    .slice(0, count)
    .map(([name, score]) => `${name} ${score.toFixed(0)}`)
    .join(" | ");
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

  const breakdown: AthenaExecutiveBreakdown = {
    confidence: confidenceScore,
    meta,
    quality: input.athenaQualityScore,
    neuralScore: input.neuralScore,
    expectedValue: evScore,
    cio: input.cioScore,
    forecast: input.forecastScore,
    strategyRotation: input.strategyRotationScore,
    execution: input.executionScore,
    safety: safetyScore,
  };

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

  let reason: string;

  if (finalScore < 60) {
    // BLOCK: Show 3 weakest components
    const componentArray = Object.entries(breakdown) as Array<[string, number]>;
    const sorted = componentArray.sort(([, a], [, b]) => a - b);
    const weakComponents = formatComponentList(sorted, 3);
    reason = `executive score too low: ${finalScore.toFixed(0)}/100 — weak: ${weakComponents}`;
  } else {
    // APPROVE: Show 3 strongest components
    const componentArray = Object.entries(breakdown) as Array<[string, number]>;
    const sorted = componentArray.sort(([, a], [, b]) => b - a);
    const strongComponents = formatComponentList(sorted, 3);
    reason = `executive grade ${grade}, score ${finalScore.toFixed(0)}/100 — strong: ${strongComponents}`;
  }

  return {
    approved: finalScore >= 60,
    score: finalScore,
    grade,
    riskMultiplier:
      finalScore >= 88 ? 1.1 :
      finalScore >= 78 ? 1.0 :
      finalScore >= 68 ? 0.8 :
      0.6,
    reason,
    breakdown,
  };
}
