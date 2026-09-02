import { useState, useEffect, useDeferredValue } from 'react';
import { useUI, TRADING_PHASES } from '@/store';
import { useAppSelector, useMarketActions } from '@/store/hooks';
import { selectCurrentPhase, selectFocusList, selectSelectedSymbol } from '@/store/selectors';
import {
  Star,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Search
} from 'lucide-react';

interface FocusListPanelProps {
  compact?: boolean;
}

export function FocusListPanel({ compact = false }: FocusListPanelProps) {
  const currentPhaseId = useAppSelector(selectCurrentPhase);
  const focusList = useAppSelector(selectFocusList);
  const selectedSymbol = useAppSelector(selectSelectedSymbol);
  const { setSelectedSymbol } = useMarketActions();
  const { state: uiState, addNotification } = useUI();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  // useDeferredValue defers the filter computation so typing stays responsive
  // even when the focus list is large or re-renders are expensive.
  const deferredQuery = useDeferredValue(searchQuery);

  const currentPhase = TRADING_PHASES.find(p => p.id === currentPhaseId);
  const maxItems = currentPhase?.maxFocusItems || 12;

  // Filter focus list: first by phase cap, then by deferred search query
  const filteredFocusList = focusList
    .slice(0, maxItems)
    .filter(item =>
      deferredQuery.length === 0 ||
      item.symbol.toLowerCase().includes(deferredQuery.toLowerCase()) ||
      item.name.toLowerCase().includes(deferredQuery.toLowerCase())
    );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (uiState.showCommandPalette || uiState.showKeyboardShortcuts) return;
      
      switch (e.key.toLowerCase()) {
        case 'j':
          e.preventDefault();
          setSelectedIndex(prev => {
            const newIndex = Math.min(prev + 1, filteredFocusList.length - 1);
            setSelectedSymbol(filteredFocusList[newIndex]?.symbol || '');
            return newIndex;
          });
          break;
        case 'k':
          e.preventDefault();
          setSelectedIndex(prev => {
            const newIndex = Math.max(prev - 1, 0);
            setSelectedSymbol(filteredFocusList[newIndex]?.symbol || '');
            return newIndex;
          });
          break;
        case ' ':
          e.preventDefault();
          addNotification({ type: 'info', message: `Staged ${filteredFocusList[selectedIndex]?.symbol}` });
          break;
        case 'a':
          e.preventDefault();
          addNotification({ type: 'success', message: `Alert set for ${filteredFocusList[selectedIndex]?.symbol}` });
          break;
        case 'd':
          e.preventDefault();
          addNotification({ type: 'warning', message: `Dismissed ${filteredFocusList[selectedIndex]?.symbol}` });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredFocusList, selectedIndex, setSelectedSymbol, uiState.showCommandPalette, uiState.showKeyboardShortcuts, addNotification]);

  const getQualityColor = (quality: number) => {
    if (quality >= 85) return 'text-vanna-green';
    if (quality >= 70) return 'text-vanna-gold';
    return 'text-vanna-text-secondary';
  };

  const getVerdictIcon = (verdict: string) => {
    switch (verdict) {
      case 'VALID':
        return <CheckCircle2 className="w-3.5 h-3.5 text-vanna-green" />;
      case 'NO_TRADE':
        return <TrendingDown className="w-3.5 h-3.5 text-vanna-red" />;
      case 'STANDBY':
        return <AlertTriangle className="w-3.5 h-3.5 text-vanna-gold" />;
      default:
        return null;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-vanna-cyan" />
          <span className="header-caps">Focus List</span>
          <span className="px-1.5 py-0.5 text-[10px] bg-vanna-cyan/20 text-vanna-cyan rounded">
            {filteredFocusList.length}/{maxItems}
          </span>
        </div>
        {!compact && (
          <div className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 text-[10px] bg-vanna-surface border border-white/10 rounded text-vanna-text-secondary">
              J
            </kbd>
            <kbd className="px-1.5 py-0.5 text-[10px] bg-vanna-surface border border-white/10 rounded text-vanna-text-secondary">
              K
            </kbd>
          </div>
        )}
      </div>

      {/* Search — useDeferredValue keeps typing snappy */}
      {!compact && (
        <div className="px-3 py-1.5 border-b border-white/5">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-vanna-surface border border-white/10">
            <Search className="w-3 h-3 text-vanna-text-secondary shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter symbols…"
              className="flex-1 bg-transparent text-xs text-vanna-text placeholder:text-vanna-text-secondary outline-none min-w-0"
              aria-label="Filter focus list"
            />
          </div>
        </div>
      )}

      {/* Phase info */}
      {!compact && (
        <div className="px-3 py-2 border-b border-white/5 bg-vanna-surface-light/30">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">
              {currentPhase?.name}
            </span>
            <span className="text-[10px] text-vanna-text-secondary">
              {currentPhase?.description}
            </span>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-auto">
        {/* Column headers */}
        <div className={`grid gap-2 px-3 py-2 text-[10px] text-vanna-text-secondary uppercase tracking-wider border-b border-white/5
          ${compact ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[auto_1fr_auto_auto_auto]'}`}>
          {!compact && <span>#</span>}
          <span>Symbol</span>
          {!compact && <span className="text-right">Quality</span>}
          <span className="text-right">Price</span>
          <span className="text-center">ANA</span>
        </div>

        {/* Focus items */}
        {filteredFocusList.map((item, index) => (
          <button
            key={item.symbol}
            onClick={() => {
              setSelectedIndex(index);
              setSelectedSymbol(item.symbol);
            }}
            className={`w-full grid gap-2 px-3 py-2 text-left transition-colors border-b border-white/5
              ${compact ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[auto_1fr_auto_auto_auto]'}
              ${selectedIndex === index ? 'bg-vanna-cyan/10' : 'hover:bg-white/5'}
              ${selectedSymbol === item.symbol ? 'border-l-2 border-l-vanna-cyan' : ''}`}
            aria-selected={selectedIndex === index}
            role="option"
          >
            {!compact && (
              <span className={`font-mono text-xs ${
                index < 3 ? 'text-vanna-gold' : 'text-vanna-text-secondary'
              }`}>
                {index + 1}
              </span>
            )}
            
            <div className="flex items-center gap-2">
              {index < 3 && !compact && (
                <Star className="w-3 h-3 text-vanna-gold fill-vanna-gold" />
              )}
              <span className="font-mono text-sm text-vanna-text">{item.symbol}</span>
              <span className="text-[9px] text-vanna-text-secondary hidden sm:inline">
                {item.sector}
              </span>
            </div>
            
            {!compact && (
              <span className={`font-mono text-xs text-right ${getQualityColor(item.setupQuality)}`}>
                {item.setupQuality}
              </span>
            )}
            
            <div className={`flex items-center justify-end gap-1 font-mono text-sm
              ${item.marketData.changePercent >= 0 ? 'text-vanna-green' : 'text-vanna-red'}`}>
              {item.marketData.changePercent >= 0 ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {item.marketData.price.toFixed(2)}
            </div>
            
            <div className="flex justify-center">
              {getVerdictIcon(item.anaAnalysis.verdict)}
            </div>
          </button>
        ))}
      </div>

      {/* Keyboard shortcuts hint */}
      {!compact && (
        <div className="px-3 py-2 border-t border-white/5 bg-vanna-surface-light/20">
          <div className="flex items-center justify-between text-[10px] text-vanna-text-secondary">
            <div className="flex items-center gap-3">
              <span><kbd className="px-1 bg-vanna-surface rounded">Space</kbd> Stage</span>
              <span><kbd className="px-1 bg-vanna-surface rounded">A</kbd> Alert</span>
              <span><kbd className="px-1 bg-vanna-surface rounded">D</kbd> Dismiss</span>
            </div>
            <span><kbd className="px-1 bg-vanna-surface rounded">?</kbd> Help</span>
          </div>
        </div>
      )}
    </div>
  );
}
