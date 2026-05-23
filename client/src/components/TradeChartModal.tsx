import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, LineSeries, ColorType } from "lightweight-charts";
import { X } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface ClosedTrade {
  id: string;
  instrument: string;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  openTime: number;
  closedAt: number;
  pnl: number;
  pips: number;
  won: boolean;
  closeReason: string;
}

interface Props {
  trade: ClosedTrade | null;
  currency: string;
  onClose: () => void;
}

const C = {
  bg: "#050c1a",
  s1: "rgba(12, 21, 37, 0.98)",
  border: "#1a2d45",
  amber: "#f5a623",
  green: "#00e676",
  red: "#ff4444",
  blue: "#448aff",
  text: "#f0ebe0",
  muted: "#3a5570",
  mutedLight: "#6a8aaa",
};

export default function TradeChartModal({ trade, currency, onClose }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  // Determine granularity based on trade duration
  const durationMs = trade ? trade.closedAt - trade.openTime : 0;
  const granularity = durationMs < 2 * 60 * 60 * 1000 ? "M5"
    : durationMs < 12 * 60 * 60 * 1000 ? "M15"
    : durationMs < 3 * 24 * 60 * 60 * 1000 ? "H1"
    : "H4";

  const { data: candles, isLoading } = trpc.bot.getCandles.useQuery(
    { instrument: trade?.instrument ?? "", granularity, count: 150 },
    { enabled: !!trade, staleTime: 30000 }
  );

  useEffect(() => {
    if (!chartContainerRef.current || !candles || candles.length === 0 || !trade) return;

    const container = chartContainerRef.current;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a1628" },
        textColor: C.mutedLight,
      },
      grid: {
        vertLines: { color: "#1a2d4540" },
        horzLines: { color: "#1a2d4540" },
      },
      crosshair: {
        vertLine: { color: "#f5a62350", labelBackgroundColor: "#f5a623" },
        horzLine: { color: "#f5a62350", labelBackgroundColor: "#f5a623" },
      },
      rightPriceScale: {
        borderColor: C.border,
        textColor: C.mutedLight,
      },
      timeScale: {
        borderColor: C.border,
        timeVisible: true,
        secondsVisible: false,
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });
    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: C.green,
      downColor: C.red,
      borderUpColor: C.green,
      borderDownColor: C.red,
      wickUpColor: C.green + "99",
      wickDownColor: C.red + "99",
    });

    const candleData = candles.map((c: any) => ({
      time: Math.floor(new Date(c.time).getTime() / 1000) as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeries.setData(candleData);

    // Entry price line (amber)
    const entrySeries = chart.addSeries(LineSeries, {
      color: C.amber,
      lineWidth: 2,
      lineStyle: 0, // solid
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: `Entry ${trade.entryPrice.toFixed(5)}`,
    });
    entrySeries.setData(candleData.map((c: any) => ({ time: c.time, value: trade.entryPrice })));

    // Exit price line (blue)
    const exitSeries = chart.addSeries(LineSeries, {
      color: C.blue,
      lineWidth: 2,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: `Exit ${trade.exitPrice.toFixed(5)}`,
    });
    exitSeries.setData(candleData.map((c: any) => ({ time: c.time, value: trade.exitPrice })));

    // Stop loss line (red)
    if (trade.stopLoss > 0) {
      const slSeries = chart.addSeries(LineSeries, {
        color: C.red,
        lineWidth: 1,
        lineStyle: 3, // dotted
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: `SL ${trade.stopLoss.toFixed(5)}`,
      });
      slSeries.setData(candleData.map((c: any) => ({ time: c.time, value: trade.stopLoss })));
    }

    // Take profit line (green)
    if (trade.takeProfit > 0) {
      const tpSeries = chart.addSeries(LineSeries, {
        color: C.green,
        lineWidth: 1,
        lineStyle: 3, // dotted
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: `TP ${trade.takeProfit.toFixed(5)}`,
      });
      tpSeries.setData(candleData.map((c: any) => ({ time: c.time, value: trade.takeProfit })));
    }

    chart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (chartRef.current && container) {
        chartRef.current.applyOptions({ width: container.clientWidth });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, trade]);

  if (!trade) return null;

  const isJpy = trade.instrument.includes("JPY");
  const dp = isJpy ? 3 : 5;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col"
      style={{ background: "rgba(5, 12, 26, 0.97)", paddingTop: "env(safe-area-inset-top, 0px)" }}
      onClick={onClose}
    >
      <div className="flex flex-col h-full" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-3">
            <span className="text-xs font-black px-2.5 py-1 rounded-full"
              style={{
                background: trade.direction === "BUY" ? "#00e67615" : "#ff444415",
                color: trade.direction === "BUY" ? C.green : C.red,
                border: `1px solid ${trade.direction === "BUY" ? C.green : C.red}33`,
              }}>{trade.direction}</span>
            <span className="text-lg font-black">{trade.instrument.replace("_", "/")}</span>
            <span className="text-sm font-mono font-bold" style={{ color: trade.won ? C.green : C.red }}>
              {trade.won ? "+" : ""}{trade.pnl.toFixed(2)} {currency}
            </span>
          </div>
          <button onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{ background: C.s1, border: `1px solid ${C.border}` }}>
            <X className="w-5 h-5" style={{ color: C.text }} />
          </button>
        </div>

        {/* Price legend */}
        <div className="flex items-center gap-4 px-5 py-3 flex-wrap"
          style={{ borderBottom: `1px solid ${C.border}` }}>
          {[
            { label: "Entry", value: trade.entryPrice.toFixed(dp), color: C.amber },
            { label: "Exit", value: trade.exitPrice.toFixed(dp), color: C.blue },
            { label: "SL", value: trade.stopLoss > 0 ? trade.stopLoss.toFixed(dp) : "—", color: C.red },
            { label: "TP", value: trade.takeProfit > 0 ? trade.takeProfit.toFixed(dp) : "—", color: C.green },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 rounded" style={{ background: color }} />
              <span className="text-xs" style={{ color: C.muted }}>{label}</span>
              <span className="text-xs font-mono font-bold" style={{ color }}>{value}</span>
            </div>
          ))}
          <div className="ml-auto text-xs" style={{ color: C.muted }}>
            {granularity} · {new Date(trade.openTime).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
          </div>
        </div>

        {/* Chart */}
        <div className="flex-1 relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: C.amber, borderTopColor: "transparent" }} />
            </div>
          )}
          <div ref={chartContainerRef} className="w-full h-full" />
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-around px-5 py-4"
          style={{ borderTop: `1px solid ${C.border}` }}>
          {[
            { label: "Pips", value: `${trade.pips >= 0 ? "+" : ""}${trade.pips.toFixed(1)}` },
            { label: "Reason", value: trade.closeReason },
            { label: "Closed", value: new Date(trade.closedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-xs mb-0.5" style={{ color: C.muted }}>{label}</p>
              <p className="text-sm font-bold font-mono" style={{ color: C.text }}>{value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
