/**
 * Live feed: REST snapshot, then WebSocket deltas.
 *
 * Order matters and is not arbitrary. An order book cannot be rebuilt from an
 * update stream alone — deltas describe change against a state you are assumed
 * to already hold — so the snapshot has to land first, and the sequence numbers
 * it carries have to be adopted before the first delta arrives. Skip that and
 * the first delta reads as a gap against an expected sequence of 1, and the
 * client throws away the book it just fetched.
 *
 * If no backend answers, this reports failure and the caller falls back to the
 * simulation. That keeps the app runnable standalone, which matters for a
 * deployed demo where the front end may be the only thing running.
 */
import type { AppDispatch } from './store';
import { batchUpdateMarketData, updateCandlesticks, setConnected } from './slices/marketSlice';
import { setOrderBook } from './slices/orderBookSlice';
import { WebSocketClient } from '@/services/websocket';
import { SnapshotService } from '@/services/snapshotService';

export interface LiveFeedHandle {
  client: WebSocketClient;
  stop: () => void;
}

/** Same-origin by default: nginx proxies /api and /ws to the market data service. */
function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * Attempt to start the live feed.
 *
 * Resolves to a handle when a backend answered, or null when none did — the
 * caller decides what to do about it rather than this silently substituting
 * data, which is how "no backend, using mock data" ends up in a console log
 * nobody reads.
 */
export async function startLiveFeed(
  dispatch: AppDispatch,
  symbols: string[],
): Promise<LiveFeedHandle | null> {
  const snapshot = await new SnapshotService().fetchSnapshot(symbols);
  if (!snapshot) return null;

  // Hydrate from the snapshot before a single delta is applied.
  const quotes = Object.values(snapshot.marketData ?? {});
  if (quotes.length) dispatch(batchUpdateMarketData(quotes));

  for (const [symbol, entries] of Object.entries(snapshot.orderBooks ?? {})) {
    dispatch(setOrderBook({ symbol, entries }));
  }

  for (const [symbol, data] of Object.entries(snapshot.candlesticks ?? {})) {
    dispatch(updateCandlesticks({ symbol, data }));
  }

  const client = new WebSocketClient({ url: socketUrl(), dispatch });
  // Adopt the snapshot's sequences *before* connecting, so no delta can arrive
  // against an unseeded handler.
  client.seedSequences(snapshot.sequences ?? {});
  client.connect();

  return {
    client,
    stop: () => {
      client.destroy();
      dispatch(setConnected(false));
    },
  };
}
