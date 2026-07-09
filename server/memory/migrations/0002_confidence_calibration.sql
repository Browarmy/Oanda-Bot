BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS memory_confidence_calibration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument TEXT NOT NULL,
  confidence_bucket TEXT NOT NULL CHECK (
    confidence_bucket IN ('70-75', '75-80', '80-85', '85-90', '90plus')
  ),
  stated_confidence DOUBLE PRECISION NOT NULL CHECK (
    stated_confidence >= 0.0 AND stated_confidence <= 1.0
  ),
  actual_outcome TEXT NOT NULL CHECK (
    actual_outcome IN ('won', 'lost')
  ),
  pips DOUBLE PRECISION NOT NULL,
  r_multiple DOUBLE PRECISION NOT NULL,
  regime TEXT NOT NULL,
  strategy TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_confidence_calibration_instrument_bucket
  ON memory_confidence_calibration (instrument, confidence_bucket);

CREATE INDEX IF NOT EXISTS idx_memory_confidence_calibration_recorded_at
  ON memory_confidence_calibration (recorded_at);

COMMIT;
