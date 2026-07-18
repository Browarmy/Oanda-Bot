// server/memory/tradeOutcomeLinker.ts
//
// Links a closed trade's REAL outcome (won/lost, realized PnL, R-multiple)
// directly onto the memory_observations row that was written when its
// signal fired. This replaces the outcomeUpdater.ts price-drift proxy with
// ground truth for any observation that actually became a trade.

import { memoryQuery } from "./memory-db";

export type TradeOutcomeLinkInput = {
  observationId: string;
  won: boolean;
  pnl: number;
  pips: number;
  rMultiple: number;
  closeReason: string;
  closedAt: number | string;
};

function toIsoTimestamp(value: number | string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

/**
 * Writes the real outcome of a closed trade onto its originating memory
 * observation. Guarded by "outcome_context IS NULL" so it never overwrites
 * an outcome that's already been resolved — by itself (idempotent retries)
 * or by the price-drift updater, whichever gets there first.
 *
 * Returns true if this call is the one that actually set the outcome,
 * false if the row didn't exist or was already resolved.
 */
export async function linkTradeOutcomeToObservation(
  input: TradeOutcomeLinkInput
): Promise<boolean> {
  try {
    const outcomeContext = {
      outcomeType: "trade",
      won: input.won,
      pnl: round(input.pnl, 2),
      pips: round(input.pips, 1),
      rMultiple: round(input.rMultiple, 3),
      closeReason: input.closeReason,
      closedAt: toIsoTimestamp(input.closedAt),
      updatedAt: new Date().toISOString(),
      source: "trade_outcome_linker",
    };

    const rows = await memoryQuery<{ id: string }>(
      `
        UPDATE memory_observations
        SET outcome_context = $1::jsonb
        WHERE id = $2::uuid
          AND outcome_context IS NULL
        RETURNING id
      `,
      [JSON.stringify(outcomeContext), input.observationId]
    );

    return rows.length > 0;
  } catch (error) {
    console.error(
      "[TradeOutcomeLinker] Failed to link trade outcome to observation:",
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}
