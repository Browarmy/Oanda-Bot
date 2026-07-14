export type TradeDirection = "BUY" | "SELL";

export interface PortfolioTrade {
  instrument: string;
  direction: TradeDirection;
  units: number;
  entryPrice: number;
  stopLoss: number;
  riskPct?: number;
}


export interface PortfolioIntelligenceConfig {
  maxPortfolioHeatPct: number;
  maxSingleCurrencyExposurePct: number;
  maxSameCurrencyDirectionalTrades: number;
}

export interface PortfolioIntelligenceResult {
  approved: boolean;
  reason: string;
  currentHeatPct: number;
  projectedHeatPct: number;
  proposedRiskPct: number;
  currencyExposurePct: Record<string, number>;
  directionalCounts: Record<string, number>;
}

const DEFAULT_CONFIG: PortfolioIntelligenceConfig = {
  maxPortfolioHeatPct: 4.0,
  maxSingleCurrencyExposurePct: 250,
  maxSameCurrencyDirectionalTrades: 2,
};

function splitInstrument(instrument: string): { base: string; quote: string } {
  const parts = instrument.split("_");

  if (parts.length === 2) {
    return {
      base: parts[0],
      quote: parts[1],
    };
  }

  if (instrument.includes("XAU")) {
    return { base: "XAU", quote: "USD" };
  }

  if (instrument.includes("XAG")) {
    return { base: "XAG", quote: "USD" };
  }

  return {
    base: instrument,
    quote: "UNKNOWN",
  };
}

function tradeRiskValue(trade: PortfolioTrade, equity: number): number {
  if (trade.riskPct != null && trade.riskPct > 0 && equity > 0) {
    return (trade.riskPct / 100) * equity;
  }
  return 0;
}


function tradeNotionalValue(trade: PortfolioTrade): number {
  return Math.abs(trade.entryPrice * trade.units);
}

function addExposure(
  exposure: Record<string, number>,
  directionalCounts: Record<string, number>,
  trade: PortfolioTrade,
  equity: number
) {
  const { base, quote } = splitInstrument(trade.instrument);
  const notionalPct =
    equity > 0 ? (tradeNotionalValue(trade) / equity) * 100 : 0;

  const baseKey =
    trade.direction === "BUY"
      ? `${base}_LONG`
      : `${base}_SHORT`;

  const quoteKey =
    trade.direction === "BUY"
      ? `${quote}_SHORT`
      : `${quote}_LONG`;

  exposure[base] = (exposure[base] ?? 0) + notionalPct;
  exposure[quote] = (exposure[quote] ?? 0) + notionalPct;

  directionalCounts[baseKey] = (directionalCounts[baseKey] ?? 0) + 1;
  directionalCounts[quoteKey] = (directionalCounts[quoteKey] ?? 0) + 1;
}

export function analysePortfolioIntelligence(
  openTrades: PortfolioTrade[],
  proposedTrade: PortfolioTrade,
  equity: number,
  config: Partial<PortfolioIntelligenceConfig> = {}
): PortfolioIntelligenceResult {
  const cfg = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const allCurrentTrades = openTrades ?? [];

const currentRisk = allCurrentTrades.reduce(
  (sum, trade) => sum + tradeRiskValue(trade, equity),
  0
);
const proposedRisk = tradeRiskValue(proposedTrade, equity);

  const projectedRisk = currentRisk + proposedRisk;

  const currentHeatPct =
    equity > 0 ? (currentRisk / equity) * 100 : 0;

  const projectedHeatPct =
    equity > 0 ? (projectedRisk / equity) * 100 : 0;

  const proposedRiskPct =
    equity > 0 ? (proposedRisk / equity) * 100 : 0;

  const currencyExposurePct: Record<string, number> = {};
  const directionalCounts: Record<string, number> = {};

  for (const trade of [...allCurrentTrades, proposedTrade]) {
    addExposure(
      currencyExposurePct,
      directionalCounts,
      trade,
      equity
    );
  }

  if (projectedHeatPct > cfg.maxPortfolioHeatPct) {
    return {
      approved: false,
      reason:
        `Portfolio heat would be ${projectedHeatPct.toFixed(2)}% ` +
        `> max ${cfg.maxPortfolioHeatPct.toFixed(2)}%`,
      currentHeatPct,
      projectedHeatPct,
      proposedRiskPct,
      currencyExposurePct,
      directionalCounts,
    };
  }

  const overexposedCurrency = Object.entries(currencyExposurePct).find(
    ([, exposure]) => exposure > cfg.maxSingleCurrencyExposurePct
  );

  if (overexposedCurrency) {
    const [currency, exposure] = overexposedCurrency;

    return {
      approved: false,
      reason:
        `${currency} exposure would be ${exposure.toFixed(0)}% ` +
        `> max ${cfg.maxSingleCurrencyExposurePct.toFixed(0)}%`,
      currentHeatPct,
      projectedHeatPct,
      proposedRiskPct,
      currencyExposurePct,
      directionalCounts,
    };
  }

  const crowdedDirection = Object.entries(directionalCounts).find(
    ([, count]) => count > cfg.maxSameCurrencyDirectionalTrades
  );

  if (crowdedDirection) {
    const [side, count] = crowdedDirection;

    return {
      approved: false,
      reason:
        `${side} directional exposure would have ${count} trades ` +
        `> max ${cfg.maxSameCurrencyDirectionalTrades}`,
      currentHeatPct,
      projectedHeatPct,
      proposedRiskPct,
      currencyExposurePct,
      directionalCounts,
    };
  }

  return {
    approved: true,
    reason:
      `Portfolio approved | heat ${projectedHeatPct.toFixed(2)}% | ` +
      `new risk ${proposedRiskPct.toFixed(2)}%`,
    currentHeatPct,
    projectedHeatPct,
    proposedRiskPct,
    currencyExposurePct,
    directionalCounts,
  };
}
