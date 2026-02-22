import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { OrderBookEntry } from '@/types';
import { SYMBOLS, generateMockOrderBook } from '../mockData';

const initBooks: Record<string, OrderBookEntry[]> = {};
SYMBOLS.forEach((s, i) => { initBooks[s] = generateMockOrderBook(100 + i * 5); });

export interface OrderBookSliceState {
  books: Record<string, OrderBookEntry[]>;
}

const initialState: OrderBookSliceState = { books: initBooks };

export const orderBookSlice = createSlice({
  name: 'orderBook',
  initialState,
  reducers: {
    setOrderBook(state, action: PayloadAction<{ symbol: string; entries: OrderBookEntry[] }>) {
      state.books[action.payload.symbol] = action.payload.entries;
    },
    /** Apply a delta update (size=0 means remove the level). */
    applyDelta(state, action: PayloadAction<{ symbol: string; delta: OrderBookEntry[] }>) {
      const book = [...(state.books[action.payload.symbol] ?? [])];

      action.payload.delta.forEach(entry => {
        const idx = book.findIndex(e => e.price === entry.price && e.side === entry.side);
        if (entry.size === 0) {
          if (idx !== -1) book.splice(idx, 1);
        } else if (idx !== -1) {
          book[idx] = entry;
        } else {
          book.push(entry);
        }
      });

      // Sort all descending by price (bids desc first, then asks)
      book.sort((a, b) => b.price - a.price);

      // Recalculate running totals
      let bidTotal = 0;
      let askTotal = 0;
      book.forEach(e => {
        if (e.side === 'bid') { bidTotal += e.size; e.total = bidTotal; }
        else { askTotal += e.size; e.total = askTotal; }
      });

      state.books[action.payload.symbol] = book;
    },
  },
});

export const { setOrderBook, applyDelta } = orderBookSlice.actions;
export default orderBookSlice.reducer;
