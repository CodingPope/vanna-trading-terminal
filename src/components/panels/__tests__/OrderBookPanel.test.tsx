import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import marketReducer from '@/store/slices/marketSlice';
import orderBookReducer, { setOrderBook } from '@/store/slices/orderBookSlice';
import positionsReducer from '@/store/slices/positionsSlice';
import panelsReducer from '@/store/slices/panelsSlice';
import { OrderBookPanel } from '../OrderBookPanel';
import type { OrderBookEntry } from '@/types';

/**
 * The order book rendered as an empty shell in the browser: AG Grid v33+ ships
 * no modules by default, so without ModuleRegistry.registerModules the grid
 * mounts, logs an error, and draws no rows. Nothing failed — the panel just sat
 * there blank, which is exactly the kind of break a type checker and a
 * does-it-render smoke test both wave through.
 *
 * These assert on actual row content.
 */

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

function makeStore(entries: OrderBookEntry[]) {
  const store = configureStore({
    reducer: {
      market: marketReducer,
      orderBook: orderBookReducer,
      positions: positionsReducer,
      panels: panelsReducer,
    },
  });
  store.dispatch(setOrderBook({ symbol: 'AAPL', entries }));
  return store;
}

const BOOK: OrderBookEntry[] = [
  { price: 232.44, size: 3987, total: 3987, side: 'ask' },
  { price: 232.43, size: 1200, total: 5187, side: 'ask' },
  { price: 232.42, size: 783, total: 783, side: 'bid' },
  { price: 232.41, size: 1500, total: 2283, side: 'bid' },
];

describe('OrderBookPanel', () => {
  it('renders bid and ask prices as grid rows', async () => {
    render(
      <Provider store={makeStore(BOOK)}>
        <OrderBookPanel symbol="AAPL" />
      </Provider>,
    );

    // If modules are unregistered these never appear, however healthy the
    // surrounding panel chrome looks.
    await waitFor(() => {
      expect(screen.getByText('232.42')).toBeInTheDocument();
    });
    expect(screen.getByText('232.44')).toBeInTheDocument();
  });

  it('renders sizes alongside prices', async () => {
    render(
      <Provider store={makeStore(BOOK)}>
        <OrderBookPanel symbol="AAPL" />
      </Provider>,
    );

    // 3,987 appears twice on the top ask — as size and as cumulative total.
    await waitFor(() => {
      expect(screen.getAllByText('3,987').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('783').length).toBeGreaterThan(0);
    expect(screen.getByText('1,500')).toBeInTheDocument();
  });

  it('does not log an AG Grid registration error', async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.join(' '));
    });

    render(
      <Provider store={makeStore(BOOK)}>
        <OrderBookPanel symbol="AAPL" />
      </Provider>,
    );
    await waitFor(() => expect(screen.getByText('232.42')).toBeInTheDocument());

    const registration = errors.filter(e =>
      String(e).includes('registerModules') || String(e).includes('AG Grid: error'),
    );
    expect(registration).toEqual([]);
    spy.mockRestore();
  });
});
