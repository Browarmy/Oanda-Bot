/**
 * Multi-Bot Manager: Concurrent scanning and trading of 20+ FX pairs
 */

export interface PairState {
  instrument: string;
  bid: number;
  ask: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  signalStrength: number;
  openTrades: any[];
  winRate: number;
}

export interface MultiBotState {
  isLive: boolean;
  enabledPairs: string[];
  totalTradesPlaced: number;
  riskPercent: number;
  maxConcurrentTrades: number;
  pairs: Record<string, PairState>;
}

const MAJOR_PAIRS = [
  "GBP_USD", "EUR_USD", "USD_JPY", "USD_CHF", "AUD_USD",
  "USD_CAD", "NZD_USD", "EUR_GBP", "EUR_JPY", "GBP_JPY",
  "EUR_CHF", "AUD_JPY", "CAD_JPY", "CHF_JPY", "GBP_CHF",
  "EUR_AUD", "AUD_CAD", "AUD_CHF", "NZD_JPY", "NZD_CHF"
];

export class MultiBotManager {
  private state: MultiBotState;
  private streaming: boolean = false;

  constructor() {
    this.state = {
      isLive: false,
      enabledPairs: MAJOR_PAIRS.slice(0, 10),
      totalTradesPlaced: 0,
      riskPercent: 3,
      maxConcurrentTrades: 5,
      pairs: {},
    };

    MAJOR_PAIRS.forEach(pair => {
      this.state.pairs[pair] = {
        instrument: pair,
        bid: 0,
        ask: 0,
        trend: "NEUTRAL",
        signalStrength: 0,
        openTrades: [],
        winRate: 0,
      };
    });
  }

  async startMultiBot() {
    this.state.isLive = true;
  }

  stopMultiBot() {
    this.state.isLive = false;
    this.streaming = false;
  }

  getStatus() {
    return {
      isLive: this.state.isLive,
      enabledPairs: this.state.enabledPairs,
      totalTradesPlaced: this.state.totalTradesPlaced,
      riskPercent: this.state.riskPercent,
      maxConcurrentTrades: this.state.maxConcurrentTrades,
      pairs: Object.values(this.state.pairs).map(p => ({
        instrument: p.instrument,
        trend: p.trend,
        signalStrength: p.signalStrength,
        bid: p.bid,
        ask: p.ask,
        openTrades: p.openTrades.length,
        winRate: p.winRate,
      })),
    };
  }

  updateConfig(config: any) {
    if (config.riskPercent) this.state.riskPercent = config.riskPercent;
    if (config.enabledPairs) this.state.enabledPairs = config.enabledPairs;
    if (config.maxConcurrentTrades) this.state.maxConcurrentTrades = config.maxConcurrentTrades;
  }

  getAvailablePairs() {
    return MAJOR_PAIRS;
  }
}
