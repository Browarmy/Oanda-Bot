import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, ReferenceLine,
} from "recharts";
import {
  TrendingUp, TrendingDown, Zap, Pause, Play, LogOut,
  Settings, Activity, Target, CheckCircle2, XCircle,
  Brain, FlaskConical, Shield, Bell, RefreshCw,
} from "lucide-react";

interface DashboardProps {
  credentials: { token: string; accountId: string };
  onLogout: () => void;
}

const C = {
  bg: "#060d18", s1: "#0c1525", s2: "#111d2e",
  border: "#1a2d45", amber: "#f5a623", green: "#00e676",
  red: "#ff3d00", blue: "#448aff", text: "#d8d3ca",
  muted: "#4a6080",
};

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: "14px 16px" }}>
      <p style={{ fontSize: 10, color: C.muted, fontFamily: "monospace", letterSpacing: 1, marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, fontFamily: "monospace", color: color ?? C.amber }}>{value}</p>
      {sub && <p style={{ fontSize: 10, fontFamily: "monospace", color: C.muted, marginTop: 2 }}>{sub}</p>}
    </Card>
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

  // ── tRPC mutations ────────────────────────────────────────────────────────
  const connectMutation = trpc.bot.connect.useMutation({
    onSuccess: () => setIsConnected(true),
    onError: (e) => setConnectError(e.message),
  });
  const pauseMutation = trpc.bot.pause.useMutation();
  const resumeMutation = trpc.bot.resume.useMutation();
  const stopMutation = trpc.bot.stop.useMutation();
  const closeTradeMutation = trpc.bot.closeTrade.useMutation();
  const propFirmMutation = trpc.bot.setPropFirmMode.useMutation();
  const telegramMutation = trpc.bot.setTelegramConfig.useMutation({
    onSuccess: () => setTelegramSaved(true),
  });
  const backtestMutation = trpc.bot.runBacktest.useMutation();

  // ── tRPC queries ──────────────────────────────────────────────────────────
  const { data: state, refetch: refetchState } = trpc.bot.getState.useQuery(undefined, {
    enabled: isConnected,
    refetchInterval: 3000,
  });
  const { data: history } = trpc.bot.getHistory.useQuery(undefined, {
    enabled: isConnected,
    refetchInterval: 10000,
  });
  const { data: learning } = trpc.bot.getLearningInsights.useQuery(undefined, {
    enabled: isConnected && tab === "ai",
    refetchInterval: 30000,
  });
  const { data: readiness } = trpc.bot.getFundedReadiness.useQuery(undefined, {
    enabled: isConnected && tab === "ai",
    refetchInterval: 30000,
  });
  const { data: telegramConfig } = trpc.bot.getTelegramConfig.useQuery(undefined, {
    enabled: isConnected,
  });

  // Live prices for open positions
  const openInstruments = useMemo(
    () => Array.from(new Set((state?.openTrades ?? []).map((t: any) => t.instrument as string))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(state?.openTrades ?? []).map((t: any) => t.instrument).join(",")]
  );
  const { data: livePrices } = trpc.bot.getLivePrices.useQuery(
    { instruments: openInstruments },
    { enabled: isConnected && openInstruments.length > 0, refetchInterval: 2000, staleTime: 0 }
  );

  // Auto-connect on mount
  useEffect(() => {
    const env = (localStorage.getItem("oanda_env") ?? "practice") as "practice" | "live";
    connectMutation.mutate({
      token: credentials.token,
      accountId: credentials.accountId,
      environment: env,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derived values
  const s = state;
  const balance = s?.accountBalance ?? 0;
  const equity = s?.accountEquity ?? 0;
  const currency = s?.accountCurrency ?? "GBP";
  const totalPnl = s?.totalPnl ?? 0;
  const totalTrades = s?.totalTrades ?? 0;
  const winRate = totalTrades > 0 ? Math.round(((s?.totalWins ?? 0) / totalTrades) * 100) : 0;
  const pf = (s?.totalLosses ?? 0) > 0 ? ((s?.totalWins ?? 0) / (s?.totalLosses ?? 1)).toFixed(2) : "—";
  const openTrades = s?.openTrades ?? [];
  const isLive = s?.isLive ?? false;
  const isPaused = s?.isPaused ?? false;
  const equityCurve = s?.equityCurve ?? [];
  const logs = s?.logs ?? [];
  const portfolioHeat = (s as any)?.portfolioHeat ?? 0;
  const regimes = (s as any)?.regimes ?? {};

  const tabs = [
    { id: "overview", label: "Overview", icon: <Activity className="w-3 h-3" /> },
    { id: "positions", label: `Positions${openTrades.length > 0 ? ` (${openTrades.length})` : ""}`, icon: <TrendingUp className="w-3 h-3" /> },
    { id: "history", label: `History${history && history.length > 0 ? ` (${history.length})` : ""}`, icon: <Target className="w-3 h-3" /> },
    { id: "backtest", label: "Backtest", icon: <FlaskConical className="w-3 h-3" /> },
    { id: "ai", label: "🧠 AI", icon: <Brain className="w-3 h-3" /> },
    { id: "settings", label: "Settings", icon: <Settings className="w-3 h-3" /> },
  ];

  if (!isConnected && connectMutation.isPending) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: C.amber, fontFamily: "monospace" }}>
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p>Connecting to OANDA...</p>
        </div>
      </div>
    );
  }

  if (!isConnected && connectError) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: C.red, fontFamily: "monospace", maxWidth: 400 }}>
          <XCircle className="w-8 h-8 mx-auto mb-4" />
          <p style={{ marginBottom: 16 }}>Connection failed: {connectError}</p>
          <Button onClick={onLogout} style={{ background: C.amber, color: C.bg, fontFamily: "monospace" }}>
            Re-enter credentials
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "monospace" }}>
      {/* ── Header ── */}
      <div style={{ background: C.s1, borderBottom: `1px solid ${C.border}`, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Zap style={{ color: C.amber, width: 20, height: 20 }} />
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: C.amber, letterSpacing: 2 }}>OANDA BOT v8</p>
            <p style={{ fontSize: 10, color: C.muted }}>
              {credentials.accountId} · {(localStorage.getItem("oanda_env") ?? "practice").toUpperCase()}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
            background: isLive && !isPaused ? "#004d2922" : "#4d110022",
            color: isLive && !isPaused ? C.green : isPaused ? C.amber : C.red,
            border: `1px solid ${isLive && !isPaused ? C.green : isPaused ? C.amber : C.red}44`,
          }}>
            {isLive && !isPaused ? "● LIVE" : isPaused ? "⏸ PAUSED" : "■ STOPPED"}
          </span>
          {isLive && !isPaused
            ? <Button size="sm" onClick={() => pauseMutation.mutate()} style={{ background: C.amber, color: C.bg, fontSize: 10 }}><Pause className="w-3 h-3 mr-1" />PAUSE</Button>
            : isPaused
            ? <Button size="sm" onClick={() => resumeMutation.mutate()} style={{ background: C.green, color: C.bg, fontSize: 10 }}><Play className="w-3 h-3 mr-1" />RESUME</Button>
            : null}
          <Button size="sm" onClick={onLogout} style={{ background: C.s2, border: `1px solid ${C.border}`, color: C.text, fontSize: 10 }}>
            <LogOut className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, padding: "16px 20px 0" }}>
        <StatCard label="BALANCE" value={`${currency} ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
        <StatCard label="EQUITY" value={`${currency} ${equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub={`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)} total`}
          color={equity >= balance ? C.green : C.red} />
        <StatCard label="WIN RATE" value={`${winRate}%`} color={winRate >= 55 ? C.green : winRate >= 40 ? C.amber : C.red}
          sub={`${s?.totalWins ?? 0}W / ${s?.totalLosses ?? 0}L · ${totalTrades} trades`} />
        <StatCard label="PROFIT FACTOR" value={pf.toString()} color={parseFloat(pf) >= 1.5 ? C.green : parseFloat(pf) >= 1 ? C.amber : C.red}
          sub={`Portfolio heat: ${(portfolioHeat * 100).toFixed(1)}%`} />
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", gap: 4, padding: "12px 20px 0", borderBottom: `1px solid ${C.border}`, overflowX: "auto" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 14px",
            background: tab === t.id ? C.amber : "transparent",
            color: tab === t.id ? C.bg : C.muted,
            border: `1px solid ${tab === t.id ? C.amber : C.border}`,
            borderBottom: "none", borderRadius: "6px 6px 0 0",
            fontSize: 10, fontWeight: 700, letterSpacing: 1, cursor: "pointer", whiteSpace: "nowrap",
          }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div style={{ padding: "20px" }}>

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Equity curve */}
            <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 16, gridColumn: "1 / -1" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 12 }}>EQUITY CURVE</p>
              <ResponsiveContainer width="100%" height={180}>
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
                  <Tooltip contentStyle={{ background: C.s2, border: `1px solid ${C.border}`, fontSize: 10, fontFamily: "monospace" }} />
                  <Area type="monotone" dataKey="equity" stroke={C.green} strokeWidth={2} fill="url(#eqGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* Regime map */}
            <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 12 }}>MARKET REGIMES</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(regimes).slice(0, 8).map(([pair, regime]: [string, any]) => (
                  <div key={pair} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: C.text }}>{pair.replace("_", "/")}</span>
                    <span style={{
                      fontSize: 9, padding: "2px 8px", borderRadius: 10, fontWeight: 700,
                      background: regime === "TRENDING" ? "#004d2922" : regime === "RANGING" ? "#1a2d4522" : "#4d110022",
                      color: regime === "TRENDING" ? C.green : regime === "RANGING" ? C.blue : C.amber,
                      border: `1px solid ${regime === "TRENDING" ? C.green : regime === "RANGING" ? C.blue : C.amber}44`,
                    }}>{regime}</span>
                  </div>
                ))}
                {Object.keys(regimes).length === 0 && <p style={{ fontSize: 10, color: C.muted }}>Scanning pairs...</p>}
              </div>
            </Card>

            {/* Activity log */}
            <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 12 }}>ACTIVITY LOG</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                {logs.slice(0, 20).map((log: any, i: number) => (
                  <p key={i} style={{ fontSize: 9, color: log.includes("✅") || log.includes("🏆") ? C.green : log.includes("💔") || log.includes("🛑") ? C.red : C.muted, lineHeight: 1.4 }}>
                    {log}
                  </p>
                ))}
                {logs.length === 0 && <p style={{ fontSize: 10, color: C.muted }}>Waiting for activity...</p>}
              </div>
            </Card>
          </div>
        )}

        {/* ── POSITIONS ── */}
        {tab === "positions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {openTrades.length === 0 && (
              <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 24, textAlign: "center" }}>
                <p style={{ color: C.muted, fontSize: 12 }}>No open positions</p>
              </Card>
            )}
            {openTrades.map((trade: any) => {
              const lp = (livePrices as any)?.[trade.instrument];
              const currentPrice = lp?.mid ?? trade.entryPrice;
              const isJpy = trade.instrument.includes("JPY");
              const pipFactor = isJpy ? 100 : 10000;
              const rawDiff = trade.direction === "BUY" ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice;
              const livePips = rawDiff * pipFactor;
              const isProfit = livePips >= 0;
              const slDist = Math.abs(trade.entryPrice - trade.stopLoss);
              const tpDist = Math.abs(trade.takeProfit - trade.entryPrice);
              const progress = slDist + tpDist > 0 ? Math.max(0, Math.min(100, (rawDiff / tpDist) * 100)) : 0;
              const dp = isJpy ? 3 : 5;
              const durationMs = Date.now() - trade.openTime;
              const durationMin = Math.floor(durationMs / 60000);
              const durationStr = durationMin < 60 ? `${durationMin}m` : `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`;

              return (
                <Card key={trade.id} style={{
                  background: C.s1,
                  border: `2px solid ${isProfit ? C.green + "44" : C.red + "44"}`,
                  padding: 16,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 12,
                        background: trade.direction === "BUY" ? "#004d2922" : "#4d110022",
                        color: trade.direction === "BUY" ? C.green : C.red,
                        border: `1px solid ${trade.direction === "BUY" ? C.green : C.red}44`,
                      }}>{trade.direction}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{trade.instrument.replace("_", "/")}</span>
                      <span style={{ fontSize: 9, color: C.muted }}>{durationStr}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: isProfit ? C.green : C.red }}>
                        {isProfit ? "+" : ""}{livePips.toFixed(1)}p
                      </span>
                      <Button size="sm" onClick={() => closeTradeMutation.mutate({ tradeId: trade.id })}
                        style={{ background: C.red + "22", color: C.red, border: `1px solid ${C.red}44`, fontSize: 9, padding: "4px 10px" }}>
                        Close
                      </Button>
                    </div>
                  </div>

                  {/* Live price */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 }}>
                    {[
                      { k: "Entry", v: trade.entryPrice.toFixed(dp) },
                      { k: "Current", v: currentPrice.toFixed(dp), col: isProfit ? C.green : C.red },
                      { k: "SL", v: trade.stopLoss.toFixed(dp), col: C.red },
                      { k: "TP", v: trade.takeProfit.toFixed(dp), col: C.green },
                    ].map(({ k, v, col }) => (
                      <div key={k} style={{ background: C.s2, borderRadius: 6, padding: "6px 8px" }}>
                        <p style={{ fontSize: 9, color: C.muted }}>{k}</p>
                        <p style={{ fontSize: 11, fontWeight: 700, color: col ?? C.text, fontFamily: "monospace" }}>{v}</p>
                      </div>
                    ))}
                  </div>

                  {/* TP progress bar */}
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 9, color: C.muted }}>Progress to TP</span>
                      <span style={{ fontSize: 9, color: isProfit ? C.green : C.muted }}>{progress.toFixed(0)}%</span>
                    </div>
                    <div style={{ height: 4, background: C.s2, borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max(0, progress)}%`, background: isProfit ? C.green : C.red, borderRadius: 2, transition: "width 0.5s ease" }} />
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 9, color: C.muted }}>{trade.units.toLocaleString()} units</span>
                    <span style={{ fontSize: 9, color: isProfit ? C.green : C.red }}>
                      Unrealised: {isProfit ? "+" : ""}{(trade.unrealisedPnl ?? 0).toFixed(2)} {currency}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* ── HISTORY ── */}
        {tab === "history" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
              <StatCard label="TOTAL TRADES" value={String(history?.length ?? 0)} />
              <StatCard label="WIN RATE" value={`${winRate}%`} color={winRate >= 55 ? C.green : C.amber} />
              <StatCard label="PROFIT FACTOR" value={pf.toString()} color={parseFloat(pf) >= 1.5 ? C.green : C.amber} />
              <StatCard label="TOTAL P&L" value={`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)} ${currency}`} color={totalPnl >= 0 ? C.green : C.red} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(history ?? []).slice(0, 50).map((trade: any, i: number) => (
                <Card key={i} style={{ background: C.s1, border: `1px solid ${trade.won ? C.green + "33" : C.red + "33"}`, padding: "10px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: trade.direction === "BUY" ? C.green + "22" : C.red + "22", color: trade.direction === "BUY" ? C.green : C.red, border: `1px solid ${trade.direction === "BUY" ? C.green : C.red}33` }}>{trade.direction}</span>
                      <span style={{ fontSize: 11, fontWeight: 700 }}>{trade.instrument?.replace("_", "/")}</span>
                      <span style={{ fontSize: 9, color: C.muted }}>{trade.closeReason ?? "—"}</span>
                    </div>
                    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: C.muted }}>{(trade.pips ?? 0) >= 0 ? "+" : ""}{(trade.pips ?? 0).toFixed(1)}p</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: trade.won ? C.green : C.red }}>
                        {trade.won ? "+" : ""}{(trade.pnl ?? 0).toFixed(2)} {currency}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
                    <span style={{ fontSize: 9, color: C.muted }}>Entry: {(trade.entryPrice ?? 0).toFixed(5)}</span>
                    <span style={{ fontSize: 9, color: C.muted }}>Exit: {(trade.exitPrice ?? 0).toFixed(5)}</span>
                    <span style={{ fontSize: 9, color: C.muted }}>{trade.closedAt ? new Date(trade.closedAt).toLocaleString() : "—"}</span>
                  </div>
                </Card>
              ))}
              {(!history || history.length === 0) && (
                <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 24, textAlign: "center" }}>
                  <p style={{ color: C.muted, fontSize: 12 }}>No closed trades yet</p>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* ── BACKTEST ── */}
        {tab === "backtest" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 12 }}>RUN BACKTEST</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 12 }}>
                {[
                  { label: "Pair", value: backtestPair, options: ["EUR_USD", "GBP_USD", "USD_JPY", "EUR_GBP", "AUD_USD", "USD_CHF", "USD_CAD", "NZD_USD"], onChange: setBacktestPair },
                  { label: "Timeframe", value: backtestGranularity, options: ["M5", "M15", "M30", "H1", "H4"], onChange: setBacktestGranularity },
                ].map(({ label, value, options, onChange }) => (
                  <div key={label}>
                    <p style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>{label}</p>
                    <select value={value} onChange={e => onChange(e.target.value)} style={{ width: "100%", padding: "8px 10px", background: C.s2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "monospace", fontSize: 11 }}>
                      {options.map(o => <option key={o} value={o}>{o.replace("_", "/")}</option>)}
                    </select>
                  </div>
                ))}
                <div>
                  <p style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>Candles</p>
                  <select value={backtestCount} onChange={e => setBacktestCount(Number(e.target.value))} style={{ width: "100%", padding: "8px 10px", background: C.s2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "monospace", fontSize: 11 }}>
                    {[200, 500, 1000, 2000].map(n => <option key={n} value={n}>{n} candles</option>)}
                  </select>
                </div>
              </div>
              <Button onClick={() => backtestMutation.mutate({ instrument: backtestPair, granularity: backtestGranularity, count: backtestCount })}
                disabled={backtestMutation.isPending}
                style={{ background: C.amber, color: C.bg, fontFamily: "monospace", fontSize: 11, fontWeight: 700 }}>
                {backtestMutation.isPending ? "Running..." : "▶ Run Backtest"}
              </Button>
            </Card>

            {backtestMutation.data && (() => {
              const r = backtestMutation.data;
              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                    <StatCard label="WIN RATE" value={`${(r.winRate * 100).toFixed(1)}%`} color={r.winRate >= 0.55 ? C.green : C.amber} />
                    <StatCard label="PROFIT FACTOR" value={r.profitFactor.toFixed(2)} color={r.profitFactor >= 1.5 ? C.green : C.amber} />
                    <StatCard label="TOTAL PIPS" value={`${r.totalPips >= 0 ? "+" : ""}${r.totalPips.toFixed(1)}`} color={r.totalPips >= 0 ? C.green : C.red} />
                    <StatCard label="MAX DRAWDOWN" value={`${(r.maxDrawdown * 100).toFixed(1)}%`} color={r.maxDrawdown < 0.05 ? C.green : C.red} />
                    <StatCard label="TRADES" value={String(r.totalTrades)} sub={`${r.wins}W / ${r.losses}L`} />
                    <StatCard label="AVG WIN" value={`+${r.avgWinPips.toFixed(1)}p`} color={C.green} />
                    <StatCard label="AVG LOSS" value={`-${r.avgLossPips.toFixed(1)}p`} color={C.red} />
                    <StatCard label="EXPECTANCY" value={`${r.expectancy >= 0 ? "+" : ""}${r.expectancy.toFixed(1)}p`} color={r.expectancy >= 0 ? C.green : C.red} />
                  </div>

                  <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 16 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 12 }}>BACKTEST EQUITY CURVE</p>
                    <ResponsiveContainer width="100%" height={200}>
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
                        <Tooltip contentStyle={{ background: C.s2, border: `1px solid ${C.border}`, fontSize: 10, fontFamily: "monospace" }} />
                        <Area type="monotone" dataKey="equity" stroke={C.blue} strokeWidth={2} fill="url(#btGrad)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </Card>

                  <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 16 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 12 }}>TRADE DISTRIBUTION (PIPS)</p>
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={r.trades.slice(0, 50).map((t, i) => ({ i, pips: t.pips, fill: t.pips >= 0 ? C.green : C.red }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="i" tick={{ fontSize: 8, fill: C.muted }} />
                        <YAxis tick={{ fontSize: 8, fill: C.muted }} />
                        <Tooltip contentStyle={{ background: C.s2, border: `1px solid ${C.border}`, fontSize: 10, fontFamily: "monospace" }} />
                        <ReferenceLine y={0} stroke={C.muted} />
                        <Bar dataKey="pips" fill={C.blue} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Card>
                </>
              );
            })()}
          </div>
        )}

        {/* ── AI ── */}
        {tab === "ai" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Funded readiness */}
            {readiness && (
              <Card style={{ background: C.s1, border: `1px solid ${readiness.readyForFunded ? C.green + "44" : C.border}`, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.amber }}>🎯 FUNDED ACCOUNT READINESS</p>
                  <span style={{ fontSize: 11, fontWeight: 700, color: readiness.readyForFunded ? C.green : C.amber }}>
                    {readiness.passing}/{readiness.total} criteria
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {readiness.criteria.map((c: any, i: number) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: C.s2, borderRadius: 6 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {c.pass ? <CheckCircle2 style={{ width: 12, height: 12, color: C.green }} /> : <XCircle style={{ width: 12, height: 12, color: C.red }} />}
                        <span style={{ fontSize: 10, color: c.pass ? C.text : C.muted }}>{c.label}</span>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: c.pass ? C.green : C.red }}>{c.value}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Learned params */}
            {learning && (
              <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 12 }}>🔬 LEARNED PARAMETERS (v{learning.totalEvolutions} evolutions)</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {Object.entries(learning.params ?? {}).filter(([k]) => !["version"].includes(k)).map(([k, v]) => (
                    <div key={k} style={{ background: C.s2, borderRadius: 6, padding: "8px 10px" }}>
                      <p style={{ fontSize: 9, color: C.muted }}>{k}</p>
                      <p style={{ fontSize: 11, fontWeight: 700, color: C.blue }}>{typeof v === "number" ? v.toFixed(3) : String(v)}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Pair performance */}
            {learning && Object.keys(learning.pairs ?? {}).length > 0 && (
              <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 12 }}>📊 PAIR PERFORMANCE</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {Object.entries(learning.pairs).sort(([, a]: any, [, b]: any) => (b.wins / Math.max(1, b.wins + b.losses)) - (a.wins / Math.max(1, a.wins + a.losses))).map(([pair, p]: any) => {
                    const total = p.wins + p.losses;
                    const wr = total > 0 ? (p.wins / total * 100).toFixed(0) : "—";
                    return (
                      <div key={pair} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: C.s2, borderRadius: 6 }}>
                        <span style={{ fontSize: 10 }}>{pair.replace("_", "/")}</span>
                        <div style={{ display: "flex", gap: 12 }}>
                          <span style={{ fontSize: 9, color: C.muted }}>{p.wins}W/{p.losses}L</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: parseFloat(wr) >= 55 ? C.green : parseFloat(wr) >= 40 ? C.amber : C.red }}>{wr}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* AI insights */}
            {learning && (learning.insights ?? []).length > 0 && (
              <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 12 }}>💡 AI INSIGHTS</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
                  {learning.insights.slice(-20).reverse().map((insight: string, i: number) => (
                    <p key={i} style={{ fontSize: 9, color: C.muted, lineHeight: 1.5 }}>• {insight}</p>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* ── SETTINGS ── */}
        {tab === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Prop Firm Mode */}
            <Card style={{ background: C.s1, border: `1px solid ${propFirmEnabled ? C.amber + "44" : C.border}`, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Shield style={{ width: 16, height: 16, color: C.amber }} />
                  <p style={{ fontSize: 11, fontWeight: 700, color: C.amber }}>PROP FIRM MODE</p>
                </div>
                <button onClick={() => {
                  const next = !propFirmEnabled;
                  setPropFirmEnabled(next);
                  propFirmMutation.mutate({ enabled: next, maxDailyLossPct: 5, maxTotalDrawdownPct: 10, profitTargetPct: 10 });
                }} style={{
                  padding: "6px 16px", borderRadius: 20, fontSize: 10, fontWeight: 700, cursor: "pointer",
                  background: propFirmEnabled ? C.green + "22" : C.s2,
                  color: propFirmEnabled ? C.green : C.muted,
                  border: `1px solid ${propFirmEnabled ? C.green : C.border}`,
                }}>
                  {propFirmEnabled ? "ENABLED" : "DISABLED"}
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  "Risk per trade reduced to 0.5% (from 1%)",
                  "Max 2 concurrent trades (from 3)",
                  "Daily loss guard: 5% of account",
                  "Total drawdown limit: 10% of account",
                  "Profit target: 10% of account",
                  "Telegram alert when limits approached",
                ].map((rule, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <CheckCircle2 style={{ width: 10, height: 10, color: propFirmEnabled ? C.green : C.muted }} />
                    <span style={{ fontSize: 10, color: propFirmEnabled ? C.text : C.muted }}>{rule}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Telegram */}
            <Card style={{ background: C.s1, border: `1px solid ${telegramConfig?.enabled ? C.blue + "44" : C.border}`, padding: 16 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                <Bell style={{ width: 16, height: 16, color: C.blue }} />
                <p style={{ fontSize: 11, fontWeight: 700, color: C.amber }}>TELEGRAM NOTIFICATIONS</p>
                {telegramConfig?.enabled && <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, background: C.blue + "22", color: C.blue, border: `1px solid ${C.blue}44` }}>ACTIVE</span>}
              </div>
              <p style={{ fontSize: 9, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
                Get instant push notifications on your phone when trades open/close.<br />
                1. Message @BotFather on Telegram → /newbot → copy the token<br />
                2. Message your bot, then visit: api.telegram.org/bot[TOKEN]/getUpdates to get your chat ID
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                <div>
                  <p style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>Bot Token</p>
                  <input type="password" value={telegramToken} onChange={e => { setTelegramToken(e.target.value); setTelegramSaved(false); }}
                    placeholder="123456789:ABCdef..."
                    style={{ width: "100%", padding: "8px 10px", background: C.s2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "monospace", fontSize: 11 }} />
                </div>
                <div>
                  <p style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>Chat ID</p>
                  <input type="text" value={telegramChatId} onChange={e => { setTelegramChatId(e.target.value); setTelegramSaved(false); }}
                    placeholder="-1001234567890"
                    style={{ width: "100%", padding: "8px 10px", background: C.s2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: "monospace", fontSize: 11 }} />
                </div>
              </div>
              <Button onClick={() => telegramMutation.mutate({ token: telegramToken, chatId: telegramChatId })}
                disabled={!telegramToken || !telegramChatId || telegramMutation.isPending}
                style={{ background: telegramSaved ? C.green : C.blue, color: C.bg, fontFamily: "monospace", fontSize: 11, fontWeight: 700 }}>
                {telegramSaved ? "✓ Saved" : telegramMutation.isPending ? "Saving..." : "Save & Enable"}
              </Button>
            </Card>

            {/* Bot config */}
            <Card style={{ background: C.s1, border: `1px solid ${C.border}`, padding: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: C.amber, marginBottom: 12 }}>BOT CONFIGURATION</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: "Risk per Trade", value: `${s?.config?.riskPercent ?? 1}%` },
                  { label: "Max Concurrent Trades", value: String(s?.config?.maxConcurrentTrades ?? 3) },
                  { label: "SL Multiplier (ATR)", value: `${s?.config?.slAtrMultiplier ?? 1.5}x` },
                  { label: "TP Multiplier (ATR)", value: `${s?.config?.tpAtrMultiplier ?? 3.0}x` },
                  { label: "Min Confidence", value: `${((s?.config?.minConfidence ?? 0.78) * 100).toFixed(0)}%` },
                  { label: "Session Filter", value: s?.config?.sessions?.join(", ") ?? "ALL" },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ fontSize: 10, color: C.muted }}>{label}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: C.text }}>{value}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
