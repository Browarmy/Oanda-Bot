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
 * Score a REAL, closed-trade outcome (written by tradeOutcomeLinker.ts).
 * This is ground truth — anchor on won/lost, then scale by how big the win
 * or loss was so a 3R win ranks above a scratch +0.1R win.
 */
function scoreTradeOutcome(outcomeContext: Record<string, unknown>): number {
  const won = outcomeContext["won"] === true;

  const rMultipleRaw = outcomeContext["rMultiple"];
  const rMultiple = typeof rMultipleRaw === "number" && Number.isFinite(rMultipleRaw)
    ? Math.max(-2, Math.min(3, rMultipleRaw))
    : (won ? 1 : -1);

  const base = won ? 0.65 : 0.30;
  const magnitude = rMultiple * 0.08;

  return roundSimilarity(Math.max(0, Math.min(1, base + magnitude)));
}

/**
 * Score a price-drift PROXY outcome (written by outcomeUpdater.ts for
 * observations that never became a trade). Weaker evidence than a real
 * trade — deliberately compressed toward neutral (0.38-0.62 vs. 0.30-0.89
 * for real trades) so real outcomes dominate ranking once they exist for a
 * given DNA pattern.
 */
function scorePriceDriftOutcome(
  outcomeContext: Record<string, unknown>,
  decisionContext: Record<string, unknown> | null
): number {
  const direction = outcomeContext["direction"];
  const finalAction =
    decisionContext && typeof decisionContext === "object" && !Array.isArray(decisionContext)
      ? decisionContext["finalAction"]
      : undefined;

  if (direction === "flat" || (finalAction !== "BUY" && finalAction !== "SELL")) {
    return 0.5;
  }

  const movedWithSignal =
    (finalAction === "BUY" && direction === "up") ||
    (finalAction === "SELL" && direction === "down");
  const movedAgainstSignal =
    (finalAction === "BUY" && direction === "down") ||
    (finalAction === "SELL" && direction === "up");

  if (movedWithSignal) return 0.62;
  if (movedAgainstSignal) return 0.38;
  return 0.5;
}

/**
 * Extract outcome quality score from outcome_context.
 * @param outcomeContext - The outcome context object from memory
 * @param decisionContext - The decision context from the same row (needed to
 *   judge price-drift outcomes against the direction that was signaled)
 * @returns Quality score between 0 (worst) and 1 (best)
 */
function extractOutcomeQualityScore(
  outcomeContext: Record<string, unknown> | null,
  decisionContext: Record<string, unknown> | null
): number {
  if (!outcomeContext || typeof outcomeContext !== "object" || Array.isArray(outcomeContext)) {
    return 0.5; // Not resolved yet — neutral, doesn't drag the composite either way.
  }

  const outcomeTypeRaw = outcomeContext["outcomeType"];
  // Rows written before this change have no outcomeType field but do have
  // pipsMoved — treat those as price_drift for backward compatibility so
  // existing history isn't discarded.
  const outcomeType = typeof outcomeTypeRaw === "string"
    ? outcomeTypeRaw
    : (typeof outcomeContext["pipsMoved"] === "number" ? "price_drift" : "unknown");

  if (outcomeType === "trade") {
    return scoreTradeOutcome(outcomeContext);
  }

  if (outcomeType === "price_drift") {
    return scorePriceDriftOutcome(outcomeContext, decisionContext);
  }

  return 0.5;
}



export async function searchSimilarMemoryObservations(
  input: SimilaritySearchInput
): Promise<SimilarMemoryObservation[]> {
  if (!validateDnaVector(input.dnaVector)) {
    throw new Error("[SimilaritySearch] Query DNA vector must contain exactly 10 values between 0.0 and 1.0.");
  }

  const limit = clampLimit(input.limit);
  const instrument = input.instrument?.trim().toUpperCase();

  // Without pgvector, cosine similarity has to be ranked in JS, so the SQL
  // layer can't do a true top-N search — but it can at least bound the
  // candidate pool instead of pulling every quality-passing row for the
  // instrument on every single decision. Most recent CANDIDATE_POOL_SIZE
  // observations is a reasonable proxy: recent market behavior is usually
  // more relevant anyway, and this keeps the query flat as Memory grows
  // instead of scaling with total table size.
  const CANDIDATE_POOL_SIZE = 1000;

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
      LIMIT $3
    `,
    [MINIMUM_SIMILARITY_QUALITY_SCORE, instrument ?? null, CANDIDATE_POOL_SIZE]
  );


// Half-life for recency weighting — same 45-day choice as
// confidenceCalibrationTracker.ts, for the same reason: FX regimes tend to
// shift over weeks-to-months, so this discounts stale matches without
// being so short that a single quiet week swings rankings around.
const RECENCY_HALF_LIFE_DAYS = 45;

// A match never drops below this weight no matter how old — "Memory never
// forgets" means recency should temper an old-but-precise DNA match, not
// erase it outright. A very old but near-exact match can still outrank a
// recent but mediocre one.
const MIN_RECENCY_WEIGHT = 0.5;

function computeRecencyWeight(observedAt: string): number {
  const ageMs = Date.now() - new Date(observedAt).getTime();
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
  const decay = Math.exp((-Math.LN2 * ageDays) / RECENCY_HALF_LIFE_DAYS);
  return MIN_RECENCY_WEIGHT + (1 - MIN_RECENCY_WEIGHT) * decay;
}

  return rows
    .map((row) => {
      const baseSimilarity = cosineSimilarity(input.dnaVector, row.dna_vector);
      const outcomeQuality = extractOutcomeQualityScore(row.outcome_context, row.decision_context);

      // Composite similarity score: 60% DNA similarity, 40% outcome quality
      // This weights results by how successful similar setups were historically
      const compositeScore = (baseSimilarity * 0.6) + (outcomeQuality * 0.4);
      const recencyWeight = computeRecencyWeight(row.observed_at);
      const finalScore = compositeScore * recencyWeight;

      return {
        ...row,
        similarity_score: roundSimilarity(finalScore),
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
