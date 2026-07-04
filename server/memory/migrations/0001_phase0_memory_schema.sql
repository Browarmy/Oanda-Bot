-- server/memory/migrations/0001_phase0_memory_schema.sql

BEGIN;

CREATE TABLE IF NOT EXISTS memory_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  instrument TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,

  source TEXT NOT NULL DEFAULT 'trading_engine',
  timeframe TEXT,

  market_state JSONB NOT NULL,
  dna_vector DOUBLE PRECISION[] NOT NULL,

  data_integrity_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  memory_quality_score DOUBLE PRECISION NOT NULL DEFAULT 0.0,

  decision_context JSONB,
  outcome_context JSONB,

  human_similarity_review JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT memory_observations_instrument_not_empty
    CHECK (length(trim(instrument)) > 0),

  CONSTRAINT memory_observations_dna_vector_exactly_10_dimensions
    CHECK (array_length(dna_vector, 1) = 10),

  CONSTRAINT memory_observations_data_integrity_score_range
    CHECK (data_integrity_score >= 0.0 AND data_integrity_score <= 1.0),

  CONSTRAINT memory_observations_memory_quality_score_range
    CHECK (memory_quality_score >= 0.0 AND memory_quality_score <= 1.0)
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_observations_instrument_observed_at_unique_idx
  ON memory_observations (instrument, observed_at);

CREATE INDEX IF NOT EXISTS memory_observations_instrument_observed_at_idx
  ON memory_observations (instrument, observed_at DESC);

CREATE INDEX IF NOT EXISTS memory_observations_quality_idx
  ON memory_observations (memory_quality_score DESC, data_integrity_score DESC);

CREATE INDEX IF NOT EXISTS memory_observations_market_state_gin_idx
  ON memory_observations USING GIN (market_state);

CREATE TABLE IF NOT EXISTS memory_schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO memory_schema_migrations (id)
VALUES ('0001_phase0_memory_schema')
ON CONFLICT (id) DO NOTHING;

COMMIT;