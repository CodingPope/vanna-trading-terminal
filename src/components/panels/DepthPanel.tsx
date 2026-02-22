import { useMemo } from 'react';
import { useMarket } from '@/store';
import type { OrderBookEntry } from '@/types';

interface DepthRow {
  level: number;
  bidPrice?: number;
  bidSize: number;
  askPrice?: number;
  askSize: number;
  imbalance: number;
}

function byBidPriceDesc(a: OrderBookEntry, b: OrderBookEntry): number {
  return b.price - a.price;
}

function byAskPriceAsc(a: OrderBookEntry, b: OrderBookEntry): number {
  return a.price - b.price;
}

export function DepthPanel({ symbol: propSymbol }: { symbol?: string }) {
  const { state, getOrderBook } = useMarket();
  const symbol = propSymbol ?? state.selectedSymbol;
  const book = getOrderBook(symbol);

  const { rows, maxSize, totalBid, totalAsk } = useMemo(() => {
    const bids = book.filter(b => b.side === 'bid').sort(byBidPriceDesc).slice(0, 15);
    const asks = book.filter(b => b.side === 'ask').sort(byAskPriceAsc).slice(0, 15);
    const depth = Math.max(bids.length, asks.length);
    const rows: DepthRow[] = Array.from({ length: depth }, (_, idx) => {
      const bid = bids[idx];
      const ask = asks[idx];
      const bidSize = bid?.size ?? 0;
      const askSize = ask?.size ?? 0;
      const denom = bidSize + askSize;
      const imbalance = denom ? (bidSize - askSize) / denom : 0;
      return {
        level: idx + 1,
        bidPrice: bid?.price,
        bidSize,
        askPrice: ask?.price,
        askSize,
        imbalance,
      };
    });

    const maxSize = Math.max(1, ...rows.flatMap(r => [r.bidSize, r.askSize]));
    const totalBid = rows.reduce((acc, r) => acc + r.bidSize, 0);
    const totalAsk = rows.reduce((acc, r) => acc + r.askSize, 0);
    return { rows, maxSize, totalBid, totalAsk };
  }, [book]);

  const overallImbalance = totalBid + totalAsk ? ((totalBid - totalAsk) / (totalBid + totalAsk)) * 100 : 0;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="header-caps">Depth</span>
        <span className="font-mono text-xs text-vanna-text">{symbol}</span>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-2 px-3 py-2 border-b border-white/5">
        <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">Imbalance</span>
        <span className={`font-mono text-xs ${overallImbalance >= 0 ? 'text-vanna-green' : 'text-vanna-red'}`}>
          {overallImbalance >= 0 ? '+' : ''}{overallImbalance.toFixed(2)}%
        </span>
      </div>

      <div className="grid grid-cols-[auto_auto_auto_auto_auto] gap-2 px-3 py-2 text-[10px] text-vanna-text-secondary uppercase tracking-wider border-b border-white/5">
        <span>Lvl</span>
        <span className="text-right">Bid</span>
        <span className="text-right">Bid Sz</span>
        <span className="text-right">Ask Sz</span>
        <span className="text-right">Ask</span>
      </div>

      <div className="flex-1 overflow-auto">
        {rows.map(row => {
          const bidPct = (row.bidSize / maxSize) * 100;
          const askPct = (row.askSize / maxSize) * 100;
          return (
            <div
              key={`depth-${row.level}`}
              className="relative grid grid-cols-[auto_auto_auto_auto_auto] gap-2 px-3 py-1.5 border-b border-white/5 overflow-hidden"
            >
              <div className="absolute inset-y-0 left-0 bg-vanna-green/10" style={{ width: `${bidPct * 0.5}%` }} />
              <div className="absolute inset-y-0 right-0 bg-vanna-red/10" style={{ width: `${askPct * 0.5}%` }} />

              <span className="relative font-mono text-[11px] text-vanna-text-secondary">{row.level}</span>
              <span className="relative font-mono text-[11px] text-vanna-green text-right">
                {row.bidPrice ? row.bidPrice.toFixed(2) : '-'}
              </span>
              <span className="relative font-mono text-[11px] text-vanna-text text-right">{row.bidSize || '-'}</span>
              <span className="relative font-mono text-[11px] text-vanna-text text-right">{row.askSize || '-'}</span>
              <span className="relative font-mono text-[11px] text-vanna-red text-right">
                {row.askPrice ? row.askPrice.toFixed(2) : '-'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-2 border-t border-white/5 text-[10px] text-vanna-text-secondary flex items-center justify-between">
        <span>Bid Depth: {totalBid.toLocaleString()}</span>
        <span>Ask Depth: {totalAsk.toLocaleString()}</span>
      </div>
    </div>
  );
}
