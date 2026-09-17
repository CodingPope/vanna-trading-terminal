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
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Snapshot HTTP ${res.status}`);
      return SnapshotSchema.parse(await res.json());
    } catch (err) {
      // Expected in demo/dev mode without a backend
      console.info('[Snapshot] No backend available, using mock data:', (err as Error).message);
      return null;
    }
  }
}
