export type Direction = "BUY" | "SELL";

export interface CrossMarketTrade {
  instrument: string;
  direction: Direction;
}

export interface CrossMarketResult {
  approved: boolean;
  reason: string;
  confidenceAdjustment: number;
  riskMultiplier: number;
  exposureCounts: Record<string, number>;
}

function splitInstrument(instrument: string): { base: string; quote: string } {
  const parts = instrument.split("_");

  if (parts.length === 2) {
    return { base: parts[0], quote: parts[1] };
  }

  if (instrument.includes("XAU")) return { base: "XAU", quote: "USD" };
  if (instrument.includes("XAG")) return { base: "XAG", quote: "USD" };

  return { base: instrument, quote: "UNKNOWN" };
}

function addDirectionalExposure(
  counts: Record<string, number>,
  instrument: string,
  direction: Direction
) {
  const { base, quote } = splitInstrument(instrument);

  const baseKey = direction === "BUY" ? `${base}_LONG` : `${base}_SHORT`;
  const quoteKey = direction === "BUY" ? `${quote}_SHORT` : `${quote}_LONG`;

  counts[baseKey] = (counts[baseKey] ?? 0) + 1;
  counts[quoteKey] = (counts[quoteKey] ?? 0) + 1;
}

export function analyseCrossMarketIntelligence(
  openTrades: CrossMarketTrade[],
  proposed: CrossMarketTrade
): CrossMarketResult {
  const exposureCounts: Record<string, number> = {};

  for (const trade of openTrades) {
    addDirectionalExposure(exposureCounts, trade.instrument, trade.direction);
  }

  addDirectionalExposure(
    exposureCounts,
    proposed.instrument,
    proposed.direction
  );

  const crowded = Object.entries(exposureCounts)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  if (crowded.length > 0) {
    const [theme, count] = crowded[0];

    return {
      approved: true,
      reason: `Crowded macro exposure: ${theme} across ${count} trades`,
      confidenceAdjustment: -0.04,
      riskMultiplier: 0.75,
      exposureCounts,
    };
  }

  const moderate = Object.entries(exposureCounts)
    .filter(([, count]) => count === 2)
    .sort((a, b) => b[1] - a[1]);

  if (moderate.length > 0) {
    const [theme] = moderate[0];

    return {
      approved: true,
      reason: `Moderate macro exposure: ${theme}`,
      confidenceAdjustment: -0.02,
      riskMultiplier: 0.9,
      exposureCounts,
    };
  }

  return {
    approved: true,
    reason: "Cross-market exposure clean",
    confidenceAdjustment: 0,
    riskMultiplier: 1,
    exposureCounts,
  };
}