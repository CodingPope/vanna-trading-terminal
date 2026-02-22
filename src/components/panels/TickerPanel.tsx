import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMarket } from '@/store';
import type { MarketData } from '@/types';

type SortMode = 'symbol' | 'change' | 'volume';

function formatCompactVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return `${v}`;
}

export function TickerPanel() {
  const { state, setSelectedSymbol } = useMarket();
  const [sortMode, setSortMode] = useState<SortMode>('change');

  const rows = useMemo(() => {
    const items = Array.from(state.marketData.entries());
    if (sortMode === 'symbol') {
      items.sort((a, b) => a[0].localeCompare(b[0]));
    } else if (sortMode === 'change') {
      items.sort((a, b) => Math.abs(b[1].changePercent) - Math.abs(a[1].changePercent));
    } else {
      items.sort((a, b) => b[1].volume - a[1].volume);
    }
    return items;
  }, [sortMode, state.marketData]);

  const tape = rows.slice(0, 12);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="header-caps">Ticker</span>
        <div className="flex items-center gap-1">
          {(['change', 'volume', 'symbol'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              className={`px-2 py-0.5 text-[10px] rounded uppercase tracking-wider transition-colors
                ${sortMode === mode ? 'bg-vanna-cyan/20 text-vanna-cyan' : 'text-vanna-text-secondary hover:text-vanna-text hover:bg-white/5'}`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div className="px-2 py-2 border-b border-white/5 overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-1 min-w-max">
          {tape.map(([symbol, data]) => (
            <button
              key={`tape-${symbol}`}
              onClick={() => setSelectedSymbol(symbol)}
              className={`px-2 py-1 rounded border text-[10px] font-mono transition-colors
                ${state.selectedSymbol === symbol ? 'border-vanna-cyan/60 bg-vanna-cyan/10' : 'border-white/10 bg-white/5 hover:border-white/20'}`}
            >
              <span className="text-vanna-text">{symbol}</span>
              <span className={`ml-1 ${data.changePercent >= 0 ? 'text-vanna-green' : 'text-vanna-red'}`}>
                {data.changePercent >= 0 ? '+' : ''}{data.changePercent.toFixed(2)}%
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-[10px] text-vanna-text-secondary uppercase tracking-wider border-b border-white/5">
        <span>Symbol</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg%</span>
        <span className="text-right">Vol</span>
      </div>

      <div className="flex-1 overflow-auto">
        {rows.map(([symbol, data]) => (
          <TickerRow
            key={symbol}
            symbol={symbol}
            data={data}
            selected={state.selectedSymbol === symbol}
            onSelect={setSelectedSymbol}
          />
        ))}
      </div>
    </div>
  );
}

function TickerRow({
  symbol,
  data,
  selected,
  onSelect,
}: {
  symbol: string;
  data: MarketData;
  selected: boolean;
  onSelect: (symbol: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(symbol)}
      className={`w-full grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-1.5 border-b border-white/5 text-left hover:bg-white/5 transition-colors
        ${selected ? 'bg-vanna-cyan/10' : ''}`}
    >
      <span className="font-mono text-xs text-vanna-text">{symbol}</span>
      <span className="font-mono text-xs text-vanna-text text-right">{data.price.toFixed(2)}</span>
      <span className={`font-mono text-xs text-right flex items-center justify-end gap-1 ${data.changePercent >= 0 ? 'text-vanna-green' : 'text-vanna-red'}`}>
        {data.changePercent >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
        {Math.abs(data.changePercent).toFixed(2)}%
      </span>
      <span className="font-mono text-xs text-vanna-text-secondary text-right">
        {formatCompactVolume(data.volume)}
      </span>
    </button>
  );
}
