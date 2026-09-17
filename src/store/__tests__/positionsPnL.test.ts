import { describe, it, expect } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import paperReducer from '../slices/paperSlice';
import marketReducer, { batchUpdateMarketData } from '../slices/marketSlice';
import positionsReducer, { setPositions } from '../slices/positionsSlice';
import orderBookReducer from '../slices/orderBookSlice';
import panelsReducer from '../slices/panelsSlice';
import tradesReducer from '../slices/tradesSlice';
import { selectPositionsWithPnL, selectUnrealizedPnL } from '../selectors';
import type { MarketData, Position } from '@/types';

/**
 * P&L is derived, not delivered.
 *
 * The server sends what you hold and what you paid; the mark is recomputed on
 * every tick here. Trusting a server-sent `pnl` would leave the number stale
 * between updates, sitting beside a price that has already moved — and a
 * lagging P&L is worse than none, because it looks authoritative.
 */

function makeStore() {
  return configureStore({
    reducer: {
      market: marketReducer,
      paper: paperReducer,
      positions: positionsReducer,
      orderBook: orderBookReducer,
      panels: panelsReducer,
      trades: tradesReducer,
    },
  });
}

function quote(symbol: string, price: number): MarketData {
  return {
    symbol, price, change: 0, changePercent: 0, volume: 0,
    high: price, low: price, open: price, close: price,
    timestamp: 1_700_000_000_000, bid: price - 0.01, ask: price + 0.01,
    bidSize: 100, askSize: 100,
  };
}

/** A position carrying deliberately wrong marks, as if the wire went quiet. */
const position = (over: Partial<Position> = {}): Position => ({
  symbol: 'AAPL', side: 'long', size: 100, entryPrice: 200,
  currentPrice: 0, pnl: -99999, pnlPercent: -99999,
  ...over,
});

function setup(p: Position, price: number) {
  const store = makeStore();
  store.dispatch(setPositions([p]));
  store.dispatch(batchUpdateMarketData([quote(p.symbol, price)]));
  return store;
}

describe('selectPositionsWithPnL', () => {
  it('marks a long to the live price, ignoring stale server values', () => {
    const store = setup(position(), 210);
    const [marked] = selectPositionsWithPnL(store.getState());

    expect(marked.currentPrice).toBe(210);
    expect(marked.pnl).toBeCloseTo(1000, 6);   // (210-200) * 100
    expect(marked.pnlPercent).toBeCloseTo(5, 6);
  });

  it('shows a long losing when price falls', () => {
    const [marked] = selectPositionsWithPnL(setup(position(), 190).getState());
    expect(marked.pnl).toBeCloseTo(-1000, 6);
  });

  it('shows a short gaining when price falls', () => {
    // The direction term is the whole reason this cannot be a plain subtraction.
    const [marked] = selectPositionsWithPnL(setup(position({ side: 'short' }), 190).getState());

    expect(marked.pnl).toBeCloseTo(1000, 6);
    expect(marked.pnlPercent).toBeCloseTo(5, 6);
  });

  it('shows a short losing when price rises', () => {
    const [marked] = selectPositionsWithPnL(setup(position({ side: 'short' }), 210).getState());
    expect(marked.pnl).toBeCloseTo(-1000, 6);
  });

  it('scales P&L with position size', () => {
    const small = selectPositionsWithPnL(setup(position({ size: 100 }), 210).getState())[0];
    const large = selectPositionsWithPnL(setup(position({ size: 500 }), 210).getState())[0];

    expect(large.pnl).toBeCloseTo(small.pnl * 5, 6);
    // Percentage is per-share, so size does not move it.
    expect(large.pnlPercent).toBeCloseTo(small.pnlPercent, 6);
  });

  it('follows the price as it ticks', () => {
    const store = setup(position(), 200);
    expect(selectPositionsWithPnL(store.getState())[0].pnl).toBeCloseTo(0, 6);

    store.dispatch(batchUpdateMarketData([quote('AAPL', 205)]));
    expect(selectPositionsWithPnL(store.getState())[0].pnl).toBeCloseTo(500, 6);

    store.dispatch(batchUpdateMarketData([quote('AAPL', 195)]));
    expect(selectPositionsWithPnL(store.getState())[0].pnl).toBeCloseTo(-500, 6);
  });

  it('leaves a position untouched when there is no quote for it', () => {
    const store = makeStore();
    const held = position({ symbol: 'ZZZZ', pnl: 42, currentPrice: 1 });
    store.dispatch(setPositions([held]));

    // Better to show the last known figure than to invent a mark from nothing.
    expect(selectPositionsWithPnL(store.getState())[0]).toEqual(held);
  });

  it('sums unrealised P&L across the book from live marks', () => {
    const store = makeStore();
    store.dispatch(setPositions([
      position({ symbol: 'AAPL', entryPrice: 200, size: 100 }),
      position({ symbol: 'MSFT', entryPrice: 400, size: 50, side: 'short' }),
    ]));
    store.dispatch(batchUpdateMarketData([quote('AAPL', 210), quote('MSFT', 380)]));

    // +1000 on the long, +1000 on the short.
    expect(selectUnrealizedPnL(store.getState())).toBeCloseTo(2000, 6);
  });

  it('reports an empty book as zero rather than NaN', () => {
    expect(selectUnrealizedPnL(makeStore().getState())).toBe(0);
  });
});
