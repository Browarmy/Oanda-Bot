export type RiskMood = "CALM" | "NORMAL" | "HOT" | "DANGEROUS";

export interface AdaptiveConfidenceInput {
  baseThreshold: number;
  pairScore?: number;
  strategyScore?: number;
  regimeScore?: number;
  confidenceCalibrationScore?: number;
  regimeConfidence?: number;
  riskMood?: RiskMood;
}

export interface AdaptiveConfidenceContribution {
  source: string;
  adjustment: number;
  reason: string;
  inputValue: number | string | null;
  beforeThreshold: number;
  afterThreshold: number;
}

export interface AdaptiveConfidenceResult {
  threshold: number;
  adjustment: number;
  reason: string;
  baseThreshold: number;
  contributions: AdaptiveConfidenceContribution[];
  diagnostics: {
    pairScore: number;
    strategyScore: number;
    regimeScore: number;
    confidenceCalibrationScore: number;
    regimeConfidence: number;
    riskMood: RiskMood;
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(4));
}

function normaliseScore(value: number | undefined, fallback: number): number {
  return clamp(typeof value === "number" ? value : fallback, 0, 1);
}

function normaliseRiskMood(value: RiskMood | undefined): RiskMood {
  if (value === "CALM" || value === "NORMAL" || value === "HOT" || value === "DANGEROUS") {
    return value;
  }

  return "NORMAL";
}

function addContribution(params: {
  contributions: AdaptiveConfidenceContribution[];
  source: string;
  adjustment: number;
  reason: string;
  inputValue: number | string | null;
  currentThreshold: number;
}): number {
  if (params.adjustment === 0) return params.currentThreshold;

  const afterThreshold = params.currentThreshold + params.adjustment;

  params.contributions.push({
    source: params.source,
    adjustment: round(params.adjustment),
    reason: params.reason,
    inputValue: params.inputValue,
    beforeThreshold: round(params.currentThreshold),
    afterThreshold: round(afterThreshold),
  });

  return afterThreshold;
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function calculateAdaptiveConfidenceThreshold(
  input: AdaptiveConfidenceInput
): AdaptiveConfidenceResult {
  const baseThreshold = clamp(input.baseThreshold, 0.6, 0.86);

  const pairScore = normaliseScore(input.pairScore, 0.5);
  const strategyScore = normaliseScore(input.strategyScore, 0.5);
  const regimeScore = normaliseScore(input.regimeScore, 0.5);
  const confidenceCalibrationScore = normaliseScore(input.confidenceCalibrationScore, 0.5);
  const regimeConfidence = normaliseScore(input.regimeConfidence, 0.5);
  const riskMood = normaliseRiskMood(input.riskMood);

  const contributions: AdaptiveConfidenceContribution[] = [];
  let workingThreshold = baseThreshold;

  if (pairScore >= 0.7) {
    workingThreshold = addContribution({
      contributions,
      source: "PAIR_LEARNING",
      adjustment: -0.02,
      reason: "strong pair",
      inputValue: round(pairScore),
      currentThreshold: workingThreshold,
    });
  } else if (pairScore <= 0.4) {
    workingThreshold = addContribution({
      contributions,
      source: "PAIR_LEARNING",
      adjustment: 0.03,
      reason: "weak pair",
      inputValue: round(pairScore),
      currentThreshold: workingThreshold,
    });
  }

  if (strategyScore >= 0.7) {
    workingThreshold = addContribution({
      contributions,
      source: "STRATEGY_LEARNING",
      adjustment: -0.02,
      reason: "strong strategy",
      inputValue: round(strategyScore),
      currentThreshold: workingThreshold,
    });
  } else if (strategyScore <= 0.4) {
    workingThreshold = addContribution({
      contributions,
      source: "STRATEGY_LEARNING",
      adjustment: 0.01,
      reason: "weak strategy",
      inputValue: round(strategyScore),
      currentThreshold: workingThreshold,
    });
  }

  if (regimeScore >= 0.7) {
    workingThreshold = addContribution({
      contributions,
      source: "REGIME_LEARNING",
      adjustment: -0.02,
      reason: "strong regime",
      inputValue: round(regimeScore),
      currentThreshold: workingThreshold,
    });
  } else if (regimeScore <= 0.4) {
    workingThreshold = addContribution({
      contributions,
      source: "REGIME_LEARNING",
      adjustment: 0.01,
      reason: "weak regime",
      inputValue: round(regimeScore),
      currentThreshold: workingThreshold,
    });
  }

  if (confidenceCalibrationScore >= 0.7) {
    workingThreshold = addContribution({
      contributions,
      source: "CONFIDENCE_CALIBRATION",
      adjustment: -0.01,
      reason: "well calibrated confidence",
      inputValue: round(confidenceCalibrationScore),
      currentThreshold: workingThreshold,
    });
  } else if (confidenceCalibrationScore <= 0.4) {
    workingThreshold = addContribution({
      contributions,
      source: "CONFIDENCE_CALIBRATION",
      adjustment: 0.02,
      reason: "poor confidence calibration",
      inputValue: round(confidenceCalibrationScore),
      currentThreshold: workingThreshold,
    });
  }

  if (regimeConfidence < 0.45) {
    workingThreshold = addContribution({
      contributions,
      source: "REGIME_CONFIDENCE",
      adjustment: 0.02,
      reason: "low regime confidence",
      inputValue: round(regimeConfidence),
      currentThreshold: workingThreshold,
    });
  }

  if (riskMood === "HOT") {
    workingThreshold = addContribution({
      contributions,
      source: "RISK_MOOD",
      adjustment: 0.03,
      reason: "hot market",
      inputValue: riskMood,
      currentThreshold: workingThreshold,
    });
  }

  if (riskMood === "DANGEROUS") {
    workingThreshold = addContribution({
      contributions,
      source: "RISK_MOOD",
      adjustment: 0.08,
      reason: "dangerous market",
      inputValue: riskMood,
      currentThreshold: workingThreshold,
    });
  }

  const unclampedThreshold = workingThreshold;
  const threshold = clamp(unclampedThreshold, 0.6, 0.86);
  const adjustment = round(threshold - baseThreshold);

  if (threshold !== unclampedThreshold) {
    contributions.push({
      source: "SAFETY_CLAMP",
      adjustment: round(threshold - unclampedThreshold),
      reason: "threshold clamped to safe operating range",
      inputValue: `${formatPct(0.6)}-${formatPct(0.86)}`,
      beforeThreshold: round(unclampedThreshold),
      afterThreshold: round(threshold),
    });
  }

  const reason =
    contributions.length > 0
      ? `base ${formatPct(baseThreshold)} → final ${formatPct(threshold)} | ` +
        contributions
          .map((item) => {
            const sign = item.adjustment >= 0 ? "+" : "";
            return `${item.source} ${sign}${formatPct(item.adjustment)} ${item.reason}`;
          })
          .join(" | ")
      : `base threshold ${formatPct(baseThreshold)} with no adaptive adjustment`;

  return {
    threshold: round(threshold),
    adjustment,
    reason,
    baseThreshold: round(baseThreshold),
    contributions,
    diagnostics: {
      pairScore: round(pairScore),
      strategyScore: round(strategyScore),
      regimeScore: round(regimeScore),
      confidenceCalibrationScore: round(confidenceCalibrationScore),
      regimeConfidence: round(regimeConfidence),
      riskMood,
    },
  };
}