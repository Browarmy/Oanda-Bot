BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS decision_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type TEXT,
  action TEXT,
  layer TEXT,
  stage TEXT,
  instrument TEXT NOT NULL,
  direction TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  risk_pct DOUBLE PRECISION,
  risk_multiplier DOUBLE PRECISION,
  meta_score DOUBLE PRECISION,
  strategy TEXT,
  regime TEXT,
  portfolio_heat_pct DOUBLE PRECISION,
  projected_heat_pct DOUBLE PRECISION,
  extra JSONB
);

CREATE INDEX IF NOT EXISTS idx_decision_journal_recorded_at
  ON decision_journal (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_journal_instrument
  ON decision_journal (instrument);

CREATE INDEX IF NOT EXISTS idx_decision_journal_type_action
  ON decision_journal (type, action);

COMMIT;
