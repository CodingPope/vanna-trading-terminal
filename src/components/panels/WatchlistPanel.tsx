import { useState, useMemo, memo } from 'react';
import { useAppSelector, useMarketActions } from '@/store/hooks';
import { selectMarketDataMap, selectSelectedSymbol, selectLastUpdate, selectLiveSymbols } from '@/store/selectors';
import { ArrowUp, ArrowDown, Star } from 'lucide-react';
import type { MarketData } from '@/types';

// Memoized row — only re-renders when its own data, liveness, or selection changes
const WatchlistRow = memo(function WatchlistRow({
  symbol,
  data,
  isLive,
  isSelected,
  onSelect,
}: {
  symbol: string;
  data: MarketData;
  isLive: boolean;
  isSelected: boolean;
  onSelect: (s: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(symbol)}
      className={`w-full grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2
                 hover:bg-white/5 transition-colors text-left
                 ${isSelected ? 'bg-vanna-cyan/10' : ''} ${isLive ? '' : 'opacity-50'}`}
      aria-selected={isSelected}
      role="option"
    >
      <div className="flex items-center gap-2">
        <Star className="w-3 h-3 text-vanna-text-secondary/50 hover:text-vanna-gold cursor-pointer" />
        <span className="font-mono text-sm text-vanna-text">{symbol}</span>
        {/* Text, not just dimming: opacity alone isn't perceivable to a screen
            reader, and a frozen seed price sitting next to a real one without
            a label reads as a live quote until proven otherwise. */}
        {!isLive && <span className="text-[9px] uppercase tracking-wider text-vanna-text-secondary/70">no live data</span>}
      </div>
      <span className="font-mono text-sm text-vanna-text text-right">{isLive ? data.price.toFixed(2) : '—'}</span>
      <div className={`flex items-center justify-end gap-0.5 font-mono text-sm
        ${!isLive ? 'text-vanna-text-secondary' : data.changePercent >= 0 ? 'text-vanna-green' : 'text-vanna-red'}`}>
        {isLive && (data.changePercent >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
        {isLive ? `${Math.abs(data.changePercent).toFixed(2)}%` : '—'}
      </div>
      <span className="font-mono text-xs text-vanna-text-secondary text-right">
        {isLive ? `${(data.volume / 1_000_000).toFixed(1)}M` : '—'}
      </span>
    </button>
  );
});

interface WatchlistPanelProps {
  onSelectSymbol?: (symbol: string) => void;
}

export function WatchlistPanel({ onSelectSymbol }: WatchlistPanelProps) {
  const marketData = useAppSelector(selectMarketDataMap);
  const liveSymbols = useAppSelector(selectLiveSymbols);
  const selectedSymbol = useAppSelector(selectSelectedSymbol);
  const lastUpdate = useAppSelector(selectLastUpdate);
  const { setSelectedSymbol } = useMarketActions();
  const [filter, setFilter] = useState<'all' | 'gainers' | 'losers' | 'volume'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const symbols = useMemo(() => {
    let data = Array.from(marketData.entries());

    // Apply filter
    switch (filter) {
      case 'gainers':
        // Ranking by a frozen seed's change% would claim a symbol is "up
        // today" when it has never received a real quote this session.
        data = data.filter(([symbol, data]) => liveSymbols[symbol] && data.changePercent > 0);
        data.sort((a, b) => b[1].changePercent - a[1].changePercent);
        break;
      case 'losers':
        data = data.filter(([symbol, data]) => liveSymbols[symbol] && data.changePercent < 0);
        data.sort((a, b) => a[1].changePercent - b[1].changePercent);
        break;
      case 'volume':
        data = data.filter(([symbol]) => liveSymbols[symbol]);
        data.sort((a, b) => b[1].volume - a[1].volume);
        break;
      default:
        // Sort by symbol
        data.sort((a, b) => a[0].localeCompare(b[0]));
    }

    // Apply search
    if (searchTerm) {
      data = data.filter(([symbol]) =>
        symbol.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    return data;
  }, [marketData, liveSymbols, filter, searchTerm]);

  const liveCount = useMemo(
    () => symbols.reduce((count, [symbol]) => count + (liveSymbols[symbol] ? 1 : 0), 0),
    [symbols, liveSymbols],
  );

  const handleSelect = (symbol: string) => {
    setSelectedSymbol(symbol);
    onSelectSymbol?.(symbol);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="px-3 py-2">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter symbols..."
          className="w-full bg-vanna-surface-light/50 border border-white/5 rounded px-2 py-1 
                     text-xs text-vanna-text placeholder:text-vanna-text-secondary/50
                     focus:outline-none focus:border-vanna-cyan/30"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex px-3 gap-1 border-b border-white/5 pb-2">
        {(['all', 'gainers', 'losers', 'volume'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded transition-colors
              ${filter === f 
                ? 'bg-vanna-cyan/20 text-vanna-cyan' 
                : 'text-vanna-text-secondary hover:text-vanna-text hover:bg-white/5'}`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-[10px] text-vanna-text-secondary uppercase tracking-wider border-b border-white/5">
          <span>Symbol</span>
          <span className="text-right">Price</span>
          <span className="text-right">Chg%</span>
          <span className="text-right">Vol</span>
        </div>
        
        {symbols.map(([symbol, data]) => (
          <WatchlistRow
            key={symbol}
            symbol={symbol}
            data={data}
            isLive={!!liveSymbols[symbol]}
            isSelected={selectedSymbol === symbol}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/5 text-[10px] text-vanna-text-secondary">
        {symbols.length} symbols ({liveCount} live) • Last update: {new Date(lastUpdate).toLocaleTimeString()}
      </div>
    </div>
  );
}
