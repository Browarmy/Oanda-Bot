import { loadPersistentState, savePersistentState } from "./persistent-memory";

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

class DecisionJournal {
  private entries: DecisionJournalEntry[] = [];
  private loaded = false;
  private readonly maxEntries = 5000;

  async load() {
    if (this.loaded) return;

    const loaded = await loadPersistentState<DecisionJournalEntry[]>(
      "decisionJournal",
      []
    );

    this.entries = Array.isArray(loaded)
      ? loaded.slice(-this.maxEntries)
      : [];

    this.loaded = true;
  }

  async save() {
    await savePersistentState(
      "decisionJournal",
      this.entries.slice(-this.maxEntries)
    );
  }

  async record(entry: Omit<DecisionJournalEntry, "id" | "time">) {
    await this.load();

    const fullEntry: DecisionJournalEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      time: Date.now(),
      ...entry,
    };

    this.entries.push(fullEntry);
    this.entries = this.entries.slice(-this.maxEntries);

    await this.save();

    return fullEntry;
  }

  getRecent(limit = 100) {
    return this.entries.slice(-limit).reverse();
  }

  getAll() {
    return [...this.entries];
  }

  getStats() {
    const total = this.entries.length;

    const blocked = this.entries.filter(
      e => e.type === "BLOCKED" || e.action === "BLOCKED"
    ).length;

    const approved = this.entries.filter(
      e => e.type === "APPROVED" || e.action === "APPROVED"
    ).length;

    const reduced = this.entries.filter(
      e => e.type === "RISK_REDUCED" || e.action === "RISK_REDUCED"
    ).length;

    const executed = this.entries.filter(
      e => e.type === "EXECUTED"
    ).length;

    const metaScores = this.entries
      .map(e => e.metaScore)
      .filter((v): v is number => typeof v === "number");

    const avgMetaScore =
      metaScores.length > 0
        ? metaScores.reduce((a, b) => a + b, 0) / metaScores.length
        : 0;

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