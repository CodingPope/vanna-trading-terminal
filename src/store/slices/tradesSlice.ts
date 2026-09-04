import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Trade } from '@/types';

/**
 * Time & sales, per symbol.
 *
 * The tape used to be generated inside TradesPanel with `Math.random()` on
 * every price tick — so the "trades" on screen were invented by the component
 * displaying them, and stayed invented even when connected to a backend. This
 * holds prints from whichever feed is running; the panel now only renders.
 */

/**
 * Prints kept per symbol.
 *
 * A tape is unbounded by nature and the panel shows a screenful, so this is
 * capped rather than grown forever — the same reason `CircularBuffer` exists
 * in services/buffers.ts, though Redux state wants plain arrays rather than a
 * class instance.
 */
export const MAX_TRADES_PER_SYMBOL = 200;

export interface TradesSliceState {
  bySymbol: Record<string, Trade[]>;
}

const initialState: TradesSliceState = { bySymbol: {} };

export const tradesSlice = createSlice({
  name: 'trades',
  initialState,
  reducers: {
    /** Replace the tape — a snapshot backfill, or a symbol switch. */
    setTrades(state, action: PayloadAction<{ symbol: string; trades: Trade[] }>) {
      state.bySymbol[action.payload.symbol] =
        action.payload.trades.slice(0, MAX_TRADES_PER_SYMBOL);
    },

    /** Prepend new prints, newest first, trimming the tail. */
    addTrades(state, action: PayloadAction<{ symbol: string; trades: Trade[] }>) {
      const { symbol, trades } = action.payload;
      if (!trades.length) return;
      // Newest first: the panel reads top-down and the freshest print belongs
      // at the top, which is also how a real tape scrolls.
      const incoming = [...trades].reverse();
      const existing = state.bySymbol[symbol] ?? [];
      state.bySymbol[symbol] = [...incoming, ...existing].slice(0, MAX_TRADES_PER_SYMBOL);
    },

    clearTrades(state, action: PayloadAction<string>) {
      delete state.bySymbol[action.payload];
    },
  },
});

export const { setTrades, addTrades, clearTrades } = tradesSlice.actions;
export default tradesSlice.reducer;
