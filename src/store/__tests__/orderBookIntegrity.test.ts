import { describe, it, expect } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import orderBookReducer, { setOrderBook, applyDelta } from '../slices/orderBookSlice';
import type { OrderBookEntry } from '@/types';
import stream from './book-stream.json';

/**
 * Runs a real captured server delta stream through the real client reducer.
 *
 * This is the shape of bug that only appeared on screen. The server used to
 * re-price the whole ladder every tick and send a random sample of it, while
 * `applyDelta` merges by price and adds any level it has not seen. The client's
 * book therefore accumulated levels from different moments, nothing was ever
 * removed, and it crossed — bids sitting above asks, which is not a book at
 * all. Every unit test passed throughout, because each half was fine alone.
 *
 * Regenerate the fixture from a running server if the wire format changes.
 */

type Frame = {
  type: string;
  symbol: string;
  sequence: number;
  data: OrderBookEntry[];
};

const SNAPSHOT = stream.snapshot as OrderBookEntry[];
const FRAMES = stream.frames as Frame[];

function makeStore() {
  const store = configureStore({ reducer: { orderBook: orderBookReducer } });
  store.dispatch(setOrderBook({ symbol: 'AAPL', entries: SNAPSHOT }));
  return store;
}

const book = (store: ReturnType<typeof makeStore>): OrderBookEntry[] =>
  store.getState().orderBook.books.AAPL ?? [];

const bids = (b: OrderBookEntry[]) => b.filter(e => e.side === 'bid');
const asks = (b: OrderBookEntry[]) => b.filter(e => e.side === 'ask');

describe('order book stays coherent across a real delta stream', () => {
  it('captured a stream worth testing', () => {
    expect(FRAMES.length).toBeGreaterThan(20);
    expect(SNAPSHOT.length).toBe(20);
    // Removals are how a level leaves the grid; without them the book grows.
    expect(FRAMES.some(f => f.data.some(e => e.size === 0))).toBe(true);
  });

  it('never crosses — no bid at or above the best ask', () => {
    const store = makeStore();

    FRAMES.forEach((frame, i) => {
      if (frame.type === 'order_book_snapshot') {
        store.dispatch(setOrderBook({ symbol: 'AAPL', entries: frame.data }));
      } else {
        store.dispatch(applyDelta({ symbol: 'AAPL', delta: frame.data }));
      }

      const current = book(store);
      const b = bids(current);
      const a = asks(current);
      if (!b.length || !a.length) return;

      const bestBid = Math.max(...b.map(e => e.price));
      const bestAsk = Math.min(...a.map(e => e.price));
      expect(
        bestBid < bestAsk,
        `crossed after frame ${i} (seq ${frame.sequence}): bid ${bestBid} >= ask ${bestAsk}`,
      ).toBe(true);
    });
  });

  it('stays bounded instead of accumulating stale levels', () => {
    const store = makeStore();
    for (const frame of FRAMES) {
      if (frame.type === 'order_book_snapshot') {
        store.dispatch(setOrderBook({ symbol: 'AAPL', entries: frame.data }));
      } else {
        store.dispatch(applyDelta({ symbol: 'AAPL', delta: frame.data }));
      }
    }

    const current = book(store);
    // The grid is 10 levels a side. Unbounded growth is the failure mode when
    // the server changes price levels without retiring the old ones.
    expect(bids(current).length).toBeLessThanOrEqual(10);
    expect(asks(current).length).toBeLessThanOrEqual(10);
    expect(current.length).toBeGreaterThan(0);
  });

  it('keeps levels sorted best-bid-down', () => {
    const store = makeStore();
    for (const frame of FRAMES) {
      if (frame.type === 'order_book_delta') {
        store.dispatch(applyDelta({ symbol: 'AAPL', delta: frame.data }));
      }
    }

    const prices = book(store).map(e => e.price);
    expect([...prices].sort((x, y) => y - x)).toEqual(prices);
  });

  it('carries no zero-size levels once applied', () => {
    const store = makeStore();
    for (const frame of FRAMES) {
      if (frame.type === 'order_book_delta') {
        store.dispatch(applyDelta({ symbol: 'AAPL', delta: frame.data }));
      }
    }

    // size 0 means "this level is gone", not "a level with nothing on it".
    expect(book(store).filter(e => e.size === 0)).toEqual([]);
  });

  it('arrives with contiguous sequence numbers', () => {
    const deltas = FRAMES.filter(f => f.type === 'order_book_delta');
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i].sequence).toBe(deltas[i - 1].sequence + 1);
    }
  });
});
