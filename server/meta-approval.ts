export type MetaDecisionDirection = "BUY" | "SELL";

interface LearningScoreInput {
  trades?: number;
  score?: number;
  enabled?: boolean;
  winRate?: number;
  profitFactor?: number;
}

interface ConfidenceCalibrationInput {
  trades?: number;
  calibratedScore?: number;
  winRate?: number;
  profitFactor?: number;
  bucket?: string;
}

export interface MetaApprovalInput {
  instrument: string;
  direction: MetaDecisionDirection;
  strategy: string;
  regime: string;
  confidence: number;
  baseRiskPct: number;

  pairLearning?: LearningScoreInput;
  strategyLearning?: LearningScoreInput;
  regimeLearning?: LearningScoreInput;
  confidenceCalibration?: ConfidenceCalibrationInput;
}

export interface MetaApprovalResult {
  approved: boolean;
  reason: string;
  metaScore: number;
  riskMultiplier: number;
  components: {
    pairScore: number;
    strategyScore: number;
    regimeScore: number;
    confidenceScore: number;
    rawConfidenceScore: number;
  };
}

function usableScore(
  item: LearningScoreInput | undefined,
  minTrades = 5
): number {
  if (!item || (item.trades ?? 0) < minTrades) return 0.5;

  if (typeof item.score === "number") {
    return Math.max(0, Math.min(1, item.score));
  }

  const wr = item.winRate ?? 0.5;
  const pf = Math.min((item.profitFactor ?? 1) / 2.5, 1);

  return Math.max(
    0,
    Math.min(
      1,
      wr * 0.6 + pf * 0.4
    )
  );
}

function confidenceScore(
  calibration: ConfidenceCalibrationInput | undefined,
  confidence: number
): number {
  const rawConfidenceScore = Math.max(0, Math.min(1, confidence));

  if (!calibration || (calibration.trades ?? 0) < 5) {
    return rawConfidenceScore;
  }

  if (typeof calibration.calibratedScore === "number") {
    return Math.max(0, Math.min(1, calibration.calibratedScore));
  }

  const wr = calibration.winRate ?? 0.5;
  const pf = Math.min((calibration.profitFactor ?? 1) / 2.5, 1);

  return Math.max(
    0,
    Math.min(
      1,
      wr * 0.65 + pf * 0.35
    )
  );
}

function hasEnoughEvidence(item: LearningScoreInput | undefined): boolean {
  return (item?.trades ?? 0) >= 10;
}

export function evaluateMetaApproval(
  input: MetaApprovalInput
): MetaApprovalResult {
  const pairScore = usableScore(input.pairLearning, 5);
  const strategyScore = usableScore(input.strategyLearning, 5);
  const regimeScore = usableScore(input.regimeLearning, 5);
  const confScore = confidenceScore(
    input.confidenceCalibration,
    input.confidence
  );

  const rawConfidenceScore =
    Math.max(0, Math.min(1, input.confidence));

  const strategyDisabled =
    input.strategyLearning?.enabled === false &&
    hasEnoughEvidence(input.strategyLearning);

  if (strategyDisabled) {
    return {
      approved: false,
      reason:
        `Strategy ${input.strategy} is disabled by learning engine`,
      metaScore: 0,
      riskMultiplier: 0,
      components: {
        pairScore,
        strategyScore,
        regimeScore,
        confidenceScore: confScore,
        rawConfidenceScore,
      },
    };
  }

  const regimeDisabled =
    input.regimeLearning?.enabled === false &&
    hasEnoughEvidence(input.regimeLearning);

  if (regimeDisabled) {
    return {
      approved: false,
      reason:
        `Regime ${input.regime} is disabled by learning engine`,
      metaScore: 0,
      riskMultiplier: 0,
      components: {
        pairScore,
        strategyScore,
        regimeScore,
        confidenceScore: confScore,
        rawConfidenceScore,
      },
    };
  }

  const metaScore =
    pairScore * 0.20 +
    strategyScore * 0.30 +
    regimeScore * 0.25 +
    confScore * 0.25;

  const hasStrongEvidence =
    hasEnoughEvidence(input.strategyLearning) ||
    hasEnoughEvidence(input.regimeLearning) ||
    (input.confidenceCalibration?.trades ?? 0) >= 10;

  if (hasStrongEvidence && metaScore < 0.38) {
    return {
      approved: false,
      reason:
        `Meta score ${(metaScore * 100).toFixed(0)}% too weak ` +
        `(pair ${(pairScore * 100).toFixed(0)}%, ` +
        `strategy ${(strategyScore * 100).toFixed(0)}%, ` +
        `regime ${(regimeScore * 100).toFixed(0)}%, ` +
        `confidence ${(confScore * 100).toFixed(0)}%)`,
      metaScore,
      riskMultiplier: 0,
      components: {
        pairScore,
        strategyScore,
        regimeScore,
        confidenceScore: confScore,
        rawConfidenceScore,
      },
    };
  }

  let riskMultiplier = 1.0;

  if (metaScore < 0.45) {
    riskMultiplier = 0.55;
  } else if (metaScore < 0.55) {
    riskMultiplier = 0.7;
  } else if (metaScore < 0.65) {
    riskMultiplier = 0.85;
  }

  return {
    approved: true,
    reason:
      `Meta score ${(metaScore * 100).toFixed(0)}% | ` +
      `risk x${riskMultiplier.toFixed(2)} | ` +
      `pair ${(pairScore * 100).toFixed(0)}% | ` +
      `strategy ${(strategyScore * 100).toFixed(0)}% | ` +
      `regime ${(regimeScore * 100).toFixed(0)}% | ` +
      `confidence ${(confScore * 100).toFixed(0)}%`,
    metaScore,
    riskMultiplier,
    components: {
      pairScore,
      strategyScore,
      regimeScore,
      confidenceScore: confScore,
      rawConfidenceScore,
    },
  };
}
