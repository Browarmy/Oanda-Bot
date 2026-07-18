// server/decision-journal.ts
//
// Decision journal — moved from a MySQL JSON blob (bot_persistent_state,
// capped at 50,000 entries, entire array rewritten on every save) to real
// rows in the isolated Postgres Memory DB. That cap is why "DECISIONS" on
// the dashboard pinned at exactly 50000 and silently discarded older
// history once it filled up. Real per-row inserts remove the cap entirely
// and are cheap regardless of how much history has built up — no more
// rewriting the whole thing on every single decision.

import { memoryQuery } from "./memory/memory-db";

export type DecisionType =
  | "APPROVED"
  | "BLOCKED"
  | "RISK_REDUCED"
  | "EXECUTED";

export interface DecisionJournalEntry {
  id: string;
  time: number;
  type?: DecisionType;
  action?: string;
  layer?: string;

  instrument: string;
  direction: "BUY" | "SELL";

  stage?:
    | "SIGNAL"
    | "CROSS_MARKET"
    | "META"
    | "DYNAMIC_RISK"
    | "PORTFOLIO"
    | "EXECUTION";

  reason: string;

  confidence?: number;
  riskPct?: number;
  riskMultiplier?: number;
  metaScore?: number;
  strategy?: string;
  regime?: string;
  portfolioHeatPct?: number;
  projectedHeatPct?: number;

  extra?: Record<string, unknown>;
}

type DecisionJournalRow = {
  id: string;
  recorded_at: string;
  type: string | null;
  action: string | null;
  layer: string | null;
  stage: string | null;
  instrument: string;
  direction: string;
  reason: string;
  confidence: number | null;
  risk_pct: number | null;
  risk_multiplier: number | null;
  meta_score: number | null;
  strategy: string | null;
  regime: string | null;
  portfolio_heat_pct: number | null;
  projected_heat_pct: number | null;
  extra: Record<string, unknown> | null;
};

function rowToEntry(row: DecisionJournalRow): DecisionJournalEntry {
  return {
    id: row.id,
    time: new Date(row.recorded_at).getTime(),
    type: (row.type ?? undefined) as DecisionType | undefined,
    action: row.action ?? undefined,
    layer: row.layer ?? undefined,
    stage: (row.stage ?? undefined) as DecisionJournalEntry["stage"],
    instrument: row.instrument,
    direction: row.direction as "BUY" | "SELL",
    reason: row.reason,
    confidence: row.confidence ?? undefined,
    riskPct: row.risk_pct ?? undefined,
    riskMultiplier: row.risk_multiplier ?? undefined,
    metaScore: row.meta_score ?? undefined,
    strategy: row.strategy ?? undefined,
    regime: row.regime ?? undefined,
    portfolioHeatPct: row.portfolio_heat_pct ?? undefined,
    projectedHeatPct: row.projected_heat_pct ?? undefined,
    extra: row.extra ?? undefined,
  };
}

// Safety cap on any single read query — this is not a cap on how much
// history is kept (Postgres just keeps growing), only on how many rows one
// call is allowed to pull into Node memory at once.
const MAX_QUERY_ROWS = 20000;

class DecisionJournal {
  private pendingWrites = new Set<Promise<unknown>>();

  // Kept as a no-op for backward compatibility — autonomous-engine.ts and
  // routers.ts both await decisionJournal.load() before reading. There's
  // nothing to preload from Postgres; every read queries live.
  async load(): Promise<void> {}

  async record(entry: Omit<DecisionJournalEntry, "id" | "time">): Promise<DecisionJournalEntry> {
    const now = new Date();

    const fullEntry: DecisionJournalEntry = {
      ...entry,
      id: `pending-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
      time: now.getTime(),
    };

    // Fire-and-forget: record() is called many times per scan cycle and
    // nothing anywhere uses its return value (checked before this change),
    // so there's no reason to block the live trading decision path on a DB
    // round-trip. Tracked in pendingWrites so a clean shutdown can still
    // wait for these to land — see flushNow().
    const writePromise = memoryQuery(
      `
        INSERT INTO decision_journal (
          recorded_at, type, action, layer, stage, instrument, direction,
          reason, confidence, risk_pct, risk_multiplier, meta_score,
          strategy, regime, portfolio_heat_pct, projected_heat_pct, extra
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
        )
      `,
      [
        now.toISOString(),
        entry.type ?? null,
        entry.action ?? null,
        entry.layer ?? null,
        entry.stage ?? null,
        entry.instrument,
        entry.direction,
        entry.reason,
        entry.confidence ?? null,
        entry.riskPct ?? null,
        entry.riskMultiplier ?? null,
        entry.metaScore ?? null,
        entry.strategy ?? null,
        entry.regime ?? null,
        entry.portfolioHeatPct ?? null,
        entry.projectedHeatPct ?? null,
        entry.extra ? JSON.stringify(entry.extra) : null,
      ]
    ).catch((error: unknown) => {
      console.error(
        "[DecisionJournal] Failed to record entry (trading continues):",
        error instanceof Error ? error.message : String(error)
      );
    });

    this.pendingWrites.add(writePromise);
    void writePromise.finally(() => this.pendingWrites.delete(writePromise));

    return fullEntry;
  }

  /** Wait for any in-flight inserts to land. Called on SIGTERM/SIGINT. */
  async flushNow(): Promise<void> {
    await Promise.allSettled([...this.pendingWrites]);
  }

  async getRecent(limit = 100): Promise<DecisionJournalEntry[]> {
    const rows = await memoryQuery<DecisionJournalRow>(
      `SELECT * FROM decision_journal ORDER BY recorded_at DESC LIMIT $1`,
      [Math.min(Math.max(1, limit), MAX_QUERY_ROWS)]
    );
    return rows.map(rowToEntry);
  }

  async getAll(): Promise<DecisionJournalEntry[]> {
    const rows = await memoryQuery<DecisionJournalRow>(
      `SELECT * FROM decision_journal ORDER BY recorded_at DESC LIMIT $1`,
      [MAX_QUERY_ROWS]
    );
    return rows.map(rowToEntry);
  }

  async getStats() {
    const rows = await memoryQuery<{
      total: string;
      blocked: string;
      approved: string;
      reduced: string;
      executed: string;
      avg_meta_score: string | null;
    }>(`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE type = 'BLOCKED' OR action = 'BLOCKED')::text AS blocked,
        COUNT(*) FILTER (WHERE type = 'APPROVED' OR action = 'APPROVED')::text AS approved,
        COUNT(*) FILTER (WHERE type = 'RISK_REDUCED' OR action = 'RISK_REDUCED')::text AS reduced,
        COUNT(*) FILTER (WHERE type = 'EXECUTED')::text AS executed,
        AVG(meta_score)::text AS avg_meta_score
      FROM decision_journal
    `);

    const row = rows[0];
    const total = Number(row?.total ?? 0);
    const blocked = Number(row?.blocked ?? 0);
    const approved = Number(row?.approved ?? 0);
    const reduced = Number(row?.reduced ?? 0);
    const executed = Number(row?.executed ?? 0);
    const avgMetaScore = row?.avg_meta_score ? Number(row.avg_meta_score) : 0;

    return {
      total,
      blocked,
      approved,
      reduced,
      executed,
      blockRate: total > 0 ? blocked / total : 0,
      approvalRate: total > 0 ? approved / total : 0,
      avgMetaScore,
    };
  }
}

export const decisionJournal = new DecisionJournal();
