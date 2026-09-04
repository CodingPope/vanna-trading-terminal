import { describe, it, expect } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import tradesReducer, {
  setTrades,
  addTrades,
  clearTrades,
  MAX_TRADES_PER_SYMBOL,
} from '../slices/tradesSlice';
import type { Trade } from '@/types';

function makeStore() {
  return configureStore({ reducer: { trades: tradesReducer } });
}

const trade = (n: number, side: Trade['side'] = 'buy'): Trade => ({
  id: `t${n}`,
  symbol: 'AAPL',
  price: 230 + n / 100,
  size: 100,
  side,
  timestamp: 1_700_000_000_000 + n,
});

const tape = (s: ReturnType<typeof makeStore>) => s.getState().trades.bySymbol.AAPL ?? [];

describe('tradesSlice', () => {
  it('starts with no tape for an unknown symbol', () => {
    expect(tape(makeStore())).toEqual([]);
  });

  it('replaces the tape on a snapshot backfill', () => {
    const store = makeStore();
    store.dispatch(addTrades({ symbol: 'AAPL', trades: [trade(1)] }));
    store.dispatch(setTrades({ symbol: 'AAPL', trades: [trade(9), trade(8)] }));

    expect(tape(store).map(t => t.id)).toEqual(['t9', 't8']);
  });

  it('puts the newest print at the top', () => {
    const store = makeStore();
    // Arriving oldest-first within a batch, as the wire sends them.
    store.dispatch(addTrades({ symbol: 'AAPL', trades: [trade(1), trade(2), trade(3)] }));

    expect(tape(store).map(t => t.id)).toEqual(['t3', 't2', 't1']);
  });

  it('prepends later batches ahead of earlier ones', () => {
    const store = makeStore();
    store.dispatch(addTrades({ symbol: 'AAPL', trades: [trade(1)] }));
    store.dispatch(addTrades({ symbol: 'AAPL', trades: [trade(2)] }));

    expect(tape(store).map(t => t.id)).toEqual(['t2', 't1']);
  });

  it('caps the tape rather than growing without bound', () => {
    const store = makeStore();
    // A tape is unbounded by nature; the panel shows a screenful.
    for (let i = 0; i < MAX_TRADES_PER_SYMBOL + 50; i++) {
      store.dispatch(addTrades({ symbol: 'AAPL', trades: [trade(i)] }));
    }

    expect(tape(store)).toHaveLength(MAX_TRADES_PER_SYMBOL);
    // The oldest are the ones dropped.
    expect(tape(store)[0].id).toBe(`t${MAX_TRADES_PER_SYMBOL + 49}`);
  });

  it('ignores an empty batch instead of touching state', () => {
    const store = makeStore();
    store.dispatch(addTrades({ symbol: 'AAPL', trades: [trade(1)] }));
    const before = tape(store);

    store.dispatch(addTrades({ symbol: 'AAPL', trades: [] }));

    expect(tape(store)).toBe(before);
  });

  it('keeps symbols apart', () => {
    const store = makeStore();
    store.dispatch(addTrades({ symbol: 'AAPL', trades: [trade(1)] }));
    store.dispatch(addTrades({ symbol: 'MSFT', trades: [{ ...trade(2), symbol: 'MSFT' }] }));

    expect(tape(store)).toHaveLength(1);
    expect(store.getState().trades.bySymbol.MSFT).toHaveLength(1);
  });

  it('clears one symbol without disturbing others', () => {
    const store = makeStore();
    store.dispatch(addTrades({ symbol: 'AAPL', trades: [trade(1)] }));
    store.dispatch(addTrades({ symbol: 'MSFT', trades: [{ ...trade(2), symbol: 'MSFT' }] }));

    store.dispatch(clearTrades('AAPL'));

    expect(tape(store)).toEqual([]);
    expect(store.getState().trades.bySymbol.MSFT).toHaveLength(1);
  });
});
