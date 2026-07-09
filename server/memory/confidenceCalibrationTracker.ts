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
  winRate: number;
  profitFactor: number;
  averagePips: number;
  averageRMultiple: number;
}

const BUCKET_ORDER: ConfidenceBucket[] = ["70-75", "75-80", "80-85", "85-90", "90plus"];

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
    }>(
      `
        SELECT
          confidence_bucket AS bucket,
          COUNT(*) AS trades,
          SUM(CASE WHEN actual_outcome = 'won' THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN r_multiple > 0 THEN r_multiple ELSE 0 END) AS gross_profit_r,
          ABS(SUM(CASE WHEN r_multiple < 0 THEN r_multiple ELSE 0 END)) AS gross_loss_r,
          AVG(pips) AS average_pips,
          AVG(r_multiple) AS average_r_multiple
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
      `
    );

    const byBucket = new Map(rows.map((row) => [row.bucket, row]));

    return BUCKET_ORDER.map((bucket) => {
      const row = byBucket.get(bucket);
      const trades = Number(row?.trades ?? 0);
      const wins = Number(row?.wins ?? 0);
      const grossProfit = Number(row?.gross_profit_r ?? 0);
      const grossLoss = Number(row?.gross_loss_r ?? 0);

      return {
        bucket,
        trades,
        winRate: trades > 0 ? wins / trades : 0,
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
      profitFactor: 1,
      averagePips: 0,
      averageRMultiple: 0,
    }));
  }
}
