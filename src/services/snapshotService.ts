import { paperSession } from './paper';
import { SnapshotSchema } from '@/schemas';
import type { z } from 'zod';
type SnapshotResponse = z.infer<typeof SnapshotSchema>;

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
      // 12s, not 5s. The hydration snapshot carries books, candle history and
      // tape for every requested symbol, and on a throttled first load it was
      // taking longer than five seconds — so a slow connection silently became
      // a local simulation. A missing backend still fails fast, because the
      // connection is refused rather than left hanging.
      const res = await fetch(url, { headers: { 'X-Paper-Session': paperSession() }, signal: AbortSignal.timeout(12_000) });
      if (!res.ok) throw new Error(`Snapshot HTTP ${res.status}`);
      return SnapshotSchema.parse(await res.json());
    } catch (err) {
      // Expected in demo/dev mode without a backend
      console.info('[Snapshot] No backend available, using mock data:', (err as Error).message);
      return null;
    }
  }
}
