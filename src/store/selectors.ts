import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from './store';
import type { OrderBookEntry, Trade } from '@/types';
import { computeMarketPulse, regimeFromPulse } from '@/lib/marketPulse';

// ── Market ──────────────────────────────────────────────────────────────────

export const selectAllMarketEntities = (state: RootState) => state.market.entities;
export const selectSelectedSymbol = (state: RootState) => state.market.selectedSymbol;
export const selectCurrentPhase = (state: RootState) => state.market.currentPhase;
/**
 * Live market state, computed from every quote on each change.
 *
 * `marketRegime` used to be a hardcoded object in the store that nothing ever
 * dispatched, so the header read "REGIME BULLISH" permanently and the orb's
 * shader uniforms were frozen constants. Deriving it means it cannot go stale
 * and there is no dispatch to forget.
 *
 * Scoped to the whole market. Making this the focus list instead is a matter
 * of filtering the entity list before it reaches computeMarketPulse.
 */
export const selectMarketPulse = createSelector(
  [selectAllMarketEntities],
  (entities) => computeMarketPulse(Object.values(entities))
);

/**
 * The same reading, narrowed to the focus list.
 *
 * Dispersion across twenty names and across the five you are actually watching
 * are different questions — the whole market can be calm while your names tear
 * apart. Which one the orb shows is a user setting.
 */
export const selectFocusPulse = createSelector(
  [selectAllMarketEntities, (state: RootState) => state.positions.focusList],
  (entities, focusList) => {
    const quotes = focusList
      .map(item => entities[item.symbol])
      .filter((q): q is NonNullable<typeof q> => Boolean(q));
    // Fall back to the whole market rather than showing an empty orb before
    // the focus list has been generated.
    return computeMarketPulse(quotes.length ? quotes : Object.values(entities));
  }
);

/** Text labels for the header and morning brief, from the same numbers. */
export const selectMarketRegime = createSelector(
  [selectMarketPulse],
  (pulse) => regimeFromPulse(pulse)
);
export const selectStats = (state: RootState) => state.market.stats;
export const selectIsConnected = (state: RootState) => state.market.isConnected;
export const selectFeedSource = (state: RootState) => state.market.feedSource;
export const selectAllCandlesticks = (state: RootState) => state.market.candlesticks;
export const selectLastUpdate = (state: RootState) => state.market.lastUpdate;

/**
 * Market data as a Map, for the few consumers that iterate or `.get()` across
 * every symbol. Memoized on the entities record, so the Map is rebuilt only
 * when market data actually changes — but note that is every tick, so prefer
 * `selectMarketData(state, symbol)` wherever a single symbol will do.
 */
export const selectMarketDataMap = createSelector(
  [selectAllMarketEntities],
  (entities) => new Map(Object.entries(entities))
);

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

// ── Trades ───────────────────────────────────────────────────────────────────

export const selectAllTrades = (state: RootState) => state.trades.bySymbol;

const EMPTY_TRADES: Trade[] = [];

/** Tape for a symbol. Stable empty array so an unknown symbol does not
 *  produce a new reference on every render. */
export const selectTrades = createSelector(
  [selectAllTrades, (_: RootState, symbol: string) => symbol],
  (bySymbol, symbol) => bySymbol[symbol] ?? EMPTY_TRADES
);

/** Buy/sell volume over the most recent prints — the tape bias meter. */
export const selectTapeBias = createSelector(
  [selectTrades],
  (trades) => {
    let buyVol = 0;
    let sellVol = 0;
    for (const t of trades.slice(0, 60)) {
      if (t.side === 'buy') buyVol += t.size;
      else sellVol += t.size;
    }
    return { buyVol, sellVol };
  }
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
