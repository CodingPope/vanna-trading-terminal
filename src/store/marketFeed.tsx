/**
 * MarketFeedProvider — drives market data into the Redux store.
 *
 * This is the seam where the data source lives. It probes for a backend on
 * mount: if one answers it runs the real transport (REST snapshot, then
 * WebSocket deltas), and if nothing answers it runs a local simulation so the
 * app is still usable standalone. Components read the store through selectors
 * and neither know nor care which won.
 *
 * It deliberately holds no Context and subscribes to as little as possible: the
 * simulation's rAF loop reads entities via `store.getState()` rather than
 * `useSelector`, so this component does not re-render on every tick.
 */
import React, { useEffect, useRef, useState } from 'react';
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
import { startLiveFeed } from './liveFeed';
import type { LiveFeedHandle } from './liveFeed';
import type { MarketData } from '@/types';
import { SYMBOLS, generateMockOrderBook, generateInitialFocusList, tickMagnitude, spreadFor } from './mockData';

const TICK_INTERVAL_MS = 100;

/**
 * Simulated feed, used when no backend answers.
 *
 * `enabled` is a parameter rather than a conditional hook call: hooks cannot be
 * called conditionally, and the feed's status is only known after an async
 * probe. The effect starts the loop or does nothing.
 */
function useMockFeed(dispatch: AppDispatch, store: Store<RootState>, enabled: boolean) {
  const frameRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
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
          // Proportional move: a flat ±$0.25 tick is noise on a $600 index and
          // a 1.6% lurch on a $15 volatility print.
          const drift = (Math.random() - 0.5) * 2 * tickMagnitude(symbol);
          const newPrice = Math.max(0.01, current.price * (1 + drift));
          const newChange = newPrice - current.open;
          const spread = spreadFor(newPrice);
          updates.push({
            ...current,
            price: newPrice,
            change: newChange,
            changePercent: (newChange / current.open) * 100,
            bid: newPrice - spread / 2,
            ask: newPrice + spread / 2,
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
  }, [dispatch, store, enabled]);
}

type FeedSource = 'connecting' | 'live' | 'simulated';

/**
 * Try the backend; fall back to the simulation if nothing answers.
 *
 * Returns which source won, so the UI can say so rather than presenting
 * invented prices as though they came off a wire.
 */
function useFeedSource(dispatch: AppDispatch): FeedSource {
  const [source, setSource] = useState<FeedSource>('connecting');

  useEffect(() => {
    let cancelled = false;
    let handle: LiveFeedHandle | null = null;

    startLiveFeed(dispatch, SYMBOLS)
      .then(result => {
        if (cancelled) {
          result?.stop();
          return;
        }
        handle = result;
        setSource(result ? 'live' : 'simulated');
      })
      .catch(() => {
        if (!cancelled) setSource('simulated');
      });

    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [dispatch]);

  return source;
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

  const source = useFeedSource(dispatch);
  useMockFeed(dispatch, store, source === 'simulated');
  usePerformanceStats();
  useAlertCleanup(dispatch);

  return <>{children}</>;
}
