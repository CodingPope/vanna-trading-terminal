import { describe, it, expect } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import marketReducer, { setSourceMode } from '@/store/slices/marketSlice';
import paperReducer from '@/store/slices/paperSlice';
import orderBookReducer from '@/store/slices/orderBookSlice';
import replayReducer from '@/store/slices/replaySlice';
import { DiagnosticsPanel } from '../DiagnosticsPanel';

/**
 * This disclaimer used to hardcode "synthetic or reconstructed replay" —
 * written before recorded mode existed, and silently wrong once it did:
 * a reviewer watching genuine historical data would be told it was made up.
 * It now names whichever mode is actually running.
 */

function makeStore() {
  return configureStore({
    reducer: { market: marketReducer, paper: paperReducer, orderBook: orderBookReducer, replay: replayReducer },
  });
}

const render = (store: ReturnType<typeof makeStore>) =>
  rtlRender(<Provider store={store}><DiagnosticsPanel /></Provider>);

describe('DiagnosticsPanel data-source disclaimer', () => {
  it('names synthetic data as synthetic', () => {
    const store = makeStore();
    store.dispatch(setSourceMode('synthetic'));
    render(store);
    expect(screen.getByText(/Market data is synthetic\./)).toBeInTheDocument();
  });

  it('names replay data as reconstructed replay', () => {
    const store = makeStore();
    store.dispatch(setSourceMode('replay'));
    render(store);
    expect(screen.getByText(/Market data is reconstructed replay\./)).toBeInTheDocument();
  });

  it('names recorded data as recorded, not as a generic disclaimer', () => {
    const store = makeStore();
    store.dispatch(setSourceMode('recorded'));
    render(store);
    expect(screen.getByText(/Market data is recorded/)).toBeInTheDocument();
    // The old copy claimed real historical data was synthetic or reconstructed.
    expect(screen.queryByText(/synthetic or reconstructed replay/)).not.toBeInTheDocument();
  });
});
