import { useMemo, useState } from 'react';
import { useAppSelector } from '@/store/hooks';
import { LightweightChart } from './LightweightChart';
import { aggregateCandles, isTimeframeUsable, TIMEFRAME_MINUTES, type Timeframe } from '@/lib/candles';
import { computeVWAP } from '@/lib/vwap';
import { useUIStore } from '@/store/uiStore';

export function ChartPanel({ symbol: propSymbol }: { symbol?: string }) {
  const selected = useAppSelector(s => s.market.selectedSymbol);
  const symbol = propSymbol ?? selected;
  return <InstrumentChart key={symbol} symbol={symbol} />;
}
const EMPTY: never[] = [];
function InstrumentChart({ symbol }: { symbol: string }) {
  const preferredTimeframe = useUIStore(s => s.settings.defaultTimeframe);
  const [timeframe, setTimeframe] = useState<Timeframe>(() => preferredTimeframe === '1d' ? '5m' : preferredTimeframe);
  const [chartType, setType] = useState<'candlestick' | 'line' | 'area'>('candlestick');
  const [showVolume, setVolume] = useState(true);
  const [anchorTs, setAnchor] = useState<number | null>(null);
  const quote = useAppSelector(s => s.market.entities[symbol]);
  const raw = useAppSelector(s => s.market.candlesticks[symbol] ?? EMPTY);
  const candles = useMemo(() => aggregateCandles(raw, TIMEFRAME_MINUTES[timeframe]), [raw, timeframe]);
  const vwap = useMemo(() => computeVWAP(candles).at(-1), [candles]);
  return <div className="h-full flex flex-col min-h-0">
    <div className="flex flex-wrap justify-between items-center gap-2 px-3 py-2 border-b border-white/10">
      <div><strong className="font-mono">{symbol}</strong><span className="font-mono ml-3">{quote?.price.toFixed(2)}</span></div>
      <div className="flex gap-1">{(['1m', '5m', '15m', '1h'] as const).map(tf => <button key={tf} className="desk-button !px-2" aria-pressed={timeframe === tf} disabled={!isTimeframeUsable(raw, tf)} onClick={() => setTimeframe(tf)}>{tf.toUpperCase()}</button>)}</div>
    </div>
    <div className="flex flex-wrap gap-1 px-2 py-1">{(['candlestick', 'line', 'area'] as const).map(t => <button key={t} aria-label={`${t[0].toUpperCase()}${t.slice(1)} chart`} aria-pressed={chartType === t} className="desk-button !py-1" onClick={() => setType(t)}>{t}</button>)}<button className="desk-button !py-1" aria-pressed={showVolume} onClick={() => setVolume(v => !v)}>Volume</button><button className="desk-button !py-1" disabled={anchorTs === null} onClick={() => setAnchor(null)}>Clear anchor</button></div>
    <div className="flex-1 min-h-40" role="img" aria-label={`${symbol} ${timeframe} ${chartType} chart. Last price ${quote?.price.toFixed(2)}. Loaded-window VWAP ${vwap?.toFixed(2) ?? 'unavailable'}.`}>
      <LightweightChart candlesticks={candles} chartType={chartType} showVolume={showVolume} anchorTs={anchorTs} onAnchor={setAnchor} />
    </div>
    <div className="px-3 py-1 text-[11px] text-vanna-text-secondary border-t border-white/10 flex flex-wrap justify-between gap-1"><span>Window VWAP {vwap?.toFixed(2) ?? '—'} · bar approximation</span><span>{anchorTs ? `Anchor ${new Date(anchorTs).toLocaleTimeString()}` : 'Click chart to anchor VWAP'} · times UTC</span></div>
  </div>;
}
