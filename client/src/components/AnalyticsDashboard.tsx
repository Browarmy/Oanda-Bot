import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { trpc } from "@/lib/trpc";

const C = {
  bg: "#050505", s1: "#0C0C0C", s2: "#111",
  s3: "#161616", border: "#1E1E1E", border2: "#2A2A2A",
  amber: "#F5A623", amberDim: "#7A5210",
  green: "#00E676", greenDim: "#004D29",
  red: "#FF3D00", redDim: "#4D1100",
  blue: "#448AFF", text: "#D8D3CA",
  muted: "#3D3D3D", muted2: "#5A5A5A",
};

const mono = "monospace";
const Card = ({ children, glow, style }: any) => <div style={{ background: C.s1, border: `1px solid ${glow || C.border}`, borderRadius: 10, padding: 14, marginBottom: 10, boxShadow: glow ? `0 0 12px ${glow}22` : "none", ...style }}>{children}</div>;
const KV = ({ k, v, col }: any) => <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
  <span style={{ fontSize: 10, color: C.muted2, fontFamily: mono, letterSpacing: 0.5 }}>{k}</span>
  <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 700, color: col || C.text }}>{v ?? "—"}</span>
</div>;

export default function AnalyticsDashboard() {
  const { data: analytics, isLoading: analyticsLoading } = trpc.trading.getAnalytics.useQuery();
  const { data: equityCurve, isLoading: equityLoading } = trpc.trading.getEquityCurve.useQuery({ limit: 500 });
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    if (equityCurve && equityCurve.length > 0) {
      const data = equityCurve.map((snapshot: any) => ({
        timestamp: new Date(snapshot.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
        nav: parseFloat(snapshot.nav.toString()),
        navPercent: parseFloat(snapshot.navPercent.toString()),
        drawdownPercent: parseFloat(snapshot.drawdownPercent.toString()),
      }));
      setChartData(data);
    }
  }, [equityCurve]);

  if (analyticsLoading || equityLoading) {
    return <div style={{ color: C.text }}>Loading analytics...</div>;
  }

  if (!analytics) {
    return <div style={{ color: C.muted2 }}>No analytics data available</div>;
  }

  return (
    <div>
      {/* Key Metrics */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
        <Card>
          <div style={{ fontSize: 9, color: C.amber, fontFamily: mono, letterSpacing: 2, marginBottom: 12 }}>PERFORMANCE METRICS</div>
          <KV k="TOTAL TRADES" v={analytics.totalTrades} />
          <KV k="WIN RATE" v={`${analytics.winRate.toFixed(1)}%`} col={analytics.winRate > 50 ? C.green : C.red} />
          <KV k="PROFIT FACTOR" v={analytics.profitFactor === Infinity ? "∞" : analytics.profitFactor.toFixed(2)} />
          <KV k="AVG RISK/REWARD" v={`1 : ${analytics.averageRR.toFixed(2)}`} />
        </Card>

        <Card>
          <div style={{ fontSize: 9, color: C.amber, fontFamily: mono, letterSpacing: 2, marginBottom: 12 }}>P&L SUMMARY</div>
          <KV k="TOTAL PnL" v={`${analytics.totalPnL > 0 ? "+" : ""}${analytics.totalPnL.toFixed(2)}`} col={analytics.totalPnL > 0 ? C.green : C.red} />
          {analytics.bestTrade && (
            <KV k="BEST TRADE" v={`+${parseFloat(analytics.bestTrade.pnl.toString()).toFixed(2)}`} col={C.green} />
          )}
          {analytics.worstTrade && (
            <KV k="WORST TRADE" v={`${parseFloat(analytics.worstTrade.pnl.toString()).toFixed(2)}`} col={C.red} />
          )}
        </Card>
      </div>

      {/* Equity Curve */}
      <Card>
        <div style={{ fontSize: 9, color: C.amber, fontFamily: mono, letterSpacing: 2, marginBottom: 12 }}>EQUITY CURVE</div>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis 
                dataKey="timestamp" 
                stroke={C.muted2}
                style={{ fontSize: 10, fontFamily: mono }}
              />
              <YAxis 
                stroke={C.muted2}
                style={{ fontSize: 10, fontFamily: mono }}
              />
              <Tooltip 
                contentStyle={{ background: C.s2, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontFamily: mono, fontSize: 10 }}
                formatter={(value: any) => value.toFixed(2)}
              />
              <Line 
                type="monotone" 
                dataKey="nav" 
                stroke={C.green} 
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted2 }}>
            No equity data yet
          </div>
        )}
      </Card>

      {/* Signal Type Breakdown */}
      {Object.keys(analytics.bySignalType).length > 0 && (
        <Card>
          <div style={{ fontSize: 9, color: C.amber, fontFamily: mono, letterSpacing: 2, marginBottom: 12 }}>PERFORMANCE BY SIGNAL TYPE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {Object.entries(analytics.bySignalType).map(([signalType, data]: any) => (
              <div key={signalType} style={{ background: C.s2, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 9, color: C.muted2, fontFamily: mono, marginBottom: 8, textTransform: "uppercase" }}>
                  {signalType.replace(/_/g, " ")}
                </div>
                <KV k="TRADES" v={data.count} />
                <KV k="WIN RATE" v={`${data.winRate.toFixed(1)}%`} col={data.winRate > 50 ? C.green : C.red} />
                <KV k="TOTAL PnL" v={`${data.totalPnL > 0 ? "+" : ""}${data.totalPnL.toFixed(2)}`} col={data.totalPnL > 0 ? C.green : C.red} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
