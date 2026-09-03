/**
 * MarketFeedProvider — drives market data into the Redux store.
 *
 * This is the seam where the data source lives. Today it runs a client-side
 * simulation; replacing it with the real transport means swapping the body of
 * `useMockFeed` for a `WebSocketClient` + `SnapshotService`, and nothing else in
 * the app changes — components read the store through selectors and neither know
 * nor care where the data came from.
 *
 * It deliberately holds no Context and subscribes to as little as possible: the
 * rAF loop reads entities via `store.getState()` rather than `useSelector`, so
 * this component does not re-render on every tick.
 */
import React, { useEffect, useRef } from 'react';
import { useDispatch, useStore } from 'react-redux';
import type { AppDispatch, RootState } from './store';
import type { Store } from '@reduxjs/toolkit';
import {
  batchUpdateMarketData,
  setConnected as rtkSetConnected,
} from './slices/marketSlice';
import { setOrderBook } from './slices/orderBookSlice';
import { setFocusList } from './slices/positionsSlice';
import { removePriceAlert } from './slices/panelsSlice';
import { useAppSelector } from './hooks';
import { usePerformanceStats } from '@/hooks/usePerformanceStats';
import { selectAlerts } from './selectors';
import type { MarketData } from '@/types';
import { SYMBOLS, generateMockOrderBook, generateInitialFocusList } from './mockData';

const TICK_INTERVAL_MS = 100;

/** Simulated feed: walks each symbol's price and batch-dispatches ~10x/sec. */
function useMockFeed(dispatch: AppDispatch, store: Store<RootState>) {
  const frameRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    const entitiesNow = () => store.getState().market.entities;

    dispatch(rtkSetConnected(true));
    dispatch(setFocusList(generateInitialFocusList(entitiesNow())));

    SYMBOLS.forEach(symbol => {
      const price = entitiesNow()[symbol]?.price ?? 100;
      dispatch(setOrderBook({ symbol, entries: generateMockOrderBook(price) }));
    });

    const tick = () => {
      const now = Date.now();

      if (now - lastTickRef.current > TICK_INTERVAL_MS) {
        const entities = entitiesNow();
        const updates: MarketData[] = [];

        SYMBOLS.forEach(symbol => {
          const current = entities[symbol];
          if (!current) return;
          const newPrice = Math.max(0.01, current.price + (Math.random() - 0.5) * 0.5);
          const newChange = newPrice - current.open;
          updates.push({
            ...current,
            price: newPrice,
            change: newChange,
            changePercent: (newChange / current.open) * 100,
            bid: newPrice - 0.01,
            ask: newPrice + 0.01,
            bidSize: Math.floor(Math.random() * 1000) + 100,
            askSize: Math.floor(Math.random() * 1000) + 100,
            timestamp: now,
          });
        });

        if (updates.length) dispatch(batchUpdateMarketData(updates));
        lastTickRef.current = now;
      }

      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [dispatch, store]);
}

/** Clears triggered price alerts 5s after they fire. */
function useAlertCleanup(dispatch: AppDispatch) {
  const alerts = useAppSelector(selectAlerts);

  useEffect(() => {
    const triggered = alerts.filter(a => a.triggered);
    if (!triggered.length) return;
    const timer = setTimeout(() => {
      triggered.forEach(a => dispatch(removePriceAlert(a.id)));
    }, 5000);
    return () => clearTimeout(timer);
  }, [alerts, dispatch]);
}

export function MarketFeedProvider({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();

  useMockFeed(dispatch, store);
  usePerformanceStats();
  useAlertCleanup(dispatch);

  return <>{children}</>;
}
