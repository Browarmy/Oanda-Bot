import { loadPersistentState, savePersistentState } from "./persistent-memory";

export interface MarketMemoryEntry {
  time: number;
  instrument: string;
  direction: "BUY" | "SELL";
  strategy: string;
  regime: string;
  riskMood?: string;
  confidence: number;
  metaScore?: number;
  rsi?: number;
  atr?: number;
  won: boolean;
  pnl: number;
  pips: number;
}

class MarketMemory {
  private memories: MarketMemoryEntry[] = [];
  private readonly maxMemories = 2000;

  async load() {
    const loaded = await loadPersistentState<MarketMemoryEntry[]>(
      "marketMemory",
      []
    );

    this.memories = Array.isArray(loaded)
      ? loaded.slice(-this.maxMemories)
      : [];
  }

  async save() {
    await savePersistentState(
      "marketMemory",
      this.memories.slice(-this.maxMemories)
    );
  }

  record(entry: MarketMemoryEntry) {
    this.memories.push(entry);
    this.memories = this.memories.slice(-this.maxMemories);
    this.save().catch(() => {});
  }

  findSimilar(input: {
    instrument: string;
    strategy: string;
    regime: string;
    confidence: number;
    rsi?: number;
  }) {
    const similar = this.memories.filter((m) => {
      let score = 0;

      if (m.instrument === input.instrument) score += 30;
      if (m.strategy === input.strategy) score += 25;
      if (m.regime === input.regime) score += 25;
      if (Math.abs(m.confidence - input.confidence) <= 0.1) score += 10;

      if (
        typeof m.rsi === "number" &&
        typeof input.rsi === "number" &&
        Math.abs(m.rsi - input.rsi) <= 6
      ) {
        score += 10;
      }

      return score >= 60;
    });

    const wins = similar.filter((m) => m.won);
    const losses = similar.filter((m) => !m.won);
    const pnl = similar.reduce((sum, m) => sum + m.pnl, 0);

    return {
      total: similar.length,
      wins: wins.length,
      losses: losses.length,
      winRate: similar.length > 0 ? wins.length / similar.length : 0.5,
      pnl,
      score:
        similar.length < 8
          ? 0.5
          : Math.max(
              0,
              Math.min(
                1,
                (wins.length / similar.length) * 0.7 +
                  (pnl > 0 ? 0.3 : 0)
              )
            ),
    };
  }

  shouldBlock(input: {
    instrument: string;
    strategy: string;
    regime: string;
    confidence: number;
    rsi?: number;
  }) {
    const similar = this.findSimilar(input);

    if (similar.total < 8) {
      return {
        blocked: false,
        riskMultiplier: 1,
        reason: "not enough similar market memory",
        similar,
      };
    }

    if (similar.winRate < 0.35 && similar.pnl < 0) {
      return {
        blocked: false,
        riskMultiplier: 0.35,
        reason:
          `bad memory match: ${similar.wins}W/${similar.losses}L, ` +
          `WR ${(similar.winRate * 100).toFixed(0)}% — sized down, not blocked`,
        similar,
      };
    }

    return {
      blocked: false,
      riskMultiplier: 1,
      reason:
        `memory acceptable: ${similar.wins}W/${similar.losses}L, ` +



  getRecent(limit = 100) {
    return this.memories.slice(-limit).reverse();
  }

  getAll() {
    return [...this.memories];
  }

  async reset() {
    this.memories = [];
    await this.save();
  }

  getSummary() {
    const total = this.memories.length;
    const wins = this.memories.filter((m) => m.won).length;
    const losses = this.memories.filter((m) => !m.won).length;
    const pnl = this.memories.reduce((sum, m) => sum + m.pnl, 0);

    return {
      total,
      wins,
      losses,
      winRate: total > 0 ? wins / total : 0,
      pnl,
      recent: this.getRecent(25),
    };
  }
}

export const marketMemory = new MarketMemory();