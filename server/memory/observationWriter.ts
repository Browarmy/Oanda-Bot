// server/memory/observationWriter.ts

import { memoryQuery } from "./memory-db";
import { validateDnaVector, type DnaVector } from "./dnaEncoder";
import { scoreDataIntegrity } from "./dataIntegrityScorer";
import { scoreMemoryQuality } from "./memoryQualityScorer";

export type MemoryObservationWriteInput = {
  instrument: string;
  observedAt: string | Date;
  marketState: Record<string, unknown>;
  dnaVector: DnaVector;
  source?: string;
  timeframe?: string | null;
  decisionContext?: Record<string, unknown> | null;
  outcomeContext?: Record<string, unknown> | null;
  humanSimilarityReview?: Record<string, unknown> | null;
};

export type WrittenMemoryObservation = {
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
};

export type MemoryObservationWriteResult = {
  observation: WrittenMemoryObservation;
  dataIntegrityScore: number;
  memoryQualityScore: number;
  usableForSimilarity: boolean;
};

function toIsoTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new Error("[ObservationWriter] observedAt must be a valid timestamp.");
  }

  return date.toISOString();
}

function ensurePlainObject(
  value: Record<string, unknown> | null | undefined,
  fallback: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (value === undefined) return fallback;
  if (value === null) return null;

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("[ObservationWriter] JSON context values must be plain objects or null.");
  }

  return value;
}

export async function writeMemoryObservation(
  input: MemoryObservationWriteInput
): Promise<MemoryObservationWriteResult> {
  const instrument = input.instrument.trim().toUpperCase();
  const observedAt = toIsoTimestamp(input.observedAt);

  if (!validateDnaVector(input.dnaVector)) {
    throw new Error("[ObservationWriter] dnaVector must contain exactly 10 values between 0.0 and 1.0.");
  }

  const dataIntegrity = scoreDataIntegrity({
    instrument,
    observedAt,
    marketState: input.marketState,
    dnaVector: input.dnaVector,
  });

  if (!dataIntegrity.passed) {
    throw new Error(
      `[ObservationWriter] Observation failed data integrity checks: ${dataIntegrity.issues
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join("; ")}`
    );
  }

  const memoryQuality = scoreMemoryQuality({
    dataIntegrityScore: dataIntegrity.score,
    marketState: input.marketState,
    dnaVector: input.dnaVector,
    observedAt,
  });

  const rows = await memoryQuery<WrittenMemoryObservation>(
    `
      INSERT INTO memory_observations (
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
        human_similarity_review
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        $6::double precision[],
        $7,
        $8,
        $9::jsonb,
        $10::jsonb,
        $11::jsonb
      )
      ON CONFLICT (instrument, observed_at)
      DO UPDATE SET
        source = EXCLUDED.source,
        timeframe = EXCLUDED.timeframe,
        market_state = EXCLUDED.market_state,
        dna_vector = EXCLUDED.dna_vector,
        data_integrity_score = EXCLUDED.data_integrity_score,
        memory_quality_score = EXCLUDED.memory_quality_score,
        decision_context = EXCLUDED.decision_context,
        outcome_context = EXCLUDED.outcome_context,
        human_similarity_review = EXCLUDED.human_similarity_review
      RETURNING *
    `,
    [
      instrument,
      observedAt,
      input.source?.trim() || "trading_engine",
      input.timeframe ?? null,
      JSON.stringify(input.marketState),
      input.dnaVector,
      dataIntegrity.score,
      memoryQuality.score,
      JSON.stringify(ensurePlainObject(input.decisionContext, null)),
      JSON.stringify(ensurePlainObject(input.outcomeContext, null)),
      JSON.stringify(ensurePlainObject(input.humanSimilarityReview, null)),
    ]
  );

  const observation = rows[0];

  if (!observation) {
    throw new Error("[ObservationWriter] Memory observation write returned no row.");
  }

  return {
    observation,
    dataIntegrityScore: dataIntegrity.score,
    memoryQualityScore: memoryQuality.score,
    usableForSimilarity: memoryQuality.usableForSimilarity,
  };
}