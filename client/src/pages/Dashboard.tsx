import { useState, useEffect, useMemo } from "react";
import TradeChartModal from "@/components/TradeChartModal";
import { trpc } from "@/lib/trpc";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, ReferenceLine,
} from "recharts";
import {
  TrendingUp, TrendingDown, Zap, Pause, Play, LogOut,
  Settings, Activity, Target, CheckCircle2, XCircle,
  Brain, FlaskConical, Shield, Bell, RefreshCw, ChevronRight,
  AlertCircle, BarChart2,
} from "lucide-react";

interface DashboardProps {
  credentials: { token: string; accountId: string };
  onLogout: () => void;
}

const C = {
  bg: "#050c1a",
  s1: "rgba(12, 21, 37, 0.85)",
  s2: "rgba(6, 13, 24, 0.9)",
  border: "#1a2d45",
  amber: "#f5a623",
  green: "#00e676",
  red: "#ff4444",
  blue: "#448aff",
  text: "#f0ebe0",
  muted: "#3a5570",
  mutedLight: "#6a8aaa",
};

function StatPill({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-1"
      style={{ background: C.s1, border: `1px solid ${C.border}`, backdropFilter: "blur(12px)" }}>
      <p className="text-xs font-bold tracking-widest uppercase" style={{ color: C.muted }}>{label}</p>
      <p className="text-xl font-black font-mono leading-none" style={{ color: color ?? C.amber }}>{value}</p>
      {sub && <p className="text-xs font-mono" style={{ color: C.muted }}>{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-black tracking-widest uppercase mb-3" style={{ color: C.amber }}>{children}</p>
  );
}

export default function Dashboard({ credentials, onLogout }: DashboardProps) {
  const [tab, setTab] = useState("overview");
  const [propFirmEnabled, setPropFirmEnabled] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramSaved, setTelegramSaved] = useState(false);
  const [backtestPair, setBacktestPair] = useState("EUR_USD");
  const [backtestGranularity, setBacktestGranularity] = useState("M15");
  const [backtestCount, setBacktestCount] = useState(500);
  const [isConnected, setIsConnected] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [selectedTrade, setSelectedTrade] = useState<any | null>(null);
  const utils = trpc.useUtils();

  const connectMutation = trpc.bot.connect.useMutation({
    onSuccess: () => setIsConnected(true),
    onError: (e) => setConnectError(e.message),
  });
  const pauseMutation = trpc.bot.pause.useMutation();
  const resumeMutation = trpc.bot.resume.useMutation();
  const stopMutation = trpc.bot.stop.useMutation();
  const [closingTrades, setClosingTrades] = useState<Set<string>>(new Set());
  const playSound = (type: 'close' | 'reset') => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (type === 'close') {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
      } else {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
      }
    } catch { /* ignore audio errors */ }
  };
  const closeTradeMutation = trpc.bot.closeTrade.useMutation({
  onMutate: ({ tradeId }) => {
    setClosingTrades(prev => {
      const n = new Set(prev);
      n.add(tradeId);
      return n;
    });

    playSound("close");
  },

  onSuccess: async () => {
    await utils.bot.getState.invalidate();
    await utils.bot.getHistory.invalidate();
    await utils.bot.getLearningInsights.invalidate();
    await utils.bot.getMemoryDashboard.invalidate();
    await utils.bot.getDecisionJournal.invalidate();
    await utils.bot.getFundedReadiness.invalidate();
  },

  onSettled: (_data, _err, { tradeId }) => {
    setClosingTrades(prev => {
      const n = new Set(prev);
      n.delete(tradeId);
      return n;
    });
  },
});
  const resetStatsMutation = trpc.bot.resetStats.useMutation({
    onSuccess: () => { playSound('reset'); },
  });
  const propFirmMutation = trpc.bot.setPropFirmMode.useMutation();
  const telegramMutation = trpc.bot.setTelegramConfig.useMutation({
    onSuccess: () => setTelegramSaved(true),
  });
  const backtestMutation = trpc.bot.runBacktest.useMutation();

  const { data: state } = trpc.bot.getState.useQuery(undefined, {
    enabled: isConnected,
    refetchInterval: 2000,
  });
  const { data: history } = trpc.bot.getHistory.useQuery(undefined, {
    enabled: isConnected,
    refetchInterval: 2000,
  });
  const { data: learning } = trpc.bot.getLearningInsights.useQuery(undefined, {
    enabled: isConnected && tab === "ai",
    refetchInterval: 2000,
  });
const { data: memoryDashboard } = trpc.bot.getMemoryDashboard.useQuery(undefined, {
  enabled: isConnected && tab === "ai",
  refetchInterval: 10000,
});

const { data: decisionJournal } = trpc.bot.getDecisionJournal.useQuery(undefined, {
  enabled: isConnected && tab === "ai",
  refetchInterval: 10000,
});
  const { data: readiness } = trpc.bot.getFundedReadiness.useQuery(undefined, {
    enabled: isConnected && tab === "ai",
    refetchInterval: 2000,
  });
  const { data: telegramConfig } = trpc.bot.getTelegramConfig.useQuery(undefined, {
    enabled: isConnected,
  });

  const openInstruments = useMemo(
    () => Array.from(new Set((state?.openTrades ?? []).map((t: any) => t.instrument as string))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(state?.openTrades ?? []).map((t: any) => t.instrument).join(",")]
  );
  const { data: livePrices } = trpc.bot.getLivePrices.useQuery(
    { instruments: openInstruments },
    { enabled: isConnected && openInstruments.length > 0, refetchInterval: 2000, staleTime: 0 }
  );

  useEffect(() => {
    const env = (localStorage.getItem("oanda_env") ?? "practice") as "practice" | "live";
    connectMutation.mutate({
      token: credentials.token,
      accountId: credentials.accountId,
      environment: env,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = state;
  const balance = s?.accountBalance ?? 0;
  const equity = s?.accountEquity ?? 0;
  const currency = s?.accountCurrency ?? "GBP";
  const totalPnl = s?.totalPnl ?? 0;
  const totalTrades = s?.totalTrades ?? 0;
  const winRate = totalTrades > 0 ? Math.round(((s?.totalWins ?? 0) / totalTrades) * 100) : 0;
  const pf = (s?.totalLosses ?? 0) > 0 ? ((s?.totalWins ?? 0) / (s?.totalLosses ?? 1)).toFixed(2) : "—";
  const openTrades = s?.openTrades ?? [];
// ─── Performance metrics ──────────────────────────────────────
const tradeHist = history ?? [];
const wonTrades = tradeHist.filter((t: any) => t.won);
const lostTrades = tradeHist.filter((t: any) => !t.won);
const avgWin = wonTrades.length > 0
  ? wonTrades.reduce((sum: number, t: any) => sum + t.pnl, 0) / wonTrades.length : 0;
const avgLoss = lostTrades.length > 0
  ? Math.abs(lostTrades.reduce((sum: number, t: any) => sum + t.pnl, 0) / lostTrades.length) : 0;
const rr = avgLoss > 0 ? avgWin / avgLoss : 0;
const expectancy = totalTrades > 0
  ? ((winRate / 100) * avgWin) - ((1 - winRate / 100) * avgLoss) : 0;
const equityPeak = Math.max(
  ...(s?.equityCurve ?? []).map((e: any) => e.equity),
  balance > 0 ? balance : 0
);
const maxDrawdownPct = equityPeak > 0
  ? ((equityPeak - equity) / equityPeak) * 100 : 0;
const bestTrade = tradeHist.length > 0
  ? tradeHist.reduce((b: any, t: any) => t.pnl > (b?.pnl ?? -Infinity) ? t : b, null) : null;
const worstTrade = tradeHist.length > 0
  ? tradeHist.reduce((w: any, t: any) => t.pnl < (w?.pnl ?? Infinity) ? t : w, null) : null;

// ─── DAILY PERFORMANCE ──────────────────────────────────────
const today = new Date();
today.setHours(0, 0, 0, 0);

const todayTrades = tradeHist.filter((t: any) => {
  if (!t.closedAt) return false;

  const tradeDate = new Date(t.closedAt);
  tradeDate.setHours(0, 0, 0, 0);

  return tradeDate.getTime() === today.getTime();
});

const dailyTrades = todayTrades.length;

const dailyWins = todayTrades.filter((t: any) => t.pnl > 0);

const dailyLosses = todayTrades.filter((t: any) => t.pnl <= 0);

const dailyWinRate =
  dailyTrades > 0
    ? (dailyWins.length / dailyTrades) * 100
    : 0;

const dailyPnl = todayTrades.reduce(
  (sum: number, t: any) => sum + (t.pnl ?? 0),
  0
);

const dailyAvgWin =
  dailyWins.length > 0
    ? dailyWins.reduce(
        (sum: number, t: any) => sum + t.pnl,
        0
      ) / dailyWins.length
    : 0;

const dailyAvgLoss =
  dailyLosses.length > 0
    ? Math.abs(
        dailyLosses.reduce(
          (sum: number, t: any) => sum + t.pnl,
          0
        ) / dailyLosses.length
      )
    : 0;

const dailyExpectancy =
  dailyTrades > 0
    ? ((dailyWinRate / 100) * dailyAvgWin) -
      ((1 - dailyWinRate / 100) * dailyAvgLoss)
    : 0;

const dailyGrossProfit = dailyWins.reduce(
  (sum: number, t: any) => sum + t.pnl,
  0
);

const dailyGrossLoss = Math.abs(
  dailyLosses.reduce(
    (sum: number, t: any) => sum + t.pnl,
    0
  )
);

const dailyProfitFactor =
  dailyGrossLoss > 0
    ? (dailyGrossProfit / dailyGrossLoss).toFixed(2)
    : "—";

// ────────────────────────────────────────────────────────────
  const isLive = s?.isLive ?? false;
  const isPaused = s?.isPaused ?? false;
  const equityCurve = s?.equityCurve ?? [];
  const logs = s?.logs ?? [];
  const portfolioHeat = (s as any)?.portfolioHeat ?? 0;
  const regimes = (s as any)?.regimes ?? {};
  const env = localStorage.getItem("oanda_env") ?? "practice";

  const navItems = [
    { id: "overview", label: "Overview", icon: <Activity className="w-5 h-5" /> },
    { id: "positions", label: "Trades", icon: <TrendingUp className="w-5 h-5" />, badge: openTrades.length > 0 ? openTrades.length : undefined },
    { id: "history", label: "History", icon: <BarChart2 className="w-5 h-5" /> },
    { id: "ai", label: "AI", icon: <Brain className="w-5 h-5" /> },
    { id: "settings", label: "Settings", icon: <Settings className="w-5 h-5" /> },
  ];

  // ── Loading screen ────────────────────────────────────────────────────────[...]
  if (!isConnected && connectMutation.isPending) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: C.bg, paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="w-16 h-16 rounded-3xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #f5a623, #e8940f)", boxShadow: "0 0 40px #f5a62340" }}>
          <Zap className="w-8 h-8" style={{ color: C.bg }} />
        </div>
        <RefreshCw className="w-6 h-6 animate-spin" style={{ color: C.amber }} />
        <p className="text-sm font-mono font-bold" style={{ color: C.mutedLight }}>Connecting to OANDA...</p>
      </div>
    );
  }

  // ── Error screen ──────────────────────────────────────────────────────────[...]
  if (!isConnected && connectError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6"
        style={{ background: C.bg }}>
        <div className="w-16 h-16 rounded-3xl flex items-center justify-center"
          style={{ background: "#2d0a0a", border: "1px solid #c0392b44" }}>
          <XCircle className="w-8 h-8" style={{ color: C.red }} />
        </div>
        <div className="text-center">
          <p className="text-base font-bold mb-2" style={{ color: C.text }}>Connection Failed</p>
          <p className="text-sm font-mono" style={{ color: C.mutedLight }}>{connectError}</p>
        </div>
        <button onClick={onLogout}
          className="px-8 py-4 rounded-2xl font-black text-sm tracking-wide active:scale-95 transition-transform"
          style={{ background: "linear-gradient(135deg, #f5a623, #e8940f)", color: C.bg }}>
          Re-enter Credentials
        </button>
      </div>
    );
  }

  // ── Main dashboard ────────────────────────────────────────────────────────[...]
  return (
    <>
    <div className="min-h-screen flex flex-col" style={{ background: C.bg, color: C.text }}>

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-5"
        style={{
          background: "rgba(5, 12, 26, 0.97)",
          borderBottom: `1px solid ${C.border}`,
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          zIndex: 100,
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          paddingBottom: "12px",
        }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #f5a623, #e8940f)" }}>
            <Zap className="w-5 h-5" style={{ color: C.bg }} />
          </div>
          <div>
            <p className="text-sm font-black tracking-wide" style={{ color: C.amber }}>OANDA BOT</p>
            <p className="text-xs font-mono" style={{ color: C.muted }}>
              {credentials.accountId.slice(-8)} · {env.toUpperCase()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Status pill */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
            style={{
              background: isLive && !isPaused ? "#00e67615" : isPaused ? "#f5a62315" : "#ff444415",
              border: `1px solid ${isLive && !isPaused ? C.green : isPaused ? C.amber : C.red}44`,
            }}>
            <div className="w-1.5 h-1.5 rounded-full"
              style={{
                background: isLive && !isPaused ? C.green : isPaused ? C.amber : C.red,
                boxShadow: `0 0 6px ${isLive && !isPaused ? C.green : isPaused ? C.amber : C.red}`,
                animation: isLive && !isPaused ? "pulse 2s infinite" : "none",
              }} />
            <span className="text-xs font-black"
              style={{ color: isLive && !isPaused ? C.green : isPaused ? C.amber : C.red }}>
              {isLive && !isPaused ? "LIVE" : isPaused ? "PAUSED" : "STOPPED"}
            </span>
          </div>

          {/* Pause/Resume */}
          {isLive && !isPaused ? (
            <button onClick={() => pauseMutation.mutate()}
              className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
              style={{ background: "#f5a62320", border: `1px solid ${C.amber}44` }}>
              <Pause className="w-4 h-4" style={{ color: C.amber }} />
            </button>
          ) : isPaused ? (
            <button onClick={() => resumeMutation.mutate()}
              className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
              style={{ background: "#00e67620", border: `1px solid ${C.green}44` }}>
              <Play className="w-4 h-4" style={{ color: C.green }} />
            </button>
          ) : null}

          {/* Logout */}
          <button onClick={onLogout}
            className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
            style={{ background: C.s1, border: `1px solid ${C.border}` }}>
            <LogOut className="w-4 h-4" style={{ color: C.mutedLight }} />
          </button>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto pb-28 px-4 pt-4 space-y-4" style={{ paddingTop: "1rem" }}>

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <>
            {/* Balance / Equity hero */}
            <div className="rounded-3xl p-5 relative overflow-hidden"
              style={{ background: "linear-gradient(135deg, #0c1a2e, #0f2040)", border: `1px solid ${C.border}` }}>
              <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10"
                style={{ background: "radial-gradient(circle, #f5a623, transparent)", transform: "translate(30%, -30%)" }} />
              <p className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: C.muted }}>Account Balance</p>
              <p className="text-4xl font-black font-mono mb-1" style={{ color: C.text }}>
                {currency} {balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-bold" style={{ color: equity >= balance ? C.green : C.red }}>
                  {equity >= balance ? "▲" : "▼"} {Math.abs(equity - balance).toFixed(2)} unrealised
                </span>
                <span className="text-xs font-mono" style={{ color: C.muted }}>
                  · {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)} total P&L
                </span>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <StatPill label="Win Rate" value={`${winRate}%`}
                color={winRate >= 55 ? C.green : winRate >= 40 ? C.amber : C.red}
                sub={`${s?.totalWins ?? 0}W / ${s?.totalLosses ?? 0}L`} />
              <StatPill label="Profit Factor" value={pf.toString()}
                color={parseFloat(pf) >= 1.5 ? C.green : parseFloat(pf) >= 1 ? C.amber : C.red}
                sub={`${totalTrades} trades`} />
                          <StatPill label="Open Trades" value={String(openTrades.length)}
                color={openTrades.length > 0 ? C.blue : C.muted}
                sub={`Heat: ${(portfolioHeat * 100).toFixed(1)}%`} />
              <StatPill label="Equity" value={`${currency} ${equity.toFixed(0)}`}
                color={equity >= balance ? C.green : C.red}
                sub={equity >= balance ? "Profitable" : "In drawdown"} />
              <StatPill label="Expectancy"
                value={expectancy !== 0 ? `${expectancy >= 0 ? "+" : ""}£${expectancy.toFixed(2)}` : "—"}
                color={expectancy > 0 ? C.green : expectancy < 0 ? C.red : C.amber}
                sub="per trade avg" />
              <StatPill label="Max Drawdown"
                value={`${maxDrawdownPct.toFixed(2)}%`}
                color={maxDrawdownPct < 3 ? C.green : maxDrawdownPct < 5 ? C.amber : C.red}
                sub="from peak equity" />
            </div>

            {/* Equity curve */}
            {equityCurve.length > 1 && (
              <div className="rounded-3xl p-4" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
                <SectionTitle>Equity Curve</SectionTitle>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={equityCurve}>
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.green} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={C.green} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="time" tick={{ fontSize: 9, fill: C.muted }} />
                    <YAxis tick={{ fontSize: 9, fill: C.muted }} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ background: "#0c1525", border: `1px solid ${C.border}`, fontSize: 10, fontFamily: "monospace", borderRadius: 12 }} />
                    <Area type="monotone" dataKey="equity" stroke={C.green} strokeWidth={2} fill="url(#eqGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Market Regimes */}
            <div className="rounded-3xl p-4" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
              <SectionTitle>Market Regimes</SectionTitle>
              <div className="space-y-2">
                {Object.entries(regimes).slice(0, 8).map(([pair, regime]: [string, any]) => (
                  <div key={pair} className="flex items-center justify-between py-2 px-3 rounded-xl"
                    style={{ background: C.s2 }}>
                    <span className="text-sm font-mono font-bold" style={{ color: C.text }}>{pair.replace("_", "/")}</span>
                    <span className="text-xs font-black px-3 py-1 rounded-full"
                      style={{
                        background: regime === "TRENDING" ? "#00e67615" : regime === "RANGING" ? "#448aff15" : "#f5a62315",
                        color: regime === "TRENDING" ? C.green : regime === "RANGING" ? C.blue : C.amber,
                        border: `1px solid ${regime === "TRENDING" ? C.green : regime === "RANGING" ? C.blue : C.amber}44`,
                      }}>{regime}</span>
                  </div>
                ))}
                {Object.keys(regimes).length === 0 && (
                  <p className="text-sm text-center py-4" style={{ color: C.muted }}>Scanning pairs...</p>
                )}
              </div>
            </div>

            {/* Activity log */}
            <div className="rounded-3xl p-4" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
              <SectionTitle>Activity Log</SectionTitle>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {logs.slice(0, 30).map((log: any, i: number) => (
                  <p key={i} className="text-xs font-mono leading-relaxed"
                    style={{ color: log.includes("✅") || log.includes("🏆") ? C.green : log.includes("💔") || log.includes("🛑") ? C.red : C.mutedLight }}>
                    {log}
                  </p>
                ))}
                {logs.length === 0 && <p className="text-sm text-center py-4" style={{ color: C.muted }}>Waiting for activity...</p>}
              </div>
            </div>
          </>
        )}

  {/* ── DAILY STATS + POSITIONS ── */}
{tab === "positions" && (
  <div className="space-y-6">
    <div className="p-5 rounded-2xl" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-semibold flex items-center gap-2" style={{ color: C.amber }}>
          📊 Daily / Overall Stats
        </h3>
        <span className="text-xs" style={{ color: C.muted }}>
          {new Date().toLocaleDateString()}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
<StatPill
  label="Today Trades"
  value={String(dailyTrades)}
/>

<StatPill
  label="Today Win Rate"
  value={`${dailyWinRate.toFixed(0)}%`}
  color={dailyWinRate >= 55 ? C.green : dailyWinRate >= 40 ? C.amber : C.red}
/>

<StatPill
  label="Today P&L"
  value={`${dailyPnl >= 0 ? "+" : ""}£${dailyPnl.toFixed(2)}`}
  color={dailyPnl >= 0 ? C.green : C.red}
/>

<StatPill
  label="Today Expectancy"
  value={dailyTrades > 0 ? `£${dailyExpectancy.toFixed(2)}` : "—"}
  color={dailyExpectancy >= 0 ? C.green : C.red}
/>
      </div>
    </div>

    <div className="space-y-3">
      {openTrades.length === 0 ? (
        <div
          className="rounded-3xl p-10 flex flex-col items-center gap-3"
          style={{ background: C.s1, border: `1px solid ${C.border}` }}
        >
          <TrendingUp className="w-10 h-10" style={{ color: C.muted }} />
          <p className="text-sm font-bold" style={{ color: C.muted }}>No open positions</p>
          <p className="text-xs text-center" style={{ color: C.muted }}>
            The bot is scanning for opportunities...
          </p>
        </div>
      ) : (
        openTrades.map((trade: any) => {
          const lp = (livePrices as any)?.[trade.instrument];
          const currentPrice = lp?.mid ?? trade.entryPrice;
          const isJpy = trade.instrument.includes("JPY");
          const pipFactor = isJpy ? 100 : 10000;
          const rawDiff =
            trade.direction === "BUY"
              ? currentPrice - trade.entryPrice
              : trade.entryPrice - currentPrice;
          const livePips = rawDiff * pipFactor;
          const isProfit = livePips >= 0;
          const dp = isJpy ? 3 : 5;

          return (
            <div
              key={trade.id}
              className="rounded-3xl p-4"
              style={{
                background: C.s1,
                border: `2px solid ${isProfit ? C.green + "44" : C.red + "44"}`,
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-black px-3 py-1 rounded-full"
                    style={{
                      background: trade.direction === "BUY" ? "#00e67615" : "#ff444415",
                      color: trade.direction === "BUY" ? C.green : C.red,
                      border: `1px solid ${trade.direction === "BUY" ? C.green : C.red}44`,
                    }}
                  >
                    {trade.direction}
                  </span>
                  <span className="text-base font-black">
                    {trade.instrument.replace("_", "/")}
                  </span>
                </div>

                <button
                  onClick={() => {
                    if (!closingTrades.has(trade.id)) {
                      closeTradeMutation.mutate({ tradeId: trade.id });
                    }
                  }}
                  disabled={closingTrades.has(trade.id)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold active:scale-90 transition-all disabled:opacity-60"
                  style={{
                    background: "#ff444420",
                    color: C.red,
                    border: `1px solid ${C.red}44`,
                  }}
                >
                  {closingTrades.has(trade.id) ? "..." : "Close"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <StatPill label="Entry" value={trade.entryPrice.toFixed(dp)} />
                <StatPill label="Now" value={currentPrice.toFixed(dp)} color={isProfit ? C.green : C.red} />
                <StatPill label="SL" value={trade.stopLoss.toFixed(dp)} color={C.red} />
                <StatPill label="TP" value={trade.takeProfit.toFixed(dp)} color={C.green} />
              </div>

              <div className="flex justify-between items-center mt-3">
                <span className="text-xs" style={{ color: C.muted }}>
                  {trade.units.toLocaleString()} units
                </span>
                <span className="text-sm font-black font-mono" style={{ color: isProfit ? C.green : C.red }}>
                  {isProfit ? "+" : ""}{livePips.toFixed(1)}p
                </span>
              </div>
            </div>
          );
        })
      )}
    </div>
  </div>
)}

{/* ── HISTORY ── */}
{tab === "history" && (
  <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3">
      <StatPill label="Total Trades" value={String(history?.length ?? 0)} />
      <StatPill label="Win Rate" value={`${winRate}%`} color={winRate >= 55 ? C.green : C.amber} />
      <StatPill label="Profit Factor" value={pf.toString()} color={parseFloat(pf) >= 1.5 ? C.green : C.amber} />
      <StatPill label="Total P&L" value={`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}`} color={totalPnl >= 0 ? C.green : C.red} sub={currency} />
    </div>

    <button
      onClick={() => setTab("backtest")}
      className="w-full flex items-center justify-between p-4 rounded-2xl active:scale-98 transition-transform"
      style={{ background: C.s1, border: `1px solid ${C.border}` }}
    >
      <div className="flex items-center gap-3">
        <FlaskConical className="w-5 h-5" style={{ color: C.blue }} />
        <span className="text-sm font-bold">Run a Backtest</span>
      </div>
      <ChevronRight className="w-4 h-4" style={{ color: C.muted }} />
    </button>

    {(history ?? []).map((trade: any, i: number) => (
      <div
        key={i}
        className="rounded-2xl overflow-hidden active:scale-[0.98] transition-transform cursor-pointer"
        onClick={() => setSelectedTrade(trade)}
        style={{
          background: C.s1,
          border: `1px solid ${trade.won ? C.green + "33" : C.red + "33"}`,
        }}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <p className="text-base font-black">{trade.instrument?.replace("_", "/")}</p>
            <p className="text-xs" style={{ color: C.muted }}>{trade.direction} · {trade.closeReason ?? "—"}</p>
          </div>
          <div className="text-right">
            <p className="text-base font-black font-mono" style={{ color: trade.won ? C.green : C.red }}>
              {trade.won ? "+" : ""}{(trade.pnl ?? 0).toFixed(2)} {currency}
            </p>
            <p className="text-xs font-mono" style={{ color: C.muted }}>
              {(trade.pips ?? 0).toFixed(1)} pips
            </p>
          </div>
        </div>
      </div>
    ))}

    {(!history || history.length === 0) && (
      <div
        className="rounded-3xl p-10 flex flex-col items-center gap-3"
        style={{ background: C.s1, border: `1px solid ${C.border}` }}
      >
        <Target className="w-10 h-10" style={{ color: C.muted }} />
        <p className="text-sm font-bold" style={{ color: C.muted }}>No closed trades yet</p>
      </div>
    )}
  </div>
)}


        {/* ── BACKTEST (accessible from History tab button) ── */}
        {tab === "backtest" && (
          <div className="space-y-4">
            <div className="rounded-3xl p-4" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
              <SectionTitle>Run Backtest</SectionTitle>
              <div className="space-y-3 mb-4">
                {[
                  { label: "Pair", value: backtestPair, options: ["EUR_USD", "GBP_USD", "USD_JPY", "EUR_GBP", "AUD_USD", "USD_CHF", "USD_CAD", "NZD_USD"], onChange: setBacktestPair },
                  { label: "Timeframe", value: backtestGranularity, options: ["M5", "M15", "M30", "H1", "H4"], onChange: setBacktestGranularity },
                ].map(({ label, value, options, onChange }) => (
                  <div key={label}>
                    <p className="text-xs font-bold tracking-widest uppercase mb-1.5" style={{ color: C.muted }}>{label}</p>
                    <select value={value} onChange={e => onChange(e.target.value)}
                      className="w-full rounded-xl px-4 py-3 text-sm font-mono outline-none"
                      style={{ background: C.s2, border: `1px solid ${C.border}`, color: C.text }}>
                      {options.map(o => <option key={o} value={o}>{o.replace("_", "/")}</option>)}
                    </select>
                  </div>
                ))}
                <div>
                  <p className="text-xs font-bold tracking-widest uppercase mb-1.5" style={{ color: C.muted }}>Candles</p>
                  <select value={backtestCount} onChange={e => setBacktestCount(Number(e.target.value))}
                    className="w-full rounded-xl px-4 py-3 text-sm font-mono outline-none"
                    style={{ background: C.s2, border: `1px solid ${C.border}`, color: C.text }}>
                    {[200, 500, 1000, 2000].map(n => <option key={n} value={n}>{n} candles</option>)}
                  </select>
                </div>
              </div>
              <button onClick={() => backtestMutation.mutate({ instrument: backtestPair, granularity: backtestGranularity, count: backtestCount })}
                disabled={backtestMutation.isPending}
                className="w-full py-4 rounded-2xl font-black text-sm tracking-wide active:scale-95 transition-transform disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #448aff, #2979ff)", color: "#fff" }}>
                {backtestMutation.isPending ? "Running..." : "▶ Run Backtest"}
              </button>
            </div>

            {backtestMutation.data && (() => {
              const r = backtestMutation.data;
              return (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <StatPill label="Win Rate" value={`${(r.winRate * 100).toFixed(1)}%`} color={r.winRate >= 0.55 ? C.green : C.amber} />
                    <StatPill label="Profit Factor" value={r.profitFactor.toFixed(2)} color={r.profitFactor >= 1.5 ? C.green : C.amber} />
                    <StatPill label="Total Pips" value={`${r.totalPips >= 0 ? "+" : ""}${r.totalPips.toFixed(1)}`} color={r.totalPips >= 0 ? C.green : C.red} />
                    <StatPill label="Max Drawdown" value={`${(r.maxDrawdown * 100).toFixed(1)}%`} color={r.maxDrawdown < 0.05 ? C.green : C.red} />
                    <StatPill label="Trades" value={String(r.totalTrades)} sub={`${r.wins}W / ${r.losses}L`} />
                    <StatPill label="Expectancy" value={`${r.expectancy >= 0 ? "+" : ""}${r.expectancy.toFixed(1)}p`} color={r.expectancy >= 0 ? C.green : C.red} />
                  </div>
                  <div className="rounded-3xl p-4" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
                    <SectionTitle>Backtest Equity Curve</SectionTitle>
                    <ResponsiveContainer width="100%" height={180}>
                      <AreaChart data={r.equityCurve}>
                        <defs>
                          <linearGradient id="btGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={C.blue} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={C.blue} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="index" tick={{ fontSize: 9, fill: C.muted }} />
                        <YAxis tick={{ fontSize: 9, fill: C.muted }} domain={["auto", "auto"]} />
                        <Tooltip contentStyle={{ background: "#0c1525", border: `1px solid ${C.border}`, fontSize: 10, fontFamily: "monospace", borderRadius: 12 }} />
                        <Area type="monotone" dataKey="equity" stroke={C.blue} strokeWidth={2} fill="url(#btGrad)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ── AI ── */}
        {tab === "ai" && (
          <div className="space-y-4">
            {readiness && (
              <div className="rounded-3xl p-4"
                style={{ background: C.s1, border: `2px solid ${readiness.readyForFunded ? C.green + "44" : C.border}` }}>
                <div className="flex items-center justify-between mb-3">
                  <SectionTitle>🎯 Funded Readiness</SectionTitle>
                  <span className="text-sm font-black" style={{ color: readiness.readyForFunded ? C.green : C.amber }}>
                    {readiness.passing}/{readiness.total}
                  </span>
                </div>
                <div className="space-y-2">
                  {readiness.criteria.map((c: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-2.5 px-3 rounded-xl"
                      style={{ background: C.s2 }}>
                      <div className="flex items-center gap-2">
                        {c.pass ? <CheckCircle2 className="w-4 h-4" style={{ color: C.green }} /> : <XCircle className="w-4 h-4" style={{ color: C.red }} />}
                        <span className="text-sm" style={{ color: c.pass ? C.text : C.muted }}>{c.label}</span>
                      </div>
                      <span className="text-sm font-black" style={{ color: c.pass ? C.green : C.red }}>{c.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

{memoryDashboard && (
  <div className="rounded-3xl p-4" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
    <SectionTitle>🧠 Engine Brain</SectionTitle>

    <div className="grid grid-cols-2 gap-3 mb-3">
      <StatPill
        label="Memory Trades"
        value={String(memoryDashboard.marketMemory?.total ?? 0)}
        color={C.blue}
        sub={`${((memoryDashboard.marketMemory?.winRate ?? 0) * 100).toFixed(0)}% WR`}
      />

      <StatPill
        label="Genome"
        value={String(memoryDashboard.strategyGenome?.enabled ?? 0)}
        color={C.green}
        sub={`${memoryDashboard.strategyGenome?.disabled ?? 0} disabled`}
      />

      <StatPill
        label="Matrix Cells"
        value={String(memoryDashboard.strategyRegimeMatrix?.total ?? 0)}
        color={C.amber}
        sub={`${memoryDashboard.strategyRegimeMatrix?.enabled ?? 0} active`}
      />

      <StatPill
        label="Memory P&L"
        value={`${(memoryDashboard.marketMemory?.pnl ?? 0) >= 0 ? "+" : ""}${(memoryDashboard.marketMemory?.pnl ?? 0).toFixed(2)}`}
        color={(memoryDashboard.marketMemory?.pnl ?? 0) >= 0 ? C.green : C.red}
      />
    </div>

    {(memoryDashboard.strategyGenome?.top ?? []).length > 0 && (
      <div className="rounded-2xl p-3 mb-3" style={{ background: C.s2 }}>
        <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: C.muted }}>
          Top Strategies
        </p>

        <div className="space-y-2">
          {memoryDashboard.strategyGenome.top.slice(0, 5).map((g: any) => (
            <div key={g.name} className="flex items-center justify-between">
              <span className="text-xs font-bold" style={{ color: C.text }}>{g.name}</span>
              <span className="text-xs font-mono" style={{ color: g.enabled ? C.green : C.red }}>
                {g.trades} trades · {g.score.toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      </div>
    )}

    {(memoryDashboard.strategyRegimeMatrix?.top ?? []).length > 0 && (
      <div className="rounded-2xl p-3" style={{ background: C.s2 }}>
        <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: C.muted }}>
          Best Strategy / Regime Combos
        </p>

        <div className="space-y-2">
          {memoryDashboard.strategyRegimeMatrix.top.slice(0, 5).map((c: any) => (
            <div key={c.key} className="flex items-center justify-between">
              <span className="text-xs font-bold" style={{ color: C.text }}>
                {c.strategy} / {c.regime}
              </span>
              <span className="text-xs font-mono" style={{ color: c.enabled ? C.green : C.red }}>
                {c.wins}W/{c.losses}L · {(c.score * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
)}

{decisionJournal && (
  <div className="rounded-3xl p-4" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
    <SectionTitle>🧾 Decision Intelligence</SectionTitle>

    <div className="grid grid-cols-2 gap-3 mb-3">
      <StatPill
        label="Decisions"
        value={String(decisionJournal.analytics?.total ?? 0)}
        color={C.blue}
      />

      <StatPill
        label="Block Rate"
        value={`${((decisionJournal.analytics?.blockRate ?? 0) * 100).toFixed(0)}%`}
        color={(decisionJournal.analytics?.blockRate ?? 0) > 0.5 ? C.red : C.amber}
      />

      <StatPill
        label="Approval Rate"
        value={`${((decisionJournal.analytics?.approvalRate ?? 0) * 100).toFixed(0)}%`}
        color={C.green}
      />

      <StatPill
        label="Avg Meta"
        value={`${((decisionJournal.analytics?.avgMetaScore ?? 0) * 100).toFixed(0)}%`}
        color={C.amber}
      />
    </div>

    <div className="rounded-2xl p-3" style={{ background: C.s2 }}>
      <p className="text-xs font-bold tracking-widest uppercase mb-2" style={{ color: C.muted }}>
        Recent Decisions
      </p>

      <div className="space-y-2 max-h-48 overflow-y-auto">
        {(decisionJournal.recent ?? []).slice(0, 10).map((d: any) => (
          <div key={d.id} className="text-xs leading-relaxed" style={{ color: C.mutedLight }}>
            <span style={{ color: d.type === "BLOCKED" ? C.red : d.type === "EXECUTED" ? C.green : C.amber }}>
              {d.type}
            </span>{" "}
            {d.instrument?.replace("_", "/")} {d.direction} · {d.stage} · {d.reason}
          </div>
        ))}
      </div>
    </div>
  </div>
)}

{learning && (
  <div
    className="rounded-3xl p-4"
    style={{ background: C.s1, border: `1px solid ${C.border}` }}
  >
    <SectionTitle>
      🔬 Learned Parameters (v{learning.totalEvolutions})
    </SectionTitle>

    <div
      className="rounded-2xl p-4 mt-3"
      style={{ background: C.s2, border: `1px solid ${C.border}` }}
    >
      <div className="flex justify-between items-center mb-2">
        <p
          className="text-xs font-bold tracking-widest uppercase"
          style={{ color: C.muted }}
        >
          Evolution Progress
        </p>
        <span className="text-xs font-black" style={{ color: C.amber }}>
          {Math.max(0, 20 - (totalTrades % 20))} trades to V
          {(learning.totalEvolutions ?? 0) + 1}
        </span>
      </div>

      <div
        className="h-2 rounded-full overflow-hidden mb-2"
        style={{ background: "#0d1526" }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(
              100,
              ((totalTrades % 30) / 30) * 100
            )}%`,
            background: C.amber,
          }}
        />
      </div>

      <p className="text-xs" style={{ color: C.muted }}>
        {totalTrades} trades analysed · Version{" "}
        {learning.totalEvolutions ?? 0} active
      </p>
    </div>

    <div className="grid grid-cols-3 gap-2 mt-3">
      {Object.entries(learning.params ?? {})
        .filter(([k]) => k !== "version")
        .map(([k, v]) => (
          <div
            key={k}
            className="rounded-xl p-3"
            style={{ background: C.s2 }}
          >
            <p className="text-xs mb-1" style={{ color: C.muted }}>
              {k}
            </p>
            <p
              className="text-sm font-black font-mono"
              style={{ color: C.blue }}
            >
              {typeof v === "number" ? v.toFixed(3) : String(v)}
            </p>
          </div>
        ))}
    </div>
  </div>
)}

            {learning && Object.keys(learning.pairs ?? {}).length > 0 && (
              <div className="rounded-3xl p-4" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
                <SectionTitle>📊 Pair Performance</SectionTitle>
                <div className="space-y-2">
                  {Object.entries(learning.pairs).sort(([, a]: any, [, b]: any) =>
                    (b.wins / Math.max(1, b.wins + b.losses)) - (a.wins / Math.max(1, a.wins + a.losses))
                  ).map(([pair, p]: any) => {
                    const total = p.wins + p.losses;
                    const wr = total > 0 ? (p.wins / total * 100).toFixed(0) : "—";
                    return (
                      <div key={pair} className="flex items-center justify-between py-2.5 px-3 rounded-xl"
                        style={{ background: C.s2 }}>
                        <span className="text-sm font-bold">{pair.replace("_", "/")}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs" style={{ color: C.muted }}>{p.wins}W/{p.losses}L</span>
                          <span className="text-sm font-black"
                            style={{ color: parseFloat(wr) >= 55 ? C.green : parseFloat(wr) >= 40 ? C.amber : C.red }}>{wr}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {learning && (learning.insights ?? []).length > 0 && (
              <div className="rounded-3xl p-4" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
                <SectionTitle>💡 AI Insights</SectionTitle>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {learning.insights.slice(-20).reverse().map((insight: string, i: number) => (
                    <p key={i} className="text-xs leading-relaxed" style={{ color: C.mutedLight }}>• {insight}</p>
                  ))}
                </div>
              </div>
            )}

            {!learning && !readiness && (
              <div className="rounded-3xl p-10 flex flex-col items-center gap-3"
                style={{ background: C.s1, border: `1px solid ${C.border}` }}>
                <Brain className="w-10 h-10" style={{ color: C.muted }} />
                <p className="text-sm font-bold" style={{ color: C.muted }}>AI learning in progress</p>
                <p className="text-xs text-center" style={{ color: C.muted }}>Data will appear after the first trades</p>
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS ── */}
        {tab === "settings" && (
          <div className="space-y-4">
            {/* Prop Firm Mode */}
            <div className="rounded-3xl p-4"
              style={{ background: C.s1, border: `2px solid ${propFirmEnabled ? C.amber + "44" : C.border}` }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: "#f5a62320" }}>
                    <Shield className="w-5 h-5" style={{ color: C.amber }} />
                  </div>
                  <div>
                    <p className="text-sm font-black" style={{ color: C.text }}>Prop Firm Mode</p>
                    <p className="text-xs" style={{ color: C.muted }}>Strict risk rules</p>
                  </div>
                </div>
                <button onClick={() => {
                  const next = !propFirmEnabled;
                  setPropFirmEnabled(next);
                  propFirmMutation.mutate({ enabled: next, maxDailyLossPct: 5, maxTotalDrawdownPct: 10, profitTargetPct: 10 });
                }} className="relative w-12 h-6 rounded-full transition-all duration-200"
                  style={{ background: propFirmEnabled ? C.green : C.muted }}>
                  <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200"
                    style={{ left: propFirmEnabled ? "calc(100% - 1.375rem)" : "0.125rem" }} />
                </button>
              </div>
              <div className="space-y-2">
                {[
                  "Risk per trade: 0.5% (from 1%)",
                  "Max 2 concurrent trades",
                  "Daily loss guard: 5%",
                  "Total drawdown limit: 10%",
                  "Profit target: 10%",
                ].map((rule, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: propFirmEnabled ? C.green : C.muted }} />
                    <span className="text-xs" style={{ color: propFirmEnabled ? C.text : C.muted }}>{rule}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Telegram */}
            <div className="rounded-3xl p-4"
              style={{ background: C.s1, border: `2px solid ${telegramConfig?.enabled ? C.blue + "44" : C.border}` }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: "#448aff20" }}>
                  <Bell className="w-5 h-5" style={{ color: C.blue }} />
                </div>
                <div>
                  <p className="text-sm font-black" style={{ color: C.text }}>Telegram Alerts</p>
                  <p className="text-xs" style={{ color: telegramConfig?.enabled ? C.blue : C.muted }}>
                    {telegramConfig?.enabled ? "Active" : "Not configured"}
                  </p>
                </div>
              </div>
              <p className="text-xs leading-relaxed mb-3" style={{ color: C.mutedLight }}>
                1. Message @BotFather → /newbot → copy token{"\n"}
                2. Message your bot, visit api.telegram.org/bot[TOKEN]/getUpdates for chat ID
              </p>
              <div className="space-y-3 mb-3">
                <input type="password" value={telegramToken}
                  onChange={e => { setTelegramToken(e.target.value); setTelegramSaved(false); }}
                  placeholder="Bot token: 123456789:ABCdef..."
                  className="w-full rounded-xl px-4 py-3 text-sm font-mono outline-none"
                  style={{ background: C.s2, border: `1px solid ${C.border}`, color: C.text }} />
                <input type="text" value={telegramChatId}
                  onChange={e => { setTelegramChatId(e.target.value); setTelegramSaved(false); }}
                  placeholder="Chat ID: -1001234567890"
                  className="w-full rounded-xl px-4 py-3 text-sm font-mono outline-none"
                  style={{ background: C.s2, border: `1px solid ${C.border}`, color: C.text }} />
              </div>
              <button onClick={() => telegramMutation.mutate({ token: telegramToken, chatId: telegramChatId })}
                disabled={!telegramToken || !telegramChatId || telegramMutation.isPending}
                className="w-full py-3.5 rounded-2xl font-black text-sm tracking-wide active:scale-95 transition-transform disabled:opacity-40"
                style={{ background: telegramSaved ? `linear-gradient(135deg, ${C.green}, #00c853)` : "linear-gradient(135deg, #448aff, #2979ff)", color: "#fff" }}>
                {telegramSaved ? "✓ Saved" : telegramMutation.isPending ? "Saving..." : "Save & Enable"}
              </button>
            </div>

            {/* Bot config */}
            <div className="rounded-3xl p-4" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
              <SectionTitle>Bot Configuration</SectionTitle>
              <div className="space-y-0">
                {[
                  { label: "Risk per Trade", value: `${s?.config?.riskPercent ?? 1}%` },
                  { label: "Max Concurrent Trades", value: String(s?.config?.maxConcurrentTrades ?? 3) },
                  { label: "SL Multiplier (ATR)", value: `${s?.config?.slAtrMultiplier ?? 1.5}x` },
                  { label: "TP Multiplier (ATR)", value: `${s?.config?.tpAtrMultiplier ?? 3.0}x` },
                  { label: "Min Confidence", value: `${((s?.config?.minConfidence ?? 0.78) * 100).toFixed(0)}%` },
                  { label: "Session Filter", value: s?.config?.sessions?.join(", ") ?? "ALL" },
                ].map(({ label, value }, i, arr) => (
                  <div key={label} className="flex items-center justify-between py-3"
                    style={{ borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none" }}>
                    <span className="text-sm" style={{ color: C.mutedLight }}>{label}</span>
                    <span className="text-sm font-black" style={{ color: C.text }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Danger zone */}
            <div className="rounded-3xl p-4" style={{ background: C.s1, border: `1px solid ${C.border}` }}>
              <SectionTitle>Account</SectionTitle>
              <button
                onClick={() => { if (window.confirm("Reset all stats and trade history? This cannot be undone.")) resetStatsMutation.mutate(); }}
                disabled={resetStatsMutation.isPending}
                className="w-full flex items-center justify-between py-3.5 px-4 rounded-2xl active:scale-95 transition-transform mb-2 disabled:opacity-50"
                style={{ background: "#ff990015", border: `1px solid #ff990033` }}>
                <div className="flex items-center gap-3">
                  <span style={{ color: "#ff9900", fontSize: 16 }}>🔄</span>
                  <span className="text-sm font-bold" style={{ color: "#ff9900" }}>
                    {resetStatsMutation.isPending ? "Resetting..." : resetStatsMutation.isSuccess ? "✓ Stats Reset" : "Reset Stats & History"}
                  </span>
                </div>
              </button>
              <button onClick={onLogout}
                className="w-full flex items-center justify-between py-3.5 px-4 rounded-2xl active:scale-95 transition-transform"
                style={{ background: "#ff444415", border: `1px solid ${C.red}33` }}>
                <div className="flex items-center gap-3">
                  <LogOut className="w-4 h-4" style={{ color: C.red }} />
                  <span className="text-sm font-bold" style={{ color: C.red }}>Disconnect Account</span>
                </div>
                <ChevronRight className="w-4 h-4" style={{ color: C.red }} />
              </button>
            </div>
          </div>
        )}
      </div>

            {/* ── Bottom navigation bar ── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40"
        style={{
          background: "rgba(5, 12, 26, 0.97)",
          borderTop: `1px solid ${C.border}`,
          backdropFilter: "blur(20px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <div className="flex items-stretch">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className="flex-1 flex flex-col items-center justify-center py-3 gap-1 relative transition-all duration-150 active:scale-90"
              style={{ color: tab === item.id ? C.amber : C.muted }}
            >
              {item.badge !== undefined && (
                <div
                  className="absolute top-2 right-1/2 translate-x-3 w-4 h-4 rounded-full flex items-center justify-center text-xs font-black"
                  style={{ background: C.red, color: "#fff", fontSize: 9 }}
                >
                  {item.badge}
                </div>
              )}

              <div style={{ color: tab === item.id ? C.amber : C.muted }}>
                {item.icon}
              </div>

              <span className="text-xs font-bold" style={{ fontSize: 10 }}>
                {item.label}
              </span>

              {tab === item.id && (
                <div
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full"
                  style={{ background: C.amber }}
                />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>

    {selectedTrade && (
      <TradeChartModal
        trade={selectedTrade}
        currency={currency}
        onClose={() => setSelectedTrade(null)}
      />
    )}
  </>
);
}