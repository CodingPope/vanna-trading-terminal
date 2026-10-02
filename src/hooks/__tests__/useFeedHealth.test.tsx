import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import marketReducer, { setConnected, setFeedSource, setStats, updateMarketData } from '@/store/slices/marketSlice';
import orderBookReducer from '@/store/slices/orderBookSlice';
import replayReducer, { receiveStatus } from '@/store/slices/replaySlice';
import { useFeedHealth } from '../useFeedHealth';
import type { ReplayStatus } from '@/schemas';

/**
 * Feed health gates order entry, so a wrong reading has teeth: it either blocks
 * a legitimate order or lets one through against data that stopped arriving.
 */

const STATUS: ReplayStatus = {
  protocolVersion: 1, fixtureId: 'f:1', mode: 'recorded', unit: 'event',
  eventTimeNs: '1789678816585999872', startNs: '1789678816585999000',
  endNs: '1789678916585999872', speed: 1, speeds: [1], playing: true, ended: false,
  sequence: 0, generation: 1, canSeek: true, canStep: true,
};

let store: ReturnType<typeof makeStore>;

function makeStore() {
  return configureStore({ reducer: { market: marketReducer, orderBook: orderBookReducer, replay: replayReducer } });
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <Provider store={store}>{children}</Provider>
);
const health = () => renderHook(() => useFeedHealth(), { wrapper }).result.current;

/** A quote that landed `age` ms before the store's clock. */
function quoteAged(age: number) {
  store.dispatch(updateMarketData({
    symbol: 'AAPL', price: 100, change: 0, changePercent: 0, volume: 1, high: 100, low: 100,
    open: 100, close: 100, timestamp: 1, bid: 99, ask: 101, bidSize: 1, askSize: 1,
  }));
  store.dispatch(setStats({ lastUpdate: store.getState().market.lastReceivedAt + age }));
}

beforeEach(() => {
  store = makeStore();
  store.dispatch(setConnected(true));
  store.dispatch(setFeedSource('live'));
});

describe('useFeedHealth', () => {
  it('calls a live feed that stopped arriving stale', () => {
    quoteAged(5000);
    expect(health().status).toBe('STALE');
    expect(health().healthy).toBe(false);
  });

  it('does not call a deliberately paused replay stale', () => {
    quoteAged(5000);
    store.dispatch(receiveStatus({ ...STATUS, playing: false }));
    expect(health().status).toBe('PAUSED');
    expect(health().stale).toBe(false);
    // Order entry stays open: a paper order placed while paused simply works
    // when the clock moves again.
    expect(health().healthy).toBe(true);
  });

  it('still calls a running replay stale when its data dries up', () => {
    quoteAged(5000);
    store.dispatch(receiveStatus(STATUS));
    expect(health().status).toBe('STALE');
  });

  it('reports a dropped socket ahead of anything else', () => {
    quoteAged(0);
    store.dispatch(receiveStatus({ ...STATUS, playing: false }));
    store.dispatch(setConnected(false));
    expect(health().status).toBe('DISCONNECTED');
  });
});
