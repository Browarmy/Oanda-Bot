import { loadPersistentState, savePersistentState } from "./persistent-memory";
import type { EngineState } from "./autonomous-engine";

export interface DailyReport {
  date: string;
  createdAt: number;
  updatedAt: number;

  accountBalance: number;
  accountEquity: number;
  accountCurrency: string;

  dailyPnl: number;
  dailyTrades: number;
  dailyWins: number;
  dailyLosses: number;
  dailyWinRate: number;

  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  totalPnl: number;

  openTradesCount: number;
  maxDrawdownPct: number;

  botStatus: "LIVE" | "PAUSED" | "STOPPED";
  riskPercent: number;
  maxConcurrentTrades: number;
}

class DailyReportStore {
  private reports: DailyReport[] = [];
  private loaded = false;

  async load() {
    if (this.loaded) return;

    const loaded = await loadPersistentState<DailyReport[]>(
      "dailyReports",
      []
    );

    this.reports = Array.isArray(loaded) ? loaded : [];
    this.loaded = true;
  }

  async save() {
    await savePersistentState("dailyReports", this.reports);
  }

  async createSnapshot(state: EngineState) {
    await this.load();

    const now = Date.now();
    const date = new Date().toISOString().slice(0, 10);

    const todayTrades = (state.tradeHistory ?? []).filter((t: any) => {
      if (!t.closedAt) return false;
      return new Date(t.closedAt).toISOString().slice(0, 10) === date;
    });

    const dailyWins = todayTrades.filter((t: any) => t.pnl > 0).length;
    const dailyLosses = todayTrades.filter((t: any) => t.pnl <= 0).length;
    const dailyPnl = todayTrades.reduce(
      (sum: number, t: any) => sum + (t.pnl ?? 0),
      0
    );

    const equityCurve = state.equityCurve ?? [];
    let peak = equityCurve.length > 0 ? equityCurve[0].equity : state.accountEquity;
    let maxDrawdownPct = 0;

    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      if (peak > 0) {
        const dd = ((peak - point.equity) / peak) * 100;
        if (dd > maxDrawdownPct) maxDrawdownPct = dd;
      }
    }

    const report: DailyReport = {
      date,
      createdAt: now,
      updatedAt: now,

      accountBalance: state.accountBalance ?? 0,
      accountEquity: state.accountEquity ?? 0,
      accountCurrency: state.accountCurrency ?? "GBP",

      dailyPnl,
      dailyTrades: todayTrades.length,
      dailyWins,
      dailyLosses,
      dailyWinRate:
        todayTrades.length > 0 ? dailyWins / todayTrades.length : 0,

      totalTrades: state.totalTrades ?? 0,
      totalWins: state.totalWins ?? 0,
      totalLosses: state.totalLosses ?? 0,
      totalPnl: state.totalPnl ?? 0,

      openTradesCount: state.openTradesCount ?? 0,
      maxDrawdownPct,

      botStatus:
        state.isLive && !state.isPaused
          ? "LIVE"
          : state.isPaused
            ? "PAUSED"
            : "STOPPED",

      riskPercent: state.config?.riskPercent ?? 0,
      maxConcurrentTrades: state.config?.maxConcurrentTrades ?? 0,
    };

    const existingIndex = this.reports.findIndex(r => r.date === date);

    if (existingIndex >= 0) {
      report.createdAt = this.reports[existingIndex].createdAt;
      this.reports[existingIndex] = report;
    } else {
      this.reports.push(report);
    }

    this.reports = this.reports
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 500);

    await this.save();

    return report;
  }

  async getAll() {
    await this.load();
    return this.reports;
  }

  async getLatest() {
    await this.load();
    return this.reports[0] ?? null;
  }
}

export function formatDailyReportTelegram(report: DailyReport) {
  return [
    `📊 <b>DAILY FUNDED REPORT</b>`,
    ``,
    `Date: <b>${report.date}</b>`,
    `Status: <b>${report.botStatus}</b>`,
    ``,
    `Trades: <b>${report.dailyTrades}</b>`,
    `Wins/Losses: <b>${report.dailyWins}W / ${report.dailyLosses}L</b>`,
    `Win Rate: <b>${(report.dailyWinRate * 100).toFixed(1)}%</b>`,
    ``,
    `Daily P&L: <b>${report.dailyPnl >= 0 ? "+" : ""}${report.dailyPnl.toFixed(2)} ${report.accountCurrency}</b>`,
    `Total P&L: <b>${report.totalPnl >= 0 ? "+" : ""}${report.totalPnl.toFixed(2)} ${report.accountCurrency}</b>`,
    `Equity: <b>${report.accountEquity.toFixed(2)} ${report.accountCurrency}</b>`,
    ``,
    `Max DD: <b>${report.maxDrawdownPct.toFixed(2)}%</b>`,
    `Open Trades: <b>${report.openTradesCount}</b>`,
    `Risk: <b>${report.riskPercent}%</b>`,
  ].join("\n");
}

export const dailyReportStore = new DailyReportStore();