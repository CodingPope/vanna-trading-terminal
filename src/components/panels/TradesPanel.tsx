import { ArrowDown, ArrowUp } from 'lucide-react';
import { useAppSelector } from '@/store/hooks';
import { selectSelectedSymbol, selectTrades, selectTapeBias } from '@/store/selectors';
import type { RootState } from '@/store/store';

/**
 * Time & sales.
 *
 * Presentational only. This component used to generate the tape itself —
 * seeding 36 synthetic prints per symbol and inventing more on every price
 * tick with `Math.random()` — which meant the "trades" on screen were made up
 * by the component displaying them, and stayed made up when connected to a
 * real backend. Prints now come from whichever feed is running.
 */

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function TradesPanel({ symbol: propSymbol }: { symbol?: string }) {
  const selectedSymbol = useAppSelector(selectSelectedSymbol);
  const symbol = propSymbol ?? selectedSymbol;

  const trades = useAppSelector((s: RootState) => selectTrades(s, symbol));
  const { buyVol, sellVol } = useAppSelector((s: RootState) => selectTapeBias(s, symbol));

  const total = buyVol + sellVol;
  const buyPct = total ? (buyVol / total) * 100 : 50;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="header-caps">Trades</span>
        <span className="font-mono text-xs text-vanna-text">{symbol}</span>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-2 px-3 py-2 border-b border-white/5 items-center">
        <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">Tape Bias</span>
        <div
          className="h-2 rounded bg-vanna-red/40 overflow-hidden"
          title={`Buy ${buyVol.toLocaleString()} vs sell ${sellVol.toLocaleString()}`}
        >
          {/* Aggressor volume: who crossed the spread, not which way price went. */}
          <div className="h-full bg-vanna-green transition-[width] duration-300" style={{ width: `${buyPct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-[auto_auto_auto_auto] gap-2 px-3 py-2 text-[10px] text-vanna-text-secondary uppercase tracking-wider border-b border-white/5">
        <span>Time</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Side</span>
      </div>

      <div className="flex-1 overflow-auto">
        {trades.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-vanna-text-secondary">
            Waiting for prints…
          </p>
        ) : (
          trades.map((trade) => (
            <div
              key={trade.id}
              className="grid grid-cols-[auto_auto_auto_auto] gap-2 px-3 py-1.5 border-b border-white/5 hover:bg-white/5 transition-colors"
            >
              <span className="font-mono text-[11px] text-vanna-text-secondary">{fmtTime(trade.timestamp)}</span>
              <span className={`font-mono text-[11px] text-right ${trade.side === 'buy' ? 'text-vanna-green' : 'text-vanna-red'}`}>
                {trade.price.toFixed(2)}
              </span>
              <span className="font-mono text-[11px] text-vanna-text text-right">
                {trade.size.toLocaleString()}
              </span>
              <span className={`font-mono text-[11px] flex items-center justify-end gap-1 ${trade.side === 'buy' ? 'text-vanna-green' : 'text-vanna-red'}`}>
                {trade.side === 'buy' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                {trade.side.toUpperCase()}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="px-3 py-2 border-t border-white/5 text-[10px] text-vanna-text-secondary flex items-center justify-between">
        <span>Buy Vol: {buyVol.toLocaleString()}</span>
        <span>Sell Vol: {sellVol.toLocaleString()}</span>
      </div>
    </div>
  );
}
