import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Zap,
  Pause,
  Play,
  LogOut,
  Settings,
  Activity,
  DollarSign,
  Target,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

interface DashboardProps {
  credentials: { token: string; accountId: string };
  onLogout: () => void;
}

interface Position {
  id: string;
  instrument: string;
  direction: "BUY" | "SELL";
  units: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}

interface Trade {
  id: string;
  timestamp: string;
  instrument: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  duration: string;
}

interface EquityData {
  timestamp: string;
  balance: number;
  drawdown: number;
}

export default function Dashboard({ credentials, onLogout }: DashboardProps) {
  const [autoTrading, setAutoTrading] = useState(true);
  const [balance, setBalance] = useState(20.0);
  const [equity, setEquity] = useState(20.0);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [equityData, setEquityData] = useState<EquityData[]>([
    { timestamp: "00:00", balance: 20.0, drawdown: 0 },
  ]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    winRate: 0,
    profitFactor: 0,
    riskRewardRatio: 0,
    totalTrades: 0,
    totalPnL: 0,
  });

  useEffect(() => {
    // Simulate loading data
    const timer = setTimeout(() => {
      setLoading(false);
      // Mock data
      setPositions([
        {
          id: "1",
          instrument: "GBP_USD",
          direction: "BUY",
          units: 100,
          entryPrice: 1.2650,
          currentPrice: 1.2665,
          pnl: 15,
          pnlPercent: 0.12,
        },
      ]);
      setTrades([
        {
          id: "1",
          timestamp: "14:32",
          instrument: "EUR_USD",
          direction: "SELL",
          entryPrice: 1.0950,
          exitPrice: 1.0935,
          pnl: 150,
          pnlPercent: 0.14,
          duration: "5m 23s",
        },
      ]);
      setStats({
        winRate: 62,
        profitFactor: 2.1,
        riskRewardRatio: 1.8,
        totalTrades: 8,
        totalPnL: 450,
      });
      setEquity(20.45);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-amber-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin mb-4">
            <Zap className="w-8 h-8 text-amber-400" />
          </div>
          <p className="text-amber-100 font-mono">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-amber-50">
      {/* Header */}
      <div className="bg-slate-900 border-b border-amber-900/30 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-amber-400 font-mono">
              ⚡ OANDA BOT
            </h1>
            <p className="text-amber-900/60 text-xs font-mono">
              Account: {credentials.accountId}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setAutoTrading(!autoTrading)}
              className={`${
                autoTrading
                  ? "bg-green-900/30 hover:bg-green-900/50 text-green-400"
                  : "bg-red-900/30 hover:bg-red-900/50 text-red-400"
              } font-mono text-sm h-9`}
            >
              {autoTrading ? (
                <>
                  <Play className="w-4 h-4 mr-1" />
                  LIVE
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4 mr-1" />
                  PAUSED
                </>
              )}
            </Button>
            <Button
              onClick={onLogout}
              className="bg-slate-800 hover:bg-slate-700 text-amber-50 font-mono text-sm h-9"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto p-4 space-y-4">
        {/* Equity Summary */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card className="bg-slate-900 border-amber-900/30 p-4">
            <p className="text-amber-900/60 text-xs font-mono mb-1">Balance</p>
            <p className="text-2xl font-bold text-amber-400 font-mono">
              £{balance.toFixed(2)}
            </p>
          </Card>
          <Card className="bg-slate-900 border-amber-900/30 p-4">
            <p className="text-amber-900/60 text-xs font-mono mb-1">Equity</p>
            <p className="text-2xl font-bold text-amber-400 font-mono">
              £{equity.toFixed(2)}
            </p>
            <p
              className={`text-xs font-mono ${
                equity >= balance ? "text-green-400" : "text-red-400"
              }`}
            >
              {equity >= balance ? "+" : ""}
              {(equity - balance).toFixed(2)}
            </p>
          </Card>
          <Card className="bg-slate-900 border-amber-900/30 p-4">
            <p className="text-amber-900/60 text-xs font-mono mb-1">Win Rate</p>
            <p className="text-2xl font-bold text-amber-400 font-mono">
              {stats.winRate}%
            </p>
          </Card>
          <Card className="bg-slate-900 border-amber-900/30 p-4">
            <p className="text-amber-900/60 text-xs font-mono mb-1">
              Profit Factor
            </p>
            <p className="text-2xl font-bold text-amber-400 font-mono">
              {stats.profitFactor.toFixed(1)}x
            </p>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="bg-slate-900 border-b border-amber-900/30 w-full justify-start rounded-none">
            <TabsTrigger
              value="overview"
              className="data-[state=active]:bg-amber-900/30 data-[state=active]:text-amber-400 font-mono text-sm"
            >
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="positions"
              className="data-[state=active]:bg-amber-900/30 data-[state=active]:text-amber-400 font-mono text-sm"
            >
              Positions
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="data-[state=active]:bg-amber-900/30 data-[state=active]:text-amber-400 font-mono text-sm"
            >
              History
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="data-[state=active]:bg-amber-900/30 data-[state=active]:text-amber-400 font-mono text-sm"
            >
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <Card className="bg-slate-900 border-amber-900/30 p-4">
              <h3 className="text-amber-400 font-bold font-mono mb-4">
                Equity Curve
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={equityData}>
                  <defs>
                    <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#b45309" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#b45309" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#78350f" />
                  <XAxis dataKey="timestamp" stroke="#a16207" />
                  <YAxis stroke="#a16207" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      border: "1px solid #78350f",
                      color: "#fbbf24",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="#fbbf24"
                    fillOpacity={1}
                    fill="url(#colorBalance)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-slate-900 border-amber-900/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-amber-900/60 text-xs font-mono">
                    Risk/Reward
                  </p>
                  <Target className="w-4 h-4 text-amber-400" />
                </div>
                <p className="text-xl font-bold text-amber-400 font-mono">
                  {stats.riskRewardRatio.toFixed(1)}:1
                </p>
              </Card>
              <Card className="bg-slate-900 border-amber-900/30 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-amber-900/60 text-xs font-mono">
                    Total Trades
                  </p>
                  <Activity className="w-4 h-4 text-amber-400" />
                </div>
                <p className="text-xl font-bold text-amber-400 font-mono">
                  {stats.totalTrades}
                </p>
              </Card>
            </div>
          </TabsContent>

          {/* Positions Tab */}
          <TabsContent value="positions" className="space-y-4">
            {positions.length === 0 ? (
              <Card className="bg-slate-900 border-amber-900/30 p-8 text-center">
                <p className="text-amber-900/60 font-mono">No open positions</p>
              </Card>
            ) : (
              positions.map((pos) => (
                <Card
                  key={pos.id}
                  className="bg-slate-900 border-amber-900/30 p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-amber-400 font-bold font-mono">
                        {pos.direction} {pos.units} {pos.instrument}
                      </p>
                      <p className="text-amber-900/60 text-xs font-mono">
                        Entry: {pos.entryPrice.toFixed(5)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`text-lg font-bold font-mono ${
                          pos.pnl >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {pos.pnl >= 0 ? "+" : ""}£{pos.pnl.toFixed(2)}
                      </p>
                      <p
                        className={`text-xs font-mono ${
                          pos.pnl >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {pos.pnlPercent >= 0 ? "+" : ""}
                        {pos.pnlPercent.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                  <Button className="w-full bg-red-900/30 hover:bg-red-900/50 text-red-400 font-mono text-sm h-8">
                    Close Position
                  </Button>
                </Card>
              ))
            )}
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            {trades.length === 0 ? (
              <Card className="bg-slate-900 border-amber-900/30 p-8 text-center">
                <p className="text-amber-900/60 font-mono">No trade history</p>
              </Card>
            ) : (
              trades.map((trade) => (
                <Card
                  key={trade.id}
                  className="bg-slate-900 border-amber-900/30 p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-amber-400 font-bold font-mono text-sm">
                        {trade.direction} {trade.instrument}
                      </p>
                      <p className="text-amber-900/60 text-xs font-mono">
                        {trade.timestamp} • {trade.duration}
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={`font-bold font-mono text-sm ${
                          trade.pnl >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {trade.pnl >= 0 ? "+" : ""}£{trade.pnl.toFixed(2)}
                      </p>
                      <p
                        className={`text-xs font-mono ${
                          trade.pnl >= 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {trade.pnlPercent >= 0 ? "+" : ""}
                        {trade.pnlPercent.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 text-xs text-amber-900/60 font-mono">
                    <span>Entry: {trade.entryPrice.toFixed(5)}</span>
                    <span>•</span>
                    <span>Exit: {trade.exitPrice.toFixed(5)}</span>
                  </div>
                </Card>
              ))
            )}
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-4">
            <Card className="bg-slate-900 border-amber-900/30 p-4">
              <h3 className="text-amber-400 font-bold font-mono mb-4">
                Trading Settings
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="text-amber-100/70 text-xs font-mono">
                    Risk per Trade
                  </label>
                  <p className="text-amber-400 font-mono">2%</p>
                </div>
                <div>
                  <label className="text-amber-100/70 text-xs font-mono">
                    Max Daily Loss
                  </label>
                  <p className="text-amber-400 font-mono">5%</p>
                </div>
                <div>
                  <label className="text-amber-100/70 text-xs font-mono">
                    Micro-Account Mode
                  </label>
                  <p className="text-green-400 font-mono text-sm">Active</p>
                </div>
              </div>
            </Card>

            <Card className="bg-slate-900 border-amber-900/30 p-4">
              <h3 className="text-amber-400 font-bold font-mono mb-4">
                Session Windows
              </h3>
              <div className="space-y-2 text-amber-100/70 text-xs font-mono">
                <p>🇬🇧 London: 08:00 - 17:00 GMT</p>
                <p>🇺🇸 New York: 13:30 - 21:00 GMT</p>
                <p>🇯🇵 Tokyo: 00:00 - 09:00 GMT</p>
                <p>🇦🇺 Sydney: 22:00 - 07:00 GMT</p>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
