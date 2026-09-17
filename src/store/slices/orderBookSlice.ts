import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { OrderBookEntry } from '@/types';
import { SYMBOLS, generateMockOrderBook } from '../mockData';

const initBooks: Record<string, OrderBookEntry[]> = {};
SYMBOLS.forEach((s, i) => { initBooks[s] = generateMockOrderBook(100 + i * 5); });

export interface OrderBookSliceState {
  books: Record<string, OrderBookEntry[]>;
  recovering: Record<string, boolean>;
}

const initialState: OrderBookSliceState = { books: initBooks, recovering: {} };

export const orderBookSlice = createSlice({
  name: 'orderBook',
  initialState,
  reducers: {
    setBookRecovering(state, action: PayloadAction<string>) { state.recovering[action.payload] = true; },
    setOrderBook(state, action: PayloadAction<{ symbol: string; entries: OrderBookEntry[] }>) {
      state.books[action.payload.symbol] = action.payload.entries;
      state.recovering[action.payload.symbol] = false;
    },
    /** Apply a delta update (size=0 means remove the level). */
    applyDelta(state, action: PayloadAction<{ symbol: string; delta: OrderBookEntry[] }>) {
      const book = [...(state.books[action.payload.symbol] ?? [])];

      action.payload.delta.forEach(entry => {
        const idx = book.findIndex(e => e.price === entry.price && e.side === entry.side);
        if (entry.size === 0) {
          // size 0 means the level is gone, not a level holding nothing.
          if (idx !== -1) book.splice(idx, 1);
        } else if (idx !== -1) {
          // Copy rather than adopt the caller's object: `total` is recomputed
          // below, so storing the reference would mutate a value the caller
          // still owns — and throws outright if it happens to be frozen.
          book[idx] = { ...entry };
        } else {
          book.push({ ...entry });
        }
      });

      // Sort all descending by price (bids desc first, then asks)
      book.sort((a, b) => b.price - a.price);

      // Recalculate running totals
      for (const side of ['bid', 'ask'] as const) {
        let total = 0;
        const levels = book.filter(e => e.side === side);
        if (side === 'ask') levels.reverse();
        levels.forEach(e => { total += e.size; e.total = total; });
      }

      state.books[action.payload.symbol] = book;
    },
  },
});

export const { setOrderBook, applyDelta, setBookRecovering } = orderBookSlice.actions;
export default orderBookSlice.reducer;
