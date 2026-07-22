import { memoryQuery } from "./memory-db";

export type ConfidenceBucket = "70-75" | "75-80" | "80-85" | "85-90" | "90plus";

export interface RecordTradeCalibrationInput {
  instrument: string;
  statedConfidence: number;
  won: boolean;
  pips: number;
  rMultiple: number;
  regime: string;
  strategy: string;
}

export interface CalibrationReportRow {
  bucket: ConfidenceBucket;
  trades: number;

  /** Simple lifetime win rate — all trades weighted equally. */
  winRate: number;

  /**
   * 95% Wilson score interval on winRate. Unlike a naive normal-approximation
   * interval, Wilson stays well-behaved at small sample sizes and near 0/1
   * proportions, which is the regime most buckets will be in for a long time
   * — a handful of buckets will have thousands of trades, most will have
   * dozens. A wide interval here means "we don't actually know this bucket's
   * true win rate yet," which is exactly the honest signal a point estimate
   * alone can't give you.
   */
  winRateLower: number;
  winRateUpper: number;

  /**
   * Win rate and average R-multiple with exponential recency decay applied
   * (see RECENCY_HALF_LIFE_DAYS below) — a trade from today counts fully,
   * one from 6 months ago counts for very little. Markets regime-shift, so
   * "how has this bucket performed lately" is a different, complementary
   * question to "what's the all-time rate," not a replacement for it.
   */
  weightedWinRate: number;
  weightedAverageRMultiple: number;

  profitFactor: number;
  averagePips: number;
  averageRMultiple: number;
}

const BUCKET_ORDER: ConfidenceBucket[] = ["70-75", "75-80", "80-85", "85-90", "90plus"];

// Half-life for recency weighting: a trade this many days old counts for
// half as much as a fresh one. 45 days is a deliberate middle ground — FX
// regimes (rate cycles, risk sentiment, volatility regimes) typically shift
// over weeks-to-months, so this is short enough to track a real regime
// change within a couple of months, but long enough that a single quiet
// week doesn't swing the weighted stats around.
const RECENCY_HALF_LIFE_DAYS = 45;

// z = 1.96 -> 95% confidence. This is the standard, well-established Wilson
// score interval (Wilson, 1927) for a binomial proportion — chosen
// specifically because it stays accurate at small n and doesn't produce
// nonsensical bounds (e.g. negative, or over 100%) the way a naive
// mean ± 1.96*stderr interval can.
const WILSON_Z = 1.96;

function getConfidenceBucket(statedConfidence: number): ConfidenceBucket | null {
  if (!Number.isFinite(statedConfidence) || statedConfidence < 0.7) return null;
  if (statedConfidence < 0.75) return "70-75";
  if (statedConfidence < 0.8) return "75-80";
  if (statedConfidence < 0.85) return "80-85";
  if (statedConfidence < 0.9) return "85-90";
  return "90plus";
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function safeText(value: string | undefined | null, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : fallback;
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function wilsonScoreInterval(
  wins: number,
  trades: number,
  z: number = WILSON_Z
): { lower: number; upper: number } {
  if (trades <= 0) return { lower: 0, upper: 1 };

  const p = wins / trades;
  const z2 = z * z;
  const denominator = 1 + z2 / trades;
  const center = (p + z2 / (2 * trades)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / trades + z2 / (4 * trades * trades));

  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}

export async function recordTradeCalibration(input: RecordTradeCalibrationInput): Promise<void> {
  try {
    const statedConfidence = clampConfidence(input.statedConfidence);
    const confidenceBucket = getConfidenceBucket(statedConfidence);

    if (!confidenceBucket) return;

    await memoryQuery(
      `
        INSERT INTO memory_confidence_calibration (
          instrument,
          confidence_bucket,
          stated_confidence,
          actual_outcome,
          pips,
          r_multiple,
          regime,
          strategy
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        safeText(input.instrument, "UNKNOWN"),
        confidenceBucket,
        statedConfidence,
        input.won ? "won" : "lost",
        safeNumber(input.pips),
        safeNumber(input.rMultiple),
        safeText(input.regime, "UNKNOWN"),
        safeText(input.strategy, "UNKNOWN"),
      ]
    );
  } catch (error) {
    console.error(
      "[ConfidenceCalibrationTracker] Failed to record trade calibration:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function getCalibrationReport(): Promise<CalibrationReportRow[]> {
  try {
    const rows = await memoryQuery<{
      bucket: ConfidenceBucket;
      trades: string | number;
      wins: string | number;
      gross_profit_r: string | number | null;
      gross_loss_r: string | number | null;
      average_pips: string | number | null;
      average_r_multiple: string | number | null;
      total_weight: string | number | null;
      weighted_wins: string | number | null;
      weighted_r_sum: string | number | null;
    }>(
      `
        SELECT
          confidence_bucket AS bucket,
          COUNT(*) AS trades,
          SUM(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN r_multiple > 0 THEN r_multiple ELSE 0 END) AS gross_profit_r,
          ABS(SUM(CASE WHEN r_multiple < 0 THEN r_multiple ELSE 0 END)) AS gross_loss_r,
          AVG(pips) AS average_pips,
          AVG(r_multiple) AS average_r_multiple,
          SUM(EXP(-LN(2) * EXTRACT(EPOCH FROM (NOW() - recorded_at)) / (86400.0 * $1))) AS total_weight,
          SUM(
            CASE WHEN actual_outcome = 'won'
              THEN EXP(-LN(2) * EXTRACT(EPOCH FROM (NOW() - recorded_at)) / (86400.0 * $1))
              ELSE 0
            END
          ) AS weighted_wins,
          SUM(
            r_multiple * EXP(-LN(2) * EXTRACT(EPOCH FROM (NOW() - recorded_at)) / (86400.0 * $1))
          ) AS weighted_r_sum
        FROM memory_confidence_calibration
        GROUP BY confidence_bucket
        ORDER BY
          CASE confidence_bucket
            WHEN '70-75' THEN 1
            WHEN '75-80' THEN 2
            WHEN '80-85' THEN 3
            WHEN '85-90' THEN 4
            WHEN '90plus' THEN 5
            ELSE 6
          END
      `,
      [RECENCY_HALF_LIFE_DAYS]
    );

    const byBucket = new Map(rows.map((row) => [row.bucket, row]));

    return BUCKET_ORDER.map((bucket) => {
      const row = byBucket.get(bucket);
      const trades = Number(row?.trades ?? 0);
      const wins = Number(row?.wins ?? 0);
      const grossProfit = Number(row?.gross_profit_r ?? 0);
      const grossLoss = Number(row?.gross_loss_r ?? 0);
      const totalWeight = Number(row?.total_weight ?? 0);
      const weightedWins = Number(row?.weighted_wins ?? 0);
      const weightedRSum = Number(row?.weighted_r_sum ?? 0);

      const wilson = wilsonScoreInterval(wins, trades);

      return {
        bucket,
        trades,
        winRate: trades > 0 ? wins / trades : 0,
        winRateLower: wilson.lower,
        winRateUpper: wilson.upper,
        weightedWinRate: totalWeight > 0 ? weightedWins / totalWeight : trades > 0 ? wins / trades : 0,
        weightedAverageRMultiple: totalWeight > 0 ? weightedRSum / totalWeight : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 1,
        averagePips: Number(row?.average_pips ?? 0),
        averageRMultiple: Number(row?.average_r_multiple ?? 0),
      };
    });
  } catch (error) {
    console.error(
      "[ConfidenceCalibrationTracker] Failed to build calibration report:",
      error instanceof Error ? error.message : String(error)
    );

    return BUCKET_ORDER.map((bucket) => ({
      bucket,
      trades: 0,
      winRate: 0,
      winRateLower: 0,
      winRateUpper: 1,
      weightedWinRate: 0,
      weightedAverageRMultiple: 0,
      profitFactor: 1,
      averagePips: 0,
      averageRMultiple: 0,
    }));
  }
}
