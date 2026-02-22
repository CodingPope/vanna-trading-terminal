import { useState, memo } from 'react';
import { useSelector } from 'react-redux';
import { ArrowUp, ArrowDown, Plus, MoreHorizontal } from 'lucide-react';
import { selectPositions, selectUnrealizedPnL } from '@/store/selectors';
import type { Position } from '@/types';

// Memoized row — only re-renders when the position data changes
const PositionRow = memo(function PositionRow({
  position,
  compact,
}: {
  position: Position;
  compact: boolean;
}) {
  return (
    <div
      className={`grid gap-2 px-3 py-2 hover:bg-white/5 transition-colors border-b border-white/5
        ${compact ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto_auto_auto_auto]'}`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${position.side === 'long' ? 'bg-vanna-green' : 'bg-vanna-red'}`} />
        <span className="font-mono text-sm text-vanna-text">{position.symbol}</span>
        <span className={`text-[10px] uppercase ${position.side === 'long' ? 'text-vanna-green' : 'text-vanna-red'}`}>
          {position.side}
        </span>
      </div>
      <span className="font-mono text-sm text-vanna-text text-right">{position.size}</span>
      {!compact && (
        <span className="font-mono text-sm text-vanna-text-secondary text-right">
          {position.entryPrice.toFixed(2)}
        </span>
      )}
      {!compact && (
        <span className="font-mono text-sm text-vanna-text text-right">
          {position.currentPrice.toFixed(2)}
        </span>
      )}
      <div className={`flex items-center justify-end gap-1 font-mono text-sm
        ${position.pnl >= 0 ? 'text-vanna-green' : 'text-vanna-red'}`}>
        {position.pnl >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
        ${Math.abs(position.pnl).toFixed(0)}
      </div>
    </div>
  );
});

interface PositionsPanelProps {
  compact?: boolean;
}

export function PositionsPanel({ compact = false }: PositionsPanelProps) {
  const [activeTab, setActiveTab] = useState<'positions' | 'orders' | 'history'>('positions');

  // Read from RTK store
  const positions = useSelector(selectPositions);
  const totalPnl = useSelector(selectUnrealizedPnL);
  const totalPnlPercent = positions.length > 0
    ? positions.reduce((acc, p) => acc + p.pnlPercent, 0) / positions.length
    : 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-3">
          <span className="header-caps">Positions</span>
          {!compact && (
            <div className="flex items-center gap-0.5">
              {(['positions', 'orders', 'history'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-wider rounded transition-colors
                    ${activeTab === tab 
                      ? 'bg-vanna-cyan/20 text-vanna-cyan' 
                      : 'text-vanna-text-secondary hover:text-vanna-text hover:bg-white/5'}`}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button 
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            aria-label="New order"
          >
            <Plus className="w-3.5 h-3.5 text-vanna-text-secondary" />
          </button>
          <button 
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            aria-label="More options"
          >
            <MoreHorizontal className="w-3.5 h-3.5 text-vanna-text-secondary" />
          </button>
        </div>
      </div>

      {/* P&L Summary */}
      {!compact && (
        <div className="px-3 py-3 border-b border-white/5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">Total P&L</span>
              <div className="flex items-center gap-2">
                <span className={`font-mono text-xl font-semibold ${totalPnl >= 0 ? 'text-vanna-green' : 'text-vanna-red'}`}>
                  {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                </span>
                <span className={`font-mono text-sm ${totalPnlPercent >= 0 ? 'text-vanna-green' : 'text-vanna-red'}`}>
                  {totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">Open Positions</span>
              <p className="font-mono text-lg text-vanna-text">{positions.length}</p>
            </div>
          </div>
        </div>
      )}

      {/* Positions list */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'positions' && (
          <>
            {/* Column headers */}
            <div className={`grid gap-2 px-3 py-2 text-[10px] text-vanna-text-secondary uppercase tracking-wider border-b border-white/5
              ${compact ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto_auto_auto_auto]'}`}>
              <span>Symbol</span>
              <span className="text-right">Size</span>
              {!compact && <span className="text-right">Entry</span>}
              {!compact && <span className="text-right">Current</span>}
              <span className="text-right">P&L</span>
            </div>

            {/* Position rows */}
            {positions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-vanna-text-secondary">
                <p className="text-sm">No open positions</p>
                <p className="text-xs mt-1">Positions will appear here when connected</p>
              </div>
            ) : (
              positions.map((position) => (
                <PositionRow
                  key={`${position.symbol}-${position.side}`}
                  position={position}
                  compact={compact}
                />
              ))
            )}
          </>
        )}

        {activeTab === 'orders' && (
          <div className="flex flex-col items-center justify-center h-full text-vanna-text-secondary">
            <p className="text-sm">No open orders</p>
            <p className="text-xs mt-1">Orders will appear here</p>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="flex flex-col items-center justify-center h-full text-vanna-text-secondary">
            <p className="text-sm">No recent history</p>
            <p className="text-xs mt-1">Trade history will appear here</p>
          </div>
        )}
      </div>

      {/* Footer actions */}
      {activeTab === 'positions' && positions.length > 0 && (
        <div className="px-3 py-2 border-t border-white/5 flex items-center justify-between">
          <button className="px-3 py-1.5 text-xs text-vanna-red border border-vanna-red/30 rounded hover:bg-vanna-red/10 transition-colors">
            Close All
          </button>
          <button className="px-3 py-1.5 text-xs text-vanna-cyan border border-vanna-cyan/30 rounded hover:bg-vanna-cyan/10 transition-colors">
            Hedge
          </button>
        </div>
      )}
    </div>
  );
}
