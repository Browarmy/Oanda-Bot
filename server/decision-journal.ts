import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type DecisionType =
  | "APPROVED"
  | "BLOCKED"
  | "RISK_REDUCED"
  | "EXECUTED";

export interface DecisionJournalEntry {
  id: string;
  time: number;
  type: DecisionType;

  instrument: string;
  direction: "BUY" | "SELL";

  stage:
    | "SIGNAL"
    | "CROSS_MARKET"
    | "META"
    | "DYNAMIC_RISK"
    | "PORTFOLIO"
    | "EXECUTION";

  reason: string;

  confidence?: number;
  riskPct?: number;
  metaScore?: number;
  strategy?: string;
  regime?: string;

  extra?: Record<string, unknown>;
}

const DATA_DIR = path.join(process.cwd(), "data");
const JOURNAL_FILE = path.join(DATA_DIR, "decision-journal.json");

class DecisionJournal {
  private entries: DecisionJournalEntry[] = [];
  private loaded = false;
  private readonly maxEntries = 1000;

  async load() {
    if (this.loaded) return;

    try {
      await mkdir(DATA_DIR, { recursive: true });
      const raw = await readFile(JOURNAL_FILE, "utf8");
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        this.entries = parsed.slice(-this.maxEntries);
      }
    } catch {
      this.entries = [];
    }

    this.loaded = true;
  }

  async record(entry: Omit<DecisionJournalEntry, "id" | "time">) {
    await this.load();

    const fullEntry: DecisionJournalEntry = {
      id:
        `${Date.now()}-` +
        Math.random().toString(36).slice(2, 10),
      time: Date.now(),
      ...entry,
    };

    this.entries.push(fullEntry);
    this.entries = this.entries.slice(-this.maxEntries);

    try {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(
        JOURNAL_FILE,
        JSON.stringify(this.entries, null, 2),
        "utf8"
      );
    } catch (e) {
      console.warn("[DecisionJournal] Failed to persist:", e);
    }

    return fullEntry;
  }

  getRecent(limit = 100) {
    return this.entries
      .slice(-limit)
      .reverse();
  }

  getAll() {
    return [...this.entries];
  }

  getStats() {
    const total = this.entries.length;
    const blocked = this.entries.filter(e => e.type === "BLOCKED").length;
    const approved = this.entries.filter(e => e.type === "APPROVED").length;
    const reduced = this.entries.filter(e => e.type === "RISK_REDUCED").length;
    const executed = this.entries.filter(e => e.type === "EXECUTED").length;

    return {
      total,
      blocked,
      approved,
      reduced,
      executed,
      blockRate: total > 0 ? blocked / total : 0,
    };
  }
}

export const decisionJournal = new DecisionJournal();