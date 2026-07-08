// server/memory/outcomeUpdater.ts

import { memoryQuery } from "./memory-db";

type OandaPrice = {
  bid: number;
  ask: number;
};

type OandaClient = {
  getPrice: (instrument: string) => Promise<OandaPrice>;
  request?: (path: string, options?: RequestInit) => Promise<any>;
};

type PendingObservation = {
  id: string;
  instrument: string;
  observed_at: string;
};

type OutcomeUpdateSummary = {
  checked: number;
  updated: number;
  skipped: number;
  error?: string;
};

const OUTCOME_INSTRUMENT = "EUR_USD";
const OUTCOME_DELAY_HOURS = 4;
const OUTCOME_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MAX_OBSERVATIONS_PER_RUN = 50;
const EUR_USD_PIP_SIZE = 0.0001;
const FLAT_MOVE_PIPS = 1;

let outcomeUpdaterTimer: ReturnType<typeof setInterval> | null = null;

function midpoint(price: OandaPrice): number {
  return (price.bid + price.ask) / 2;
}

function round(value: number, digits: number = 5): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function classifyDirection(pipsMoved: number): "up" | "down" | "flat" {
  if (Math.abs(pipsMoved) < FLAT_MOVE_PIPS) return "flat";
  return pipsMoved > 0 ? "up" : "down";
}

function toOandaTimestamp(value: string): string {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new Error(`[OutcomeUpdater] Invalid observed_at timestamp: ${value}`);
  }

  return date.toISOString();
}

async function getObservedMidPrice(api: OandaClient, observedAt: string): Promise<number | null> {
  if (!api.request) return null;

  const from = encodeURIComponent(toOandaTimestamp(observedAt));
  const data = await api.request(
    `/v3/instruments/${OUTCOME_INSTRUMENT}/candles?granularity=M15&from=${from}&count=1&price=M`
  );

  const candle = data?.candles?.find((item: any) => item?.mid?.c);

  if (!candle) return null;

  const close = Number(candle.mid.c);
  return Number.isFinite(close) ? close : null;
}

async function getPendingObservations(): Promise<PendingObservation[]> {
  return memoryQuery<PendingObservation>(
    `
      SELECT
        id::text,
        instrument,
        observed_at
      FROM memory_observations
      WHERE instrument = $1
        AND outcome_context IS NULL
        AND observed_at <= NOW() - ($2::text || ' hours')::interval
      ORDER BY observed_at ASC
      LIMIT $3
    `,
    [OUTCOME_INSTRUMENT, String(OUTCOME_DELAY_HOURS), MAX_OBSERVATIONS_PER_RUN]
  );
}

async function updateObservationOutcome(params: {
  observationId: string;
  observedAt: string;
  observedMidPrice: number;
  currentMidPrice: number;
}): Promise<void> {
  const pipsMoved = round(
    (params.currentMidPrice - params.observedMidPrice) / EUR_USD_PIP_SIZE,
    1
  );

  const outcomeContext = {
    pipsMoved,
    direction: classifyDirection(pipsMoved),
    updatedAt: new Date().toISOString(),
    observedAt: params.observedAt,
    observedMidPrice: round(params.observedMidPrice, 5),
    currentMidPrice: round(params.currentMidPrice, 5),
    horizonHours: OUTCOME_DELAY_HOURS,
    source: "memory_outcome_updater",
  };

  await memoryQuery(
    `
      UPDATE memory_observations
      SET outcome_context = $1::jsonb
      WHERE id = $2::uuid
        AND outcome_context IS NULL
    `,
    [JSON.stringify(outcomeContext), params.observationId]
  );
}

export async function runMemoryOutcomeUpdaterOnce(api: OandaClient): Promise<OutcomeUpdateSummary> {
  try {
    const pending = await getPendingObservations();

    if (pending.length === 0) {
      return {
        checked: 0,
        updated: 0,
        skipped: 0,
      };
    }

    const currentPrice = await api.getPrice(OUTCOME_INSTRUMENT);
    const currentMidPrice = midpoint(currentPrice);

    let updated = 0;
    let skipped = 0;

    for (const observation of pending) {
      try {
        const observedMidPrice = await getObservedMidPrice(api, observation.observed_at);

        if (observedMidPrice === null) {
          skipped += 1;
          continue;
        }

        await updateObservationOutcome({
          observationId: observation.id,
          observedAt: observation.observed_at,
          observedMidPrice,
          currentMidPrice,
        });

        updated += 1;
      } catch (error) {
        skipped += 1;
        console.error(
          `[OutcomeUpdater] Failed observation ${observation.id}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    console.log(
      `[OutcomeUpdater] EUR_USD outcomes checked=${pending.length} updated=${updated} skipped=${skipped}`
    );

    return {
      checked: pending.length,
      updated,
      skipped,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[OutcomeUpdater] Run failed:", message);

    return {
      checked: 0,
      updated: 0,
      skipped: 0,
      error: message,
    };
  }
}

export function startMemoryOutcomeUpdater(api: OandaClient): void {
  if (outcomeUpdaterTimer) return;

  void runMemoryOutcomeUpdaterOnce(api);

  outcomeUpdaterTimer = setInterval(() => {
    void runMemoryOutcomeUpdaterOnce(api);
  }, OUTCOME_INTERVAL_MS);

  console.log("[OutcomeUpdater] Started 4-hour EUR_USD outcome updater");
}

export function stopMemoryOutcomeUpdater(): void {
  if (!outcomeUpdaterTimer) return;

  clearInterval(outcomeUpdaterTimer);
  outcomeUpdaterTimer = null;

  console.log("[OutcomeUpdater] Stopped");
}