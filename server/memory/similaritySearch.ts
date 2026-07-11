// server/memory/similaritySearch.ts

import { memoryQuery } from "./memory-db";
import { validateDnaVector, type DnaVector } from "./dnaEncoder";

export type SimilaritySearchInput = {
  instrument?: string;
  dnaVector: DnaVector;
  limit?: number;
};

export type SimilarMemoryObservation = {
  id: string;
  instrument: string;
  observed_at: string;
  source: string;
  timeframe: string | null;
  market_state: Record<string, unknown>;
  dna_vector: number[];
  data_integrity_score: number;
  memory_quality_score: number;
  decision_context: Record<string, unknown> | null;
  outcome_context: Record<string, unknown> | null;
  human_similarity_review: Record<string, unknown> | null;
  created_at: string;
  similarity_score: number;
  outcomeQualityScore?: number;
};

type MemoryObservationRow = Omit<SimilarMemoryObservation, "similarity_score" | "outcomeQualityScore">;

const MINIMUM_SIMILARITY_QUALITY_SCORE = 0.7;
const DEFAULT_SIMILARITY_LIMIT = 10;
const MAX_SIMILARITY_LIMIT = 50;

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit ?? DEFAULT_SIMILARITY_LIMIT)) {
    return DEFAULT_SIMILARITY_LIMIT;
  }

  return Math.max(1, Math.min(MAX_SIMILARITY_LIMIT, Math.floor(limit ?? DEFAULT_SIMILARITY_LIMIT)));
}

function roundSimilarity(value: number): number {
  if (!Number.isFinite(value)) return 0.0;
  return Number(Math.max(0.0, Math.min(1.0, value)).toFixed(6));
}

function cosineSimilarity(queryVector: DnaVector, storedVector: number[]): number {
  if (!validateDnaVector(storedVector)) return 0.0;

  let dotProduct = 0.0;
  let queryMagnitude = 0.0;
  let storedMagnitude = 0.0;

  for (let index = 0; index < queryVector.length; index += 1) {
    const queryValue = queryVector[index];
    const storedValue = storedVector[index];

    dotProduct += queryValue * storedValue;
    queryMagnitude += queryValue * queryValue;
    storedMagnitude += storedValue * storedValue;
  }

  if (queryMagnitude === 0.0 || storedMagnitude === 0.0) {
    return 0.0;
  }

  return roundSimilarity(dotProduct / (Math.sqrt(queryMagnitude) * Math.sqrt(storedMagnitude)));
}

/**
 * Extract outcome quality score from outcome_context
 * @param outcomeContext - The outcome context object from memory
 * @returns Quality score between 0 (worst) and 1 (best)
 */
function extractOutcomeQualityScore(outcomeContext: Record<string, unknown> | null): number {
  if (!outcomeContext || typeof outcomeContext !== "object" || Array.isArray(outcomeContext)) {
    return 0.5; // Default neutral score if no outcome data
  }

  // Extract win rate if available (0-1)
  const winRateRaw = outcomeContext["winRate"];
  const winRate = typeof winRateRaw === "number" && Number.isFinite(winRateRaw)
    ? Math.max(0, Math.min(1, winRateRaw))
    : 0.5;

  // Extract profit factor if available (typical range 0.5-3.0)
  const profitFactorRaw = outcomeContext["profitFactor"];
  const profitFactor = typeof profitFactorRaw === "number" && Number.isFinite(profitFactorRaw)
    ? Math.max(0.5, Math.min(3.0, profitFactorRaw))
    : 1.0;

  // Normalize profit factor to 0-1 (divide by 3.0 to cap at good PF)
  const normalizedPF = profitFactor / 3.0;

  // Composite quality: 60% win rate, 40% profit factor
  const qualityScore = (winRate * 0.6) + (normalizedPF * 0.4);

  return roundSimilarity(Math.max(0, Math.min(1, qualityScore)));
}

export async function searchSimilarMemoryObservations(
  input: SimilaritySearchInput
): Promise<SimilarMemoryObservation[]> {
  if (!validateDnaVector(input.dnaVector)) {
    throw new Error("[SimilaritySearch] Query DNA vector must contain exactly 10 values between 0.0 and 1.0.");
  }

  const limit = clampLimit(input.limit);
  const instrument = input.instrument?.trim().toUpperCase();

  const rows = await memoryQuery<MemoryObservationRow>(
    `
      SELECT
        id,
        instrument,
        observed_at,
        source,
        timeframe,
        market_state,
        dna_vector,
        data_integrity_score,
        memory_quality_score,
        decision_context,
        outcome_context,
        human_similarity_review,
        created_at
      FROM memory_observations
      WHERE memory_quality_score >= $1
        AND ($2::text IS NULL OR instrument = $2)
      ORDER BY observed_at DESC
    `,
    [MINIMUM_SIMILARITY_QUALITY_SCORE, instrument ?? null]
  );

  return rows
    .map((row) => {
      const baseSimilarity = cosineSimilarity(input.dnaVector, row.dna_vector);
      const outcomeQuality = extractOutcomeQualityScore(row.outcome_context);

      // Composite similarity score: 60% DNA similarity, 40% outcome quality
      // This weights results by how successful similar setups were historically
      const compositeScore = (baseSimilarity * 0.6) + (outcomeQuality * 0.4);

      return {
        ...row,
        similarity_score: roundSimilarity(compositeScore),
        outcomeQualityScore: outcomeQuality,
      };
    })
    .sort((left, right) => right.similarity_score - left.similarity_score)
    .slice(0, limit);
}

export function calculateDnaCosineSimilarity(
  queryVector: DnaVector,
  storedVector: DnaVector
): number {
  return cosineSimilarity(queryVector, storedVector);
}
