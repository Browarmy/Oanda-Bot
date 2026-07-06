// server/memory/historian.ts

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
      similarStatesFound: number;
      minimumRequired: number;
      message: string;
    }
  | {
      status: "ready";
      instrument: string;
      similarStatesFound: number;
      topAnalogues: HistorianAnalogue[];
      historicalDecisionDistribution: {
        BUY: number;
        SELL: number;
        WAIT: number;
        UNKNOWN: number;
      };
      averageConfidenceInSimilarStates: number | null;
      message: string;
    };

const MINIMUM_HISTORIAN_DEPTH = 5;
const HISTORIAN_SEARCH_LIMIT = 10;

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
  if (!context || typeof context !== "object") return undefined;
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

  return rawValue;
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

export async function buildHistorianReport(input: HistorianInput): Promise<HistorianReport> {
  const instrument = input.instrument.trim().toUpperCase();

  const similarObservations = await searchSimilarMemoryObservations({
    instrument,
    dnaVector: input.dnaVector,
    limit: HISTORIAN_SEARCH_LIMIT,
  });

  if (similarObservations.length < MINIMUM_HISTORIAN_DEPTH) {
    return {
      status: "insufficient_memory_depth",
      instrument,
      similarStatesFound: similarObservations.length,
      minimumRequired: MINIMUM_HISTORIAN_DEPTH,
      message: "Insufficient Memory depth for Historian v1 report. Observation only; no decision influence applied.",
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

  return {
    status: "ready",
    instrument,
    similarStatesFound: similarObservations.length,
    topAnalogues: analogues.slice(0, 3),
    historicalDecisionDistribution: buildDecisionDistribution(
      analogues.map((analogue) => analogue.decisionMade)
    ),
    averageConfidenceInSimilarStates: averageConfidence(
      analogues.map((analogue) => analogue.confidenceScore)
    ),
    message: "Historian v1 report generated for observation and logging only. No decision blocking or confidence modification applied.",
  };
}