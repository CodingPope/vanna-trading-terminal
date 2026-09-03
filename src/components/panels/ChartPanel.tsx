import { useState, useMemo } from 'react';
import { useAppSelector, useMarketActions } from '@/store/hooks';
import { selectSelectedSymbol, selectMarketData, selectCandlesticks } from '@/store/selectors';
import type { RootState } from '@/store/store';
import { LightweightChart } from './LightweightChart';
import {
  aggregateCandles,
  isTimeframeUsable,
  TIMEFRAME_MINUTES,
  type Timeframe,
} from '@/lib/candles';
import {
  BarChart3,
  CandlestickChart,
  LineChart,
  Maximize2,
  Minimize2,
  Settings,
  MoreHorizontal,
  Zap,
} from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  Customized,
  ReferenceLine,
} from 'recharts';

interface ChartPanelProps {
  symbol?: string;
}

type ChartType = 'candlestick' | 'line' | 'area';

interface ChartDatum {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  vwap?: number;
  anchoredVwap?: number;
}

// Recharts injects its internal axis maps into <Customized component={...} />.
// Only the pieces used below are typed.
type AxisScale = ((value: number | string) => number) & { bandwidth?: () => number };

interface RechartsAxis {
  scale?: AxisScale;
  bandSize?: number;
}

interface CustomizedProps {
  xAxisMap?: Record<string, RechartsAxis>;
  yAxisMap?: Record<string, RechartsAxis>;
  data?: ChartDatum[];
  width?: number;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
}) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  return (
    <div className="glass-panel p-2 text-xs">
      <p className="text-vanna-text-secondary mb-1">{data.time}</p>
      <div className="space-y-0.5 font-mono">
        <p className="text-vanna-text">O: {data.open.toFixed(2)}</p>
        <p className="text-vanna-text">H: {data.high.toFixed(2)}</p>
        <p className="text-vanna-text">L: {data.low.toFixed(2)}</p>
        <p className={`${data.close >= data.open ? 'text-vanna-green' : 'text-vanna-red'}`}>
          C: {data.close.toFixed(2)}
        </p>
        <p className="text-vanna-text-secondary">V: {(data.volume / 1000).toFixed(0)}K</p>
      </div>
    </div>
  );
}

// Custom candlestick renderer using Recharts Customized
function CandleLayer({ xAxisMap, yAxisMap, data }: CustomizedProps) {
  if (!data || !xAxisMap || !yAxisMap) return null;
  const xAxis = xAxisMap[Object.keys(xAxisMap)[0]];
  const yAxis = yAxisMap['price'] || yAxisMap[Object.keys(yAxisMap)[0]];
  const xScale = xAxis?.scale;
  const yScale = yAxis?.scale;
  if (!xScale || !yScale) return null;

  const band = typeof xScale.bandwidth === 'function' ? xScale.bandwidth() : (xAxis.bandSize || 8);
  const candleWidth = Math.min(18, band * 0.7 || 10);

  return (
    <g>
      {data.map((d, idx) => {
        const cx = xScale(d.time) + (band ? band / 2 : 0);
        const yOpen = yScale(d.open);
        const yClose = yScale(d.close);
        const yHigh = yScale(d.high);
        const yLow = yScale(d.low);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyHeight = Math.max(Math.abs(yOpen - yClose), 1);
        const isUp = d.close >= d.open;
        const bodyColor = isUp ? '#18f3c8' : '#f25f5c';

        return (
          <g key={idx}>
            {/* wick */}
            <line
              x1={cx}
              x2={cx}
              y1={yHigh}
              y2={yLow}
              stroke={bodyColor}
              strokeWidth={1}
              opacity={0.9}
            />
            {/* body */}
            <rect
              x={cx - candleWidth / 2}
              y={bodyTop}
              width={candleWidth}
              height={bodyHeight}
              fill={bodyColor}
              opacity={0.9}
              rx={1}
            />
          </g>
        );
      })}
    </g>
  );
}

function VolumeProfileLayer({
  yAxisMap,
  width,
  profile,
}: CustomizedProps & { profile: Array<{ y: number; vol: number; pct: number }> }) {
  const yAxis = yAxisMap?.['price'] || Object.values(yAxisMap || {})[0];
  const yScale = yAxis?.scale;
  if (!yScale) return null;
  const railX = (width || 0) - 50;
  return (
    <g>
      {profile.map((b, idx) => {
        const y = yScale(b.y);
        const nextY = yScale(b.y + ((profile[1]?.y ?? b.y) - b.y)) || y + 10;
        const barHeight = Math.abs(nextY - y) || 8;
        const barWidth = 40 * b.pct;
        return (
          <rect
            key={idx}
            x={railX}
            y={y - barHeight / 2}
            width={barWidth}
            height={barHeight * 0.8}
            fill="url(#colorVolume)"
            opacity={0.4}
            rx={2}
          />
        );
      })}
    </g>
  );
}

export function ChartPanel({ symbol: propSymbol }: ChartPanelProps) {
  const selectedSymbol = useAppSelector(selectSelectedSymbol);
  const { addAlert } = useMarketActions();
  const symbol = propSymbol || selectedSymbol;
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [timeframe, setTimeframe] = useState<Timeframe>('5m');
  const [showVolume, setShowVolume] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [anchorTs, setAnchorTs] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; price: number; time: string; ts: number } | null>(null);
  const [useLightweight, setUseLightweight] = useState(true); // TradingView by default

  const marketData = useAppSelector((s: RootState) => selectMarketData(s, symbol));
  const rawCandles = useAppSelector((s: RootState) => selectCandlesticks(s, symbol));

  // The feed publishes one-minute bars; every other timeframe is rolled up
  // from them here. Before this the timeframe buttons set state nothing read.
  const candlesticks = useMemo(
    () => aggregateCandles(rawCandles, TIMEFRAME_MINUTES[timeframe]),
    [rawCandles, timeframe],
  );

  const chartData = useMemo(() => {
    return candlesticks.map(candle => ({
      time: new Date(candle.time).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      }),
      timestamp: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      change: ((candle.close - candle.open) / candle.open) * 100,
    }));
  }, [candlesticks]);

  const currentPrice = marketData?.price || 0;
  const priceChange = marketData?.changePercent || 0;

  // VWAP & anchored VWAP
  const chartDataWithVWAP = useMemo(() => {
    let anchorIndex = 0;
    if (anchorTs) {
      anchorIndex = chartData.findIndex(d => d.timestamp >= anchorTs);
      if (anchorIndex < 0) anchorIndex = 0;
    }

    const out: ChartDatum[] = [];
    let cumPV = 0;
    let cumVol = 0;
    let anchoredPV = 0;
    let anchoredVol = 0;

    for (let idx = 0; idx < chartData.length; idx++) {
      const d = chartData[idx];
      if (idx < anchorIndex) {
        out.push({ ...d, vwap: undefined, anchoredVwap: undefined });
        continue;
      }
      const typical = (d.high + d.low + d.close) / 3;
      cumPV += typical * d.volume;
      cumVol += d.volume;
      anchoredPV += typical * d.volume;
      anchoredVol += d.volume;
      out.push({
        ...d,
        vwap: cumVol ? cumPV / cumVol : d.close,
        anchoredVwap: anchoredVol ? anchoredPV / anchoredVol : d.close,
      });
    }
    return out;
  }, [chartData, anchorTs]);

  // Volume profile (simple binned)
  const volumeProfile = useMemo(() => {
    if (!chartData.length) return [];
    const highs = chartData.map(d => d.high);
    const lows = chartData.map(d => d.low);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const buckets = 12;
    const step = (max - min) / buckets || 1;
    const bins = Array.from({ length: buckets }, (_, i) => ({
      y: min + i * step,
      vol: 0,
    }));
    chartData.forEach(d => {
      const idx = Math.min(buckets - 1, Math.max(0, Math.floor((d.close - min) / step)));
      bins[idx].vol += d.volume;
    });
    const maxVol = Math.max(...bins.map(b => b.vol), 1);
    return bins.map(b => ({ ...b, pct: b.vol / maxVol }));
  }, [chartData]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div>
            <span className="font-mono text-lg font-semibold text-vanna-text">{symbol}</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-vanna-text">{currentPrice.toFixed(2)}</span>
              <span className={`font-mono text-xs ${priceChange >= 0 ? 'text-vanna-green' : 'text-vanna-red'}`}>
                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
              </span>
            </div>
          </div>
          
          {/* Timeframe selector */}
          <div className="flex items-center gap-0.5 ml-4">
            {(['1m', '5m', '15m', '1h', '1d', '1w'] as Timeframe[]).map((tf) => {
              // One session of one-minute bars cannot make a daily chart. A
              // disabled control that says why beats an enabled one that
              // renders four rectangles.
              const usable = isTimeframeUsable(rawCandles, tf);
              return (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  disabled={!usable}
                  title={usable ? undefined : `Not enough history loaded for ${tf.toUpperCase()}`}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded transition-colors
                    ${!usable
                      ? 'text-vanna-text-secondary/30 cursor-not-allowed'
                      : timeframe === tf
                        ? 'bg-vanna-cyan/20 text-vanna-cyan'
                        : 'text-vanna-text-secondary hover:text-vanna-text hover:bg-white/5'}`}
                >
                  {tf.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Chart type buttons */}
          <div className="flex items-center gap-0.5 mr-2">
            <button
              onClick={() => setChartType('candlestick')}
              className={`p-1.5 rounded transition-colors ${chartType === 'candlestick' ? 'bg-vanna-cyan/20 text-vanna-cyan' : 'text-vanna-text-secondary hover:text-vanna-text'}`}
              aria-label="Candlestick chart"
            >
              <CandlestickChart className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`p-1.5 rounded transition-colors ${chartType === 'line' ? 'bg-vanna-cyan/20 text-vanna-cyan' : 'text-vanna-text-secondary hover:text-vanna-text'}`}
              aria-label="Line chart"
            >
              <LineChart className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType('area')}
              className={`p-1.5 rounded transition-colors ${chartType === 'area' ? 'bg-vanna-cyan/20 text-vanna-cyan' : 'text-vanna-text-secondary hover:text-vanna-text'}`}
              aria-label="Area chart"
            >
              <BarChart3 className="w-4 h-4" />
            </button>
          </div>

          {/* TradingView Lightweight Charts toggle */}
          <button
            onClick={() => setUseLightweight(v => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors
              ${useLightweight ? 'bg-vanna-gold/20 text-vanna-gold' : 'text-vanna-text-secondary hover:bg-white/5'}`}
            aria-label="Toggle TradingView Lightweight Charts"
            title={useLightweight ? 'Switch to Recharts' : 'Switch to TradingView Lightweight Charts'}
          >
            <Zap className="w-3 h-3" />
            {useLightweight ? 'TV' : 'RC'}
          </button>

          <button
            onClick={() => setShowVolume(!showVolume)}
            className={`p-1.5 rounded transition-colors ${showVolume ? 'text-vanna-cyan' : 'text-vanna-text-secondary'}`}
            aria-label="Toggle volume"
          >
            <span className="text-[10px] font-mono">VOL</span>
          </button>
          
          <button
            onClick={() => setAnchorTs(hover?.ts ?? candlesticks[0]?.time ?? null)}
            className="p-1.5 rounded hover:bg-white/5 transition-colors text-[10px] font-mono text-vanna-text-secondary"
            aria-label="Anchor VWAP"
          >
            ANCHOR
          </button>
          <button
            onClick={() => {
              const price = hover?.price || currentPrice;
              addAlert({ symbol, price, note: 'Chart alert' });
            }}
            className="p-1.5 rounded hover:bg-white/5 transition-colors text-[10px] font-mono text-vanna-text-secondary"
            aria-label="Create price alert"
          >
            ALERT @ {hover ? hover.price.toFixed(2) : currentPrice.toFixed(2)}
          </button>
          
          <button 
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4 text-vanna-text-secondary" />
          </button>
          
          <button 
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            aria-label={isMaximized ? 'Minimize' : 'Maximize'}
          >
            {isMaximized ? (
              <Minimize2 className="w-4 h-4 text-vanna-text-secondary" />
            ) : (
              <Maximize2 className="w-4 h-4 text-vanna-text-secondary" />
            )}
          </button>
          
          <button 
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            aria-label="More options"
          >
            <MoreHorizontal className="w-4 h-4 text-vanna-text-secondary" />
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 p-2">
        {useLightweight ? (
          <LightweightChart
            candlesticks={candlesticks}
            marketData={marketData}
            showVolume={showVolume}
            anchorTs={anchorTs}
            onAnchor={setAnchorTs}
          />
        ) : null}
        {!useLightweight && <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartDataWithVWAP}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            onMouseMove={(e) => {
              if (e && e.activePayload && e.activeCoordinate && e.activePayload[0]) {
                const d = e.activePayload[0].payload;
                setHover({
                  x: e.activeCoordinate.x,
                  y: e.activeCoordinate.y,
                  price: d.close,
                  time: d.time,
                  ts: d.timestamp,
                });
              }
            }}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00ffcc" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00ffcc" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#606080" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#606080" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />

            <XAxis
              dataKey="time"
              stroke="#606080"
              tick={{ fill: '#606080', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              tickLine={false}
              axisLine={false}
              minTickGap={30}
            />

            <YAxis
              yAxisId="price"
              orientation="right"
              stroke="#606080"
              tick={{ fill: '#606080', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              tickLine={false}
              axisLine={false}
              domain={['auto', 'auto']}
              tickFormatter={(value: number) => value.toFixed(2)}
            />

            {showVolume && (
              <YAxis
                yAxisId="volume"
                orientation="left"
                stroke="#606080"
                tick={{ fill: '#606080', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                axisLine={false}
                domain={[0, 'auto']}
                hide
              />
            )}

            <Tooltip content={<CustomTooltip />} />

            {hover && <ReferenceLine x={hover.time} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" />}

            {chartType === 'area' && (
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="close"
                stroke="#00ffcc"
                strokeWidth={1.5}
                dot={false}
                fillOpacity={1}
                fill="url(#colorPrice)"
              />
            )}

            {chartType === 'line' && (
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="close"
                stroke="#00ffcc"
                strokeWidth={1.5}
                dot={false}
              />
            )}

            {chartType === 'candlestick' && <Customized component={<CandleLayer />} />}

            {/* VWAP lines */}
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="vwap"
              stroke="#7dd3fc"
              strokeWidth={1.2}
              dot={false}
              opacity={0.8}
              isAnimationActive={false}
            />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="anchoredVwap"
              stroke="#f97316"
              strokeWidth={1.2}
              dot={false}
              opacity={0.8}
              isAnimationActive={false}
            />

            {showVolume && (
              <Bar yAxisId="volume" dataKey="volume" fill="url(#colorVolume)" opacity={0.3} />
            )}

            {/* Volume profile (right rail) */}
            <Customized component={<VolumeProfileLayer profile={volumeProfile} />} />
          </ComposedChart>
        </ResponsiveContainer>}
      </div>

      {/* Footer info */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/5 text-[10px] text-vanna-text-secondary font-mono">
        <div className="flex items-center gap-3">
          <span>{hover ? hover.time : (chartDataWithVWAP[chartDataWithVWAP.length - 1]?.time || '')}</span>
          <span>O: {(hover ? hover.price : marketData?.open)?.toFixed(2)}</span>
          <span>H: {marketData?.high.toFixed(2)}</span>
          <span>L: {marketData?.low.toFixed(2)}</span>
          <span>C: {(hover ? hover.price : marketData?.close)?.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span>VWAP: {chartDataWithVWAP[chartDataWithVWAP.length - 1]?.vwap?.toFixed(2)}</span>
          <span>Anch: {chartDataWithVWAP[chartDataWithVWAP.length - 1]?.anchoredVwap?.toFixed(2)}</span>
          <span>Vol: {((marketData?.volume || 0) / 1000000).toFixed(2)}M</span>
          <span>Spread: {((marketData?.ask || 0) - (marketData?.bid || 0)).toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
