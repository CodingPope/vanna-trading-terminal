import { useMemo } from 'react';
import { useMarket } from '@/store';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { OrderBookEntry } from '@/types';

interface DepthPoint {
  price: number;
  bidDepth: number | null;
  askDepth: number | null;
}

function byBidPriceDesc(a: OrderBookEntry, b: OrderBookEntry): number {
  return b.price - a.price;
}

function byAskPriceAsc(a: OrderBookEntry, b: OrderBookEntry): number {
  return a.price - b.price;
}

export function DepthChartPanel({ symbol: propSymbol }: { symbol?: string }) {
  const { state, getMarketData, getOrderBook } = useMarket();
  const symbol = propSymbol ?? state.selectedSymbol;
  const marketData = getMarketData(symbol);
  const book = getOrderBook(symbol);

  const data = useMemo(() => {
    const bids = book.filter(l => l.side === 'bid').sort(byBidPriceDesc).slice(0, 20);
    const asks = book.filter(l => l.side === 'ask').sort(byAskPriceAsc).slice(0, 20);

    const bidPoints: DepthPoint[] = [];
    let bidCum = 0;
    for (const b of bids) {
      bidCum += b.size;
      bidPoints.push({ price: Number(b.price.toFixed(2)), bidDepth: bidCum, askDepth: null });
    }

    const askPoints: DepthPoint[] = [];
    let askCum = 0;
    for (const a of asks) {
      askCum += a.size;
      askPoints.push({ price: Number(a.price.toFixed(2)), bidDepth: null, askDepth: askCum });
    }

    // Re-order bids ascending by price for chart continuity
    bidPoints.sort((x, y) => x.price - y.price);

    const byPrice = new Map<number, DepthPoint>();
    for (const p of bidPoints) {
      byPrice.set(p.price, p);
    }
    for (const p of askPoints) {
      const existing = byPrice.get(p.price);
      if (existing) {
        byPrice.set(p.price, { ...existing, askDepth: p.askDepth });
      } else {
        byPrice.set(p.price, p);
      }
    }

    return Array.from(byPrice.values()).sort((x, y) => x.price - y.price);
  }, [book]);

  const maxDepth = useMemo(() => {
    return Math.max(
      1,
      ...data.flatMap(d => [d.bidDepth ?? 0, d.askDepth ?? 0])
    );
  }, [data]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="header-caps">Depth Chart</span>
        <span className="font-mono text-xs text-vanna-text">{symbol}</span>
      </div>

      <div className="flex-1 min-h-0 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="price"
              tick={{ fontSize: 10, fill: '#606080' }}
              tickFormatter={(v) => Number(v).toFixed(2)}
              domain={['auto', 'auto']}
              type="number"
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#606080' }}
              tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`}
              domain={[0, maxDepth * 1.1]}
            />
            <Tooltip
              contentStyle={{
                background: 'rgba(10, 10, 15, 0.92)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                fontSize: 11,
              }}
            />

            <Area
              type="stepAfter"
              dataKey="bidDepth"
              stroke="#22c55e"
              fill="rgba(34,197,94,0.24)"
              connectNulls
              isAnimationActive={false}
            />
            <Area
              type="stepBefore"
              dataKey="askDepth"
              stroke="#ef4444"
              fill="rgba(239,68,68,0.24)"
              connectNulls
              isAnimationActive={false}
            />

            {marketData && (
              <ReferenceLine
                x={Number(marketData.price.toFixed(2))}
                stroke="#ffdd88"
                strokeDasharray="3 3"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="px-3 py-2 border-t border-white/5 text-[10px] text-vanna-text-secondary flex items-center justify-between">
        <span>Levels: {data.length}</span>
        <span>Mid: {marketData ? ((marketData.bid + marketData.ask) / 2).toFixed(2) : '-'}</span>
      </div>
    </div>
  );
}
