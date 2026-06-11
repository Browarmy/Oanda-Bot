export interface AdaptiveConfidenceInput {
  baseThreshold: number;
  pairScore?: number;
  strategyScore?: number;
  regimeScore?: number;
  confidenceCalibrationScore?: number;
  regimeConfidence?: number;
  riskMood?: "CALM" | "NORMAL" | "HOT" | "DANGEROUS";
}

export interface AdaptiveConfidenceResult {
  threshold: number;
  adjustment: number;
  reason: string;
}

export function calculateAdaptiveConfidenceThreshold(
  input: AdaptiveConfidenceInput
): AdaptiveConfidenceResult {
  let adjustment = 0;
  const reasons: string[] = [];

  const pairScore = input.pairScore ?? 0.5;
  const strategyScore = input.strategyScore ?? 0.5;
  const regimeScore = input.regimeScore ?? 0.5;
  const calibrationScore = input.confidenceCalibrationScore ?? 0.5;

  if (pairScore >= 0.7) {
    adjustment -= 0.02;
    reasons.push("strong pair");
  } else if (pairScore <= 0.4) {
    adjustment += 0.03;
    reasons.push("weak pair");
  }

  if (strategyScore >= 0.7) {
    adjustment -= 0.02;
    reasons.push("strong strategy");
  } else if (strategyScore <= 0.4) {
    adjustment += 0.04;
    reasons.push("weak strategy");
  }

  if (regimeScore >= 0.7) {
    adjustment -= 0.02;
    reasons.push("strong regime");
  } else if (regimeScore <= 0.4) {
    adjustment += 0.04;
    reasons.push("weak regime");
  }

  if (calibrationScore >= 0.7) {
    adjustment -= 0.01;
    reasons.push("well calibrated confidence");
  } else if (calibrationScore <= 0.4) {
    adjustment += 0.03;
    reasons.push("poor confidence calibration");
  }

  if ((input.regimeConfidence ?? 0.5) < 0.45) {
    adjustment += 0.03;
    reasons.push("low regime confidence");
  }

  if (input.riskMood === "HOT") {
    adjustment += 0.03;
    reasons.push("hot market");
  }

  if (input.riskMood === "DANGEROUS") {
    adjustment += 0.08;
    reasons.push("dangerous market");
  }

  const threshold = Math.max(
    0.60,
    Math.min(0.92, input.baseThreshold + adjustment)
  );

  return {
    threshold,
    adjustment,
    reason: reasons.length > 0 ? reasons.join(", ") : "base threshold",
  };
}