import type { MarketData, OrderBookEntry, CandlestickData, Trade } from '@/types';

interface SnapshotResponse {
  marketData: Record<string, MarketData>;
  orderBooks: Record<string, OrderBookEntry[]>;
  candlesticks?: Record<string, CandlestickData[]>;
  trades?: Record<string, Trade[]>;
  sequences: Record<string, number>;
}

/**
 * Fetches a full market data snapshot from the REST API before WebSocket deltas begin.
 * Falls back gracefully when no backend is available (demo / development mode).
 */
export class SnapshotService {
  private readonly baseUrl: string;

  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl;
  }

  async fetchSnapshot(symbols: string[]): Promise<SnapshotResponse | null> {
    try {
      const url = `${this.baseUrl}/snapshot?symbols=${symbols.join(',')}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Snapshot HTTP ${res.status}`);
      return await res.json() as SnapshotResponse;
    } catch (err) {
      // Expected in demo/dev mode without a backend
      console.info('[Snapshot] No backend available, using mock data:', (err as Error).message);
      return null;
    }
  }
}
