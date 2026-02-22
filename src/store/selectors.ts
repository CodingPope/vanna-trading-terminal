import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from './store';
import type { OrderBookEntry } from '@/types';

// ── Market ──────────────────────────────────────────────────────────────────

export const selectAllMarketEntities = (state: RootState) => state.market.entities;
export const selectSelectedSymbol = (state: RootState) => state.market.selectedSymbol;
export const selectCurrentPhase = (state: RootState) => state.market.currentPhase;
export const selectMarketRegime = (state: RootState) => state.market.marketRegime;
export const selectStats = (state: RootState) => state.market.stats;
export const selectIsConnected = (state: RootState) => state.market.isConnected;
export const selectAllCandlesticks = (state: RootState) => state.market.candlesticks;

/** Memoized per-symbol market data. */
export const selectMarketData = createSelector(
  [selectAllMarketEntities, (_: RootState, symbol: string) => symbol],
  (entities, symbol) => entities[symbol]
);

/** Memoized bid/ask spread for a symbol. */
export const selectSpread = createSelector(
  [selectAllMarketEntities, (_: RootState, symbol: string) => symbol],
  (entities, symbol) => {
    const d = entities[symbol];
    return d ? Number((d.ask - d.bid).toFixed(4)) : 0;
  }
);

/** Memoized candlestick array for a symbol. */
export const selectCandlesticks = createSelector(
  [selectAllCandlesticks, (_: RootState, symbol: string) => symbol],
  (candlesticks, symbol) => candlesticks[symbol] ?? []
);

// ── Order Book ───────────────────────────────────────────────────────────────

export const selectAllOrderBooks = (state: RootState) => state.orderBook.books;

/** Full order book (bids + asks) for a symbol, sorted descending by price. */
export const selectOrderBook = createSelector(
  [selectAllOrderBooks, (_: RootState, symbol: string) => symbol],
  (books, symbol) => books[symbol] ?? []
);

export const selectBids = createSelector(
  [selectOrderBook],
  (book): OrderBookEntry[] => book.filter(e => e.side === 'bid')
);

export const selectAsks = createSelector(
  [selectOrderBook],
  (book): OrderBookEntry[] => book.filter(e => e.side === 'ask')
);

// ── Positions ────────────────────────────────────────────────────────────────

export const selectPositions = (state: RootState) => state.positions.positions;
export const selectFocusList = (state: RootState) => state.positions.focusList;

/** Memoized total unrealized PnL across all open positions. */
export const selectUnrealizedPnL = createSelector(
  selectPositions,
  (positions) => positions.reduce((acc, p) => acc + p.pnl, 0)
);

/** Memoized positions filtered by symbol. */
export const selectPositionsForSymbol = createSelector(
  [selectPositions, (_: RootState, symbol: string) => symbol],
  (positions, symbol) => positions.filter(p => p.symbol === symbol)
);

// ── Panels ───────────────────────────────────────────────────────────────────

export const selectPanels = (state: RootState) => state.panels.panels;
export const selectWorkspaces = (state: RootState) => state.panels.workspaces;
export const selectCurrentWorkspaceId = (state: RootState) => state.panels.currentWorkspaceId;
export const selectAlerts = (state: RootState) => state.panels.alerts;

export const selectCurrentWorkspace = createSelector(
  [selectWorkspaces, selectCurrentWorkspaceId],
  (workspaces, currentId) => workspaces.find(w => w.id === currentId) ?? null
);
