export interface StrategyGenome {
  name: string;

  trades: number;
  wins: number;
  losses: number;

  pnl: number;

  score: number;

  enabled: boolean;
}

export class StrategyGenomeEngine {

  private genomes =
    new Map<string, StrategyGenome>();

  get(strategy: string): StrategyGenome {

    if (!this.genomes.has(strategy)) {

      this.genomes.set(strategy, {
        name: strategy,

        trades: 0,
        wins: 0,
        losses: 0,

        pnl: 0,

        score: 50,

        enabled: true,
      });
    }

    return this.genomes.get(strategy)!;
  }

  recordTrade(
    strategy: string,
    won: boolean,
    pnl: number
  ) {

    const genome =
      this.get(strategy);

    genome.trades++;

    if (won)
      genome.wins++;
    else
      genome.losses++;

    genome.pnl += pnl;

    this.recalculate(genome);
  }

  private recalculate(
    genome: StrategyGenome
  ) {

    if (genome.trades < 10)
      return;

    const winRate =
      genome.wins / genome.trades;

    const pnlFactor =
      genome.pnl > 0
        ? 1
        : 0.5;

    genome.score =
      (
        (winRate * 70) +
        (pnlFactor * 30)
      );

    if (
      genome.trades >= 30 &&
      genome.score < 45
    ) {
      genome.enabled = false;
    }

    if (
      genome.score > 65
    ) {
      genome.enabled = true;
    }
  }

  getAll() {
    return Array.from(
      this.genomes.values()
    );
  }

  isEnabled(strategy: string) {
    return this.get(strategy).enabled;
  }
}

export const strategyGenome =
  new StrategyGenomeEngine();