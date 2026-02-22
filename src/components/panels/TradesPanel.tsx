import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMarket } from '@/store';

interface TradePrint {
  id: string;
  ts: number;
  price: number;
  size: number;
  side: 'buy' | 'sell';
}

const MAX_TRADES = 140;

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function randomLot(): number {
  const baseLots = [25, 50, 75, 100, 150, 200, 300, 500];
  return baseLots[Math.floor(Math.random() * baseLots.length)] ?? 100;
}

export function TradesPanel({ symbol: propSymbol }: { symbol?: string }) {
  const { state, getMarketData } = useMarket();
  const symbol = propSymbol ?? state.selectedSymbol;
  const marketData = getMarketData(symbol);
  const [trades, setTrades] = useState<TradePrint[]>([]);
  const prevPriceRef = useRef<number | null>(null);

  useEffect(() => {
    const base = marketData?.price ?? 100;
    const now = Date.now();
    const seeded = Array.from({ length: 36 }, (_, i) => {
      const skew = (Math.random() - 0.5) * 0.08;
      const price = Number((base + skew).toFixed(2));
      const side: TradePrint['side'] = skew >= 0 ? 'buy' : 'sell';
      return {
        id: `${symbol}-seed-${i}-${now}`,
        ts: now - i * 900,
        price,
        size: randomLot(),
        side,
      };
    });
    setTrades(seeded);
    prevPriceRef.current = base;
  }, [symbol, marketData?.price]);

  useEffect(() => {
    if (!marketData) return;

    const prev = prevPriceRef.current ?? marketData.price;
    const delta = marketData.price - prev;
    const side: TradePrint['side'] = delta >= 0 ? 'buy' : 'sell';
    const intensity = Math.min(3, Math.max(1, Math.round(Math.abs(delta) * 30)));
    const now = Date.now();

    const next = Array.from({ length: intensity }, (_, i) => {
      const jitter = (Math.random() - 0.5) * 0.03;
      return {
        id: `${symbol}-${now}-${i}`,
        ts: now - i * 90,
        price: Number((marketData.price + jitter).toFixed(2)),
        size: randomLot(),
        side,
      };
    });

    setTrades(prevTrades => [...next, ...prevTrades].slice(0, MAX_TRADES));
    prevPriceRef.current = marketData.price;
  }, [symbol, marketData?.timestamp, marketData?.price, marketData]);

  const { buyVol, sellVol } = useMemo(() => {
    return trades.slice(0, 60).reduce(
      (acc, t) => {
        if (t.side === 'buy') acc.buyVol += t.size;
        else acc.sellVol += t.size;
        return acc;
      },
      { buyVol: 0, sellVol: 0 }
    );
  }, [trades]);

  const total = buyVol + sellVol;
  const buyPct = total ? (buyVol / total) * 100 : 50;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="header-caps">Trades</span>
        <span className="font-mono text-xs text-vanna-text">{symbol}</span>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-2 px-3 py-2 border-b border-white/5">
        <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">Tape Bias</span>
        <div className="h-2 rounded bg-vanna-surface-light/60 overflow-hidden">
          <div className="h-full bg-vanna-green" style={{ width: `${buyPct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-[auto_auto_auto_auto] gap-2 px-3 py-2 text-[10px] text-vanna-text-secondary uppercase tracking-wider border-b border-white/5">
        <span>Time</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Side</span>
      </div>

      <div className="flex-1 overflow-auto">
        {trades.map((trade) => (
          <div
            key={trade.id}
            className="grid grid-cols-[auto_auto_auto_auto] gap-2 px-3 py-1.5 border-b border-white/5 hover:bg-white/5 transition-colors"
          >
            <span className="font-mono text-[11px] text-vanna-text-secondary">{fmtTime(trade.ts)}</span>
            <span className={`font-mono text-[11px] text-right ${trade.side === 'buy' ? 'text-vanna-green' : 'text-vanna-red'}`}>
              {trade.price.toFixed(2)}
            </span>
            <span className="font-mono text-[11px] text-vanna-text text-right">{trade.size}</span>
            <span className={`font-mono text-[11px] flex items-center justify-end gap-1 ${trade.side === 'buy' ? 'text-vanna-green' : 'text-vanna-red'}`}>
              {trade.side === 'buy' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {trade.side.toUpperCase()}
            </span>
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-white/5 text-[10px] text-vanna-text-secondary flex items-center justify-between">
        <span>Buy Vol: {buyVol.toLocaleString()}</span>
        <span>Sell Vol: {sellVol.toLocaleString()}</span>
      </div>
    </div>
  );
}
