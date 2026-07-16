// server/memory/historian.ts

import { memoryQuery } from "./memory-db";
import { searchSimilarMemoryObservations } from "./similaritySearch";
import type { DnaVector } from "./dnaEncoder";

export type HistorianInput = {
  instrument: string;
  dnaVector: DnaVector;
};

export type HistoricalDecision = "BUY" | "SELL" | "WAIT" | "UNKNOWN";

export type HistorianAnalogue = {
  observationId: string;
  observedAt: string;
  similarityScore: number;
  decisionMade: HistoricalDecision;
  confidenceScore: number | null;
  memoryQualityScore: number;
};

export type HistorianReport =
  | {
      status: "insufficient_memory_depth";
      instrument: string;
      totalObservations: number;
      qualityObservations: number;
      similarStatesFound: number;
      minimumRequired: number;
      message: string;
    }
  | {
      status: "ready";
      instrument: string;
      totalObservations: number;
      qualityObservations: number;
      similarStatesFound: number;
      topAnalogues: HistorianAnalogue[];
      historicalDecisionDistribution: {
        BUY: number;
        SELL: number;
        WAIT: number;
        UNKNOWN: number;
      };
      averageConfidenceInSimilarStates: number | null;
      historianConfidenceAdjustment: number;
      message: string;
    };

type MemoryDepthRow = {
  total_observations: string;
  quality_observations: string;
};

const MINIMUM_HISTORIAN_DEPTH = 10;
const HISTORIAN_SEARCH_LIMIT = 25;
const QUALITY_SCORE_FLOOR = 0.7;

function roundPercent(value: number): number {
  if (!Number.isFinite(value)) return 0.0;
  return Number(value.toFixed(2));
}

function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0.0;
  return Number(value.toFixed(6));
}

function getDecisionContextValue(
  context: Record<string, unknown> | null,
  key: string
): unknown {
  if (!context || typeof context !== "object" || Array.isArray(context)) return undefined;
  return context[key];
}

function extractDecisionMade(context: Record<string, unknown> | null): HistoricalDecision {
  const value = String(getDecisionContextValue(context, "finalAction") ?? "").toUpperCase();

  if (value === "BUY" || value === "SELL" || value === "WAIT") return value;

  return "UNKNOWN";
}

function extractConfidenceScore(context: Record<string, unknown> | null): number | null {
  const rawValue = getDecisionContextValue(context, "finalConfidence");

  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    return null;
  }

  return Math.max(0.0, Math.min(1.0, rawValue));
}

async function getMemoryDepth(instrument: string): Promise<{
  totalObservations: number;
  qualityObservations: number;
}> {
  const rows = await memoryQuery<MemoryDepthRow>(
    `
      SELECT
        COUNT(*)::text AS total_observations,
        COUNT(*) FILTER (
          WHERE memory_quality_score >= $2
            AND data_integrity_score >= $2
        )::text AS quality_observations
      FROM memory_observations
      WHERE instrument = $1
    `,
    [instrument, QUALITY_SCORE_FLOOR]
  );

  return {
       totalObservations: Number(rows[0]?.total_observations ?? 0),
    qualityObservations: Number(rows[0]?.quality_observations ?? 0),
  };
}

function buildDecisionDistribution(decisions: HistoricalDecision[]): {
  BUY: number;
  SELL: number;
  WAIT: number;
  UNKNOWN: number;
} {
  const counts = {
    BUY: 0,
    SELL: 0,
    WAIT: 0,
    UNKNOWN: 0,
  };

  for (const decision of decisions) {
    counts[decision] += 1;
  }

  const total = decisions.length || 1;

  return {
    BUY: roundPercent((counts.BUY / total) * 100),
    SELL: roundPercent((counts.SELL / total) * 100),
    WAIT: roundPercent((counts.WAIT / total) * 100),
    UNKNOWN: roundPercent((counts.UNKNOWN / total) * 100),
  };
}

function averageConfidence(confidenceScores: Array<number | null>): number | null {
  const validScores = confidenceScores.filter(
    (score): score is number => typeof score === "number" && Number.isFinite(score)
  );

  if (validScores.length === 0) return null;

  const total = validScores.reduce((sum, score) => sum + score, 0.0);

  return roundPercent(total / validScores.length);
}

/**
 * Calculate confidence adjustment based on historical decision agreement
 * @param distribution - Historical decision distribution percentages
 * @param decisionMade - Our current decision (BUY, SELL, WAIT)
 * @param similarStatesFound - Number of similar past states found
 * @returns Confidence adjustment between -0.05 and +0.05
 */
function calculateHistorianConfidenceAdjustment(
  distribution: { BUY: number; SELL: number; WAIT: number; UNKNOWN: number },
  decisionMade: HistoricalDecision,
  similarStatesFound: number
): number {
  if (decisionMade === "UNKNOWN") return 0;

  const decisionPercentage = (distribution[decisionMade] ?? 0) / 100;

  // Strong agreement: similar past states favored this decision 70%+ AND we have 8+ similar states
  if (decisionPercentage >= 0.70 && similarStatesFound >= 8) {
    return 0.04; // +4% confidence boost
  }

  // Moderate agreement: 55-70% AND 10+ similar states
  if (decisionPercentage >= 0.55 && similarStatesFound >= 10) {
    return 0.02; // +2% confidence boost
  }

  // Weak agreement: 45-55% (no adjustment)
  if (decisionPercentage >= 0.45 && decisionPercentage < 0.55) {
    return 0;
  }

  // Significant disagreement: past states contradict us (< 40%) AND we have 5+ similar states
  if (decisionPercentage < 0.40 && similarStatesFound >= 5) {
    return -0.05; // -5% confidence penalty
  }

  // Moderate disagreement: 40-45% AND 8+ similar states
  if (decisionPercentage < 0.45 && decisionPercentage >= 0.40 && similarStatesFound >= 8) {
    return -0.02; // -2% confidence penalty
  }

  return 0;
}

export async function buildHistorianReport(input: HistorianInput): Promise<HistorianReport> {
  const instrument = input.instrument.trim().toUpperCase();

  const [memoryDepth, similarObservations] = await Promise.all([
    getMemoryDepth(instrument),
    searchSimilarMemoryObservations({
      instrument,
      dnaVector: input.dnaVector,
      limit: HISTORIAN_SEARCH_LIMIT,
    }),
  ]);

  if (similarObservations.length < MINIMUM_HISTORIAN_DEPTH) {
    return {
      status: "insufficient_memory_depth",
      instrument,
      totalObservations: memoryDepth.totalObservations,
      qualityObservations: memoryDepth.qualityObservations,
      similarStatesFound: similarObservations.length,
      minimumRequired: MINIMUM_HISTORIAN_DEPTH,
      message:
        "Insufficient Memory depth for Historian v1 report. Observation only; no decision influence applied.",
    };
  }

  const analogues: HistorianAnalogue[] = similarObservations.map((observation) => {
    const decisionMade = extractDecisionMade(observation.decision_context);
    const confidenceScore = extractConfidenceScore(observation.decision_context);

    return {
      observationId: observation.id,
      observedAt: observation.observed_at,
      similarityScore: roundScore(observation.similarity_score),
      decisionMade,
      confidenceScore,
      memoryQualityScore: roundScore(observation.memory_quality_score),
    };
  });

  const decisionDistribution = buildDecisionDistribution(
    analogues.map((analogue) => analogue.decisionMade)
  );

  // Determine the most likely decision from historical data
  const decisions = analogues.map(a => a.decisionMade);
  let mostLikelyDecision: HistoricalDecision = "UNKNOWN";
  let maxCount = 0;
  const counts: Record<HistoricalDecision, number> = { BUY: 0, SELL: 0, WAIT: 0, UNKNOWN: 0 };
  
  for (const decision of decisions) {
    counts[decision] = (counts[decision] ?? 0) + 1;
    if (counts[decision] > maxCount) {
      maxCount = counts[decision];
      mostLikelyDecision = decision;
    }
  }

  const historianConfidenceAdjustment = calculateHistorianConfidenceAdjustment(
    decisionDistribution,
    mostLikelyDecision,
    similarObservations.length
  );

  return {
    status: "ready",
    instrument,
    totalObservations: memoryDepth.totalObservations,
    qualityObservations: memoryDepth.qualityObservations,
    similarStatesFound: similarObservations.length,
    topAnalogues: analogues.slice(0, 3),
    historicalDecisionDistribution: decisionDistribution,
    averageConfidenceInSimilarStates: averageConfidence(
      analogues.map((analogue) => analogue.confidenceScore)
    ),
    historianConfidenceAdjustment,
    message:
      "Historian v1 report generated. Confidence adjustment computed and ready for Athena integration.",
  };
}
