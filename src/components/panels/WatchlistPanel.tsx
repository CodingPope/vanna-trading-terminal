import { useState, useMemo, memo } from 'react';
import { useMarket } from '@/store';
import { ArrowUp, ArrowDown, Star, MoreHorizontal, Filter } from 'lucide-react';
import type { MarketData } from '@/types';

// Memoized row — only re-renders when its own data or selection changes
const WatchlistRow = memo(function WatchlistRow({
  symbol,
  data,
  isSelected,
  onSelect,
}: {
  symbol: string;
  data: MarketData;
  isSelected: boolean;
  onSelect: (s: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(symbol)}
      className={`w-full grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2
                 hover:bg-white/5 transition-colors text-left
                 ${isSelected ? 'bg-vanna-cyan/10' : ''}`}
      aria-selected={isSelected}
      role="option"
    >
      <div className="flex items-center gap-2">
        <Star className="w-3 h-3 text-vanna-text-secondary/50 hover:text-vanna-gold cursor-pointer" />
        <span className="font-mono text-sm text-vanna-text">{symbol}</span>
      </div>
      <span className="font-mono text-sm text-vanna-text text-right">{data.price.toFixed(2)}</span>
      <div className={`flex items-center justify-end gap-0.5 font-mono text-sm
        ${data.changePercent >= 0 ? 'text-vanna-green' : 'text-vanna-red'}`}>
        {data.changePercent >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
        {Math.abs(data.changePercent).toFixed(2)}%
      </div>
      <span className="font-mono text-xs text-vanna-text-secondary text-right">
        {(data.volume / 1_000_000).toFixed(1)}M
      </span>
    </button>
  );
});

interface WatchlistPanelProps {
  onSelectSymbol?: (symbol: string) => void;
}

export function WatchlistPanel({ onSelectSymbol }: WatchlistPanelProps) {
  const { state, setSelectedSymbol } = useMarket();
  const [filter, setFilter] = useState<'all' | 'gainers' | 'losers' | 'volume'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const symbols = useMemo(() => {
    let data = Array.from(state.marketData.entries());
    
    // Apply filter
    switch (filter) {
      case 'gainers':
        data = data.filter(([, data]) => data.changePercent > 0);
        data.sort((a, b) => b[1].changePercent - a[1].changePercent);
        break;
      case 'losers':
        data = data.filter(([, data]) => data.changePercent < 0);
        data.sort((a, b) => a[1].changePercent - b[1].changePercent);
        break;
      case 'volume':
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
  }, [state.marketData, filter, searchTerm]);

  const handleSelect = (symbol: string) => {
    setSelectedSymbol(symbol);
    onSelectSymbol?.(symbol);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="header-caps">Watchlist</span>
        <div className="flex items-center gap-1">
          <button 
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            aria-label="Filter"
          >
            <Filter className="w-3.5 h-3.5 text-vanna-text-secondary" />
          </button>
          <button 
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            aria-label="More options"
          >
            <MoreHorizontal className="w-3.5 h-3.5 text-vanna-text-secondary" />
          </button>
        </div>
      </div>

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
            isSelected={state.selectedSymbol === symbol}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/5 text-[10px] text-vanna-text-secondary">
        {symbols.length} symbols • Last update: {new Date(state.lastUpdate).toLocaleTimeString()}
      </div>
    </div>
  );
}
