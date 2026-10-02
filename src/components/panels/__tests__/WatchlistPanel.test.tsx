import { describe, it, expect } from 'vitest';
import { render as rtlRender, screen, within, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import marketReducer, { batchUpdateMarketData } from '@/store/slices/marketSlice';
import type { MarketData } from '@/types';
import { WatchlistPanel } from '../WatchlistPanel';

/**
 * A recorded fixture usually covers far fewer symbols than the watchlist's
 * fixed 20-symbol universe. Everything outside that coverage never receives
 * an `updateMarketData` dispatch, so it sits at whatever price it was seeded
 * with at module load and never moves again. These tests pin the fix: a
 * symbol that has never received a real quote must read as such, not as a
 * live price that simply hasn't ticked yet.
 */

function makeStore() {
  return configureStore({ reducer: { market: marketReducer } });
}

const render = (store: ReturnType<typeof makeStore>) =>
  rtlRender(<Provider store={store}><WatchlistPanel /></Provider>);

function quote(symbol: string, over: Partial<MarketData> = {}): MarketData {
  return {
    symbol, price: 100, change: 1, changePercent: 1, volume: 5_000_000,
    high: 101, low: 99, open: 99, close: 100, timestamp: 1_700_000_000_000,
    bid: 99.99, ask: 100.01, bidSize: 100, askSize: 100, ...over,
  };
}

/** The row for one symbol, found by its ticker text. */
function row(symbol: string) {
  return screen.getByText(symbol).closest('button') as HTMLElement;
}

describe('WatchlistPanel', () => {
  it('marks every symbol as having no live data before any real quote arrives', () => {
    const store = makeStore();
    render(store);
    // A fresh store has never dispatched a real update for anything.
    expect(within(row('AAPL')).getByText('no live data')).toBeInTheDocument();
    expect(within(row('AMD')).getByText('no live data')).toBeInTheDocument();
  });

  it('marks only the symbols an actual feed update touched as live', () => {
    const store = makeStore();
    store.dispatch(batchUpdateMarketData([quote('AAPL', { price: 313.22, changePercent: 0.02 })]));
    render(store);

    expect(within(row('AAPL')).queryByText('no live data')).not.toBeInTheDocument();
    expect(within(row('AAPL')).getByText('313.22')).toBeInTheDocument();

    // AMD never received a dispatch, so it stays at its seeded price forever —
    // and that price must not be presented as if it were current.
    expect(within(row('AMD')).getByText('no live data')).toBeInTheDocument();
    expect(within(row('AMD')).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('dims a stale row without relying on color alone', () => {
    const store = makeStore();
    store.dispatch(batchUpdateMarketData([quote('AAPL')]));
    render(store);
    expect(row('AAPL').className).not.toContain('opacity-50');
    expect(row('AMD').className).toContain('opacity-50');
  });

  it('excludes symbols with no live data from gainers, losers, and volume', () => {
    const store = makeStore();
    // Only AAPL is live; everything else is a frozen seed that may well have
    // a nonzero seeded changePercent, which must not count as "today's move."
    store.dispatch(batchUpdateMarketData([quote('AAPL', { changePercent: 2.5, volume: 9_000_000 })]));
    render(store);

    for (const tab of ['gainers', 'losers', 'volume'] as const) {
      fireEvent.click(screen.getByRole('button', { name: tab }));
      const options = screen.queryAllByRole('option');
      for (const option of options) {
        expect(within(option).queryByText('no live data')).not.toBeInTheDocument();
      }
    }
  });

  it('reports the live count separately from the total in the footer', () => {
    const store = makeStore();
    store.dispatch(batchUpdateMarketData([quote('AAPL'), quote('MSFT')]));
    render(store);
    expect(screen.getByText(/20 symbols \(2 live\)/)).toBeInTheDocument();
  });

  it('keeps a stale symbol visible and selectable in the all view', () => {
    // Staleness is about honesty, not about hiding the symbol — someone should
    // still be able to find and select AMD, just not be told it is live.
    const store = makeStore();
    render(store);
    expect(row('AMD')).toBeEnabled();
  });
});
