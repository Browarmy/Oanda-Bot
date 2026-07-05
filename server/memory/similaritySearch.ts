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
};

type MemoryObservationRow = Omit<SimilarMemoryObservation, "similarity_score">;

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
    .map((row) => ({
      ...row,
      similarity_score: cosineSimilarity(input.dnaVector, row.dna_vector),
    }))
    .sort((left, right) => right.similarity_score - left.similarity_score)
    .slice(0, limit);
}

export function calculateDnaCosineSimilarity(
  queryVector: DnaVector,
  storedVector: DnaVector
): number {
  return cosineSimilarity(queryVector, storedVector);
}