// server/memory/outcomeUpdater.ts
//
// Fallback outcome resolver: for any memory observation that never became a
// real trade (WAIT decisions), or a trade whose real outcome never got
// linked (see tradeOutcomeLinker.ts — e.g. the bot restarted while it was
// open and lost its in-memory snapshot), this resolves a synthetic outcome
// from raw price movement so the row still contributes evidence.
//
// BUY/SELL-tagged observations get a longer delay than WAIT ones before this
// claims them, specifically to give the real trade-outcome linker first
// right of way — most trades close well inside that window, so this only
// ever falls back to the proxy for the rare trade that stays open a long
// time (or a signal that never became a trade at all).

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

const WAIT_DELAY_HOURS = 4;
const TRADE_SIGNAL_DELAY_HOURS = 24;
const OUTCOME_INTERVAL_MS = 4 * 60 * 60 * 1000;
const MAX_OBSERVATIONS_PER_RUN = 200;
const FLAT_MOVE_PIPS = 1;

let outcomeUpdaterTimer: ReturnType<typeof setInterval> | null = null;

function midpoint(price: OandaPrice): number {
  return (price.bid + price.ask) / 2;
}

function round(value: number, digits: number = 5): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function getPipSize(instrument: string): number {
  if (instrument.includes("JPY")) return 0.01;
  if (instrument.includes("XAU")) return 0.1;
  if (instrument.includes("XAG")) return 0.01;
  if (instrument.includes("BCO") || instrument.includes("WTICO")) return 0.01;
  if (["UK100", "US30", "SPX", "NAS", "DE30", "JP225", "AU200"].some(x => instrument.includes(x))) return 1;
  if (["BTC", "ETH", "LTC"].some(x => instrument.includes(x))) return 1;
  return 0.0001;
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

async function getObservedMidPrice(
  api: OandaClient,
  instrument: string,
  observedAt: string
): Promise<number | null> {
  if (!api.request) return null;

  const from = encodeURIComponent(toOandaTimestamp(observedAt));
  const data = await api.request(
    `/v3/instruments/${instrument}/candles?granularity=M15&from=${from}&count=1&price=M`
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
      WHERE outcome_context IS NULL
        AND observed_at <= NOW() - (
          CASE
            WHEN decision_context->>'finalAction' IN ('BUY', 'SELL')
              THEN $2::text
            ELSE $1::text
          END || ' hours'
        )::interval
      ORDER BY observed_at ASC
      LIMIT $3
    `,
    [String(WAIT_DELAY_HOURS), String(TRADE_SIGNAL_DELAY_HOURS), MAX_OBSERVATIONS_PER_RUN]
  );
}

async function updateObservationOutcome(params: {
  observationId: string;
  observedAt: string;
  observedMidPrice: number;
  currentMidPrice: number;
  pipSize: number;
}): Promise<void> {
  const pipsMoved = round(
    (params.currentMidPrice - params.observedMidPrice) / params.pipSize,
    1
  );

  const outcomeContext = {
    outcomeType: "price_drift",
    pipsMoved,
    direction: classifyDirection(pipsMoved),
    updatedAt: new Date().toISOString(),
    observedAt: params.observedAt,
    observedMidPrice: round(params.observedMidPrice, 5),
    currentMidPrice: round(params.currentMidPrice, 5),
    horizonHours: WAIT_DELAY_HOURS,
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

    const distinctInstruments = Array.from(new Set(pending.map(p => p.instrument)));
    const currentMidPriceByInstrument = new Map<string, number>();

    for (const instrument of distinctInstruments) {
      try {
        const price = await api.getPrice(instrument);
        currentMidPriceByInstrument.set(instrument, midpoint(price));
      } catch (error) {
        console.error(
          `[OutcomeUpdater] Failed to fetch current price for ${instrument}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    let updated = 0;
    let skipped = 0;

    for (const observation of pending) {
      try {
        const currentMidPrice = currentMidPriceByInstrument.get(observation.instrument);

        if (currentMidPrice === undefined) {
          skipped += 1;
          continue;
        }

        const observedMidPrice = await getObservedMidPrice(
          api,
          observation.instrument,
          observation.observed_at
        );

        if (observedMidPrice === null) {
          skipped += 1;
          continue;
        }

        await updateObservationOutcome({
          observationId: observation.id,
          observedAt: observation.observed_at,
          observedMidPrice,
          currentMidPrice,
          pipSize: getPipSize(observation.instrument),
        });

        updated += 1;
      } catch (error) {
        skipped += 1;
        console.error(
          `[OutcomeUpdater] Failed observation ${observation.id} (${observation.instrument}):`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    console.log(
      `[OutcomeUpdater] outcomes checked=${pending.length} updated=${updated} skipped=${skipped} ` +
      `across ${distinctInstruments.length} instrument(s): ${distinctInstruments.join(", ")}`
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

  console.log("[OutcomeUpdater] Started 4-hour outcome updater (all instruments)");
}

export function stopMemoryOutcomeUpdater(): void {
  if (!outcomeUpdaterTimer) return;

  clearInterval(outcomeUpdaterTimer);
  outcomeUpdaterTimer = null;

  console.log("[OutcomeUpdater] Stopped");
}
