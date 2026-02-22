import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';

import { memo, useMemo, useCallback, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { useSelector } from 'react-redux';
import { Settings, ArrowUp, ArrowDown } from 'lucide-react';
import { selectOrderBook, selectMarketData, selectSelectedSymbol } from '@/store/selectors';
import type { RootState } from '@/store/store';
import type { OrderBookEntry } from '@/types';

// ── Size bar cell renderer — GPU-promoted with transform3d ───────────────────
const SizeBarCell = memo(function SizeBarCell({ value, data, context }: ICellRendererParams<OrderBookEntry>) {
  const maxSize: number = context?.maxSize ?? 1;
  const pct = Math.min(((value as number) / maxSize) * 60, 60);
  const isAsk = data?.side === 'ask';
  const color = isAsk ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)';

  return (
    <div className="relative w-full h-full flex items-center justify-end" style={{ transform: 'translateZ(0)' }}>
      <div
        className="absolute right-0 top-0 bottom-0"
        style={{ width: `${pct}%`, background: color, willChange: 'width' }}
      />
      <span className="relative font-mono text-xs text-vanna-text">
        {(value as number).toLocaleString()}
      </span>
    </div>
  );
});

const PriceCell = memo(function PriceCell({ value, data }: ICellRendererParams<OrderBookEntry>) {
  const isAsk = data?.side === 'ask';
  return (
    <span
      className={`font-mono text-xs ${isAsk ? 'text-vanna-red' : 'text-vanna-green'}`}
      style={{ transform: 'translateZ(0)', display: 'block' }}
    >
      {(value as number).toFixed(2)}
    </span>
  );
});

const TotalCell = memo(function TotalCell({ value }: ICellRendererParams<OrderBookEntry>) {
  return (
    <span className="font-mono text-xs text-vanna-text-secondary text-right block">
      {(value as number).toLocaleString()}
    </span>
  );
});

// ── Column definitions ────────────────────────────────────────────────────────
const COL_DEFS: ColDef<OrderBookEntry>[] = [
  {
    field: 'price',
    headerName: 'Price',
    flex: 1,
    cellRenderer: PriceCell,
    enableCellChangeFlash: true,
    sortable: false,
  },
  {
    field: 'size',
    headerName: 'Size',
    flex: 1,
    cellRenderer: SizeBarCell,
    enableCellChangeFlash: true,
    sortable: false,
    cellStyle: { padding: 0 },
  },
  {
    field: 'total',
    headerName: 'Total',
    flex: 1,
    cellRenderer: TotalCell,
    sortable: false,
  },
];

// ── Main panel ────────────────────────────────────────────────────────────────
interface OrderBookPanelProps {
  symbol?: string;
}

export function OrderBookPanel({ symbol: propSymbol }: OrderBookPanelProps) {
  const selectedSymbol = useSelector(selectSelectedSymbol);
  const symbol = propSymbol ?? selectedSymbol;

  const orderBook = useSelector((s: RootState) => selectOrderBook(s, symbol));
  const marketData = useSelector((s: RootState) => selectMarketData(s, symbol));

  const { bids, asks, spread } = useMemo(() => {
    const bids = orderBook.filter(e => e.side === 'bid').slice(0, 10);
    const asks = orderBook.filter(e => e.side === 'ask').slice(0, 10).reverse();
    const spread = marketData ? Number((marketData.ask - marketData.bid).toFixed(4)) : 0;
    return { bids, asks, spread };
  }, [orderBook, marketData]);

  const maxSize = useMemo(() => {
    const sizes = [...bids, ...asks].map(e => e.size);
    return Math.max(...sizes, 1);
  }, [bids, asks]);

  // Passed as context to cell renderers
  const gridContext = useRef({ maxSize });
  gridContext.current.maxSize = maxSize;

  const getRowId = useCallback((params: { data: OrderBookEntry }) =>
    `${params.data.side}-${params.data.price}`, []);

  const currentPrice = marketData?.price ?? 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 flex-shrink-0">
        <span className="header-caps">Order Book</span>
        <button className="p-1.5 rounded hover:bg-white/5 transition-colors" aria-label="Settings">
          <Settings className="w-3.5 h-3.5 text-vanna-text-secondary" />
        </button>
      </div>

      {/* Symbol info */}
      <div className="px-3 py-2 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm text-vanna-text">{symbol}</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg text-vanna-text">{currentPrice.toFixed(2)}</span>
            {marketData && (
              <span className={`flex items-center text-xs ${marketData.changePercent >= 0 ? 'text-vanna-green' : 'text-vanna-red'}`}>
                {marketData.changePercent >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                {Math.abs(marketData.changePercent).toFixed(2)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Asks — AG Grid */}
      <div className="flex-1 min-h-0 ag-theme-quartz-dark vanna-book-grid">
        <AgGridReact<OrderBookEntry>
          rowData={asks}
          columnDefs={COL_DEFS}
          getRowId={getRowId}
          rowHeight={20}
          headerHeight={24}
          context={gridContext.current}
          animateRows={false}
          suppressCellFocus
          suppressMovableColumns
          domLayout="normal"
        />
      </div>

      {/* Spread indicator */}
      <div className="px-3 py-1.5 border-y border-white/5 bg-vanna-surface-light/30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider">Spread</span>
          <span className="font-mono text-xs text-vanna-gold">{spread.toFixed(4)}</span>
        </div>
      </div>

      {/* Bids — AG Grid */}
      <div className="flex-1 min-h-0 ag-theme-quartz-dark vanna-book-grid">
        <AgGridReact<OrderBookEntry>
          rowData={bids}
          columnDefs={COL_DEFS}
          getRowId={getRowId}
          rowHeight={20}
          headerHeight={0}
          context={gridContext.current}
          animateRows={false}
          suppressCellFocus
          suppressMovableColumns
          domLayout="normal"
        />
      </div>

      {/* Footer stats */}
      <div className="px-3 py-2 border-t border-white/5 text-[10px] text-vanna-text-secondary flex-shrink-0">
        <div className="flex items-center justify-between">
          <span>Bid: {marketData?.bid.toFixed(2)}</span>
          <span>Ask: {marketData?.ask.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span>Bid Size: {marketData?.bidSize.toLocaleString()}</span>
          <span>Ask Size: {marketData?.askSize.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
