import { loadPersistentState, savePersistentState } from "./persistent-memory";

export interface StrategyRegimeCell {
  key: string;
  strategy: string;
  regime: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
  score: number;
  enabled: boolean;
}

class StrategyRegimeMatrix {
  private cells = new Map<string, StrategyRegimeCell>();

async load() {
  const data = await loadPersistentState<StrategyRegimeCell[]>(
    "strategyRegimeMatrix",
    []
  );

  this.cells = new Map(
    data.map(c => [c.key, c])
  );
}

async save() {
  await savePersistentState(
    "strategyRegimeMatrix",
    this.getAll()
  );
}

  private key(strategy: string, regime: string) {
    return `${strategy}__${regime}`;
  }

  get(strategy: string, regime: string): StrategyRegimeCell {
    const key = this.key(strategy, regime);

    if (!this.cells.has(key)) {
      this.cells.set(key, {
        key,
        strategy,
        regime,
        trades: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
        winRate: 0.5,
        score: 0.5,
        enabled: true,
      });
    }

    return this.cells.get(key)!;
  }

  record(strategy: string, regime: string, won: boolean, pnl: number) {
    const cell = this.get(strategy, regime);

    cell.trades++;
    if (won) cell.wins++;
    else cell.losses++;

    cell.pnl += pnl;
    cell.winRate = cell.wins / Math.max(1, cell.trades);

    const pnlScore = cell.pnl > 0 ? 0.75 : 0.25;
    cell.score = Math.max(
      0,
      Math.min(1, cell.winRate * 0.7 + pnlScore * 0.3)
    );

    if (cell.trades >= 20 && cell.score < 0.38) {
      cell.enabled = false;
    }

    if (cell.score >= 0.5) {
      cell.enabled = true;
    }
  }

this.save().catch(() => {});

  shouldBlock(strategy: string, regime: string) {
    const cell = this.get(strategy, regime);

    if (cell.trades < 12) {
      return {
        blocked: false,
        reason: "not enough strategy-regime evidence",
        cell,
      };
    }

    if (!cell.enabled) {
      return {
        blocked: true,
        reason:
          `${strategy} in ${regime} disabled | ` +
          `${cell.wins}W/${cell.losses}L | score ${(cell.score * 100).toFixed(0)}%`,
        cell,
      };
    }

    return {
      blocked: false,
      reason:
        `${strategy} in ${regime}: ` +
        `${cell.wins}W/${cell.losses}L | score ${(cell.score * 100).toFixed(0)}%`,
      cell,
    };
  }

  getAll() {
    return Array.from(this.cells.values());
  }
}

export const strategyRegimeMatrix = new StrategyRegimeMatrix();