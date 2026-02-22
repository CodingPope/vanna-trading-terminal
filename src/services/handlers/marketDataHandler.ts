import type { AppDispatch } from '@/store/store';
import { batchUpdateMarketData } from '@/store/slices/marketSlice';
import type { MarketData } from '@/types';

/**
 * Batches incoming market data messages and dispatches them as a single
 * RTK action per animation frame (~60fps), reducing Redux overhead.
 */
export class MarketDataHandler {
  private pending: MarketData[] = [];
  private flushTimer: number | null = null;
  private readonly dispatch: AppDispatch;

  constructor(dispatch: AppDispatch) {
    this.dispatch = dispatch;
  }

  handle(data: MarketData): void {
    // Deduplicate: keep only the latest update per symbol
    const idx = this.pending.findIndex(d => d.symbol === data.symbol);
    if (idx !== -1) this.pending[idx] = data;
    else this.pending.push(data);

    if (!this.flushTimer) {
      this.flushTimer = requestAnimationFrame(() => this.flush());
    }
  }

  private flush(): void {
    if (this.pending.length > 0) {
      this.dispatch(batchUpdateMarketData([...this.pending]));
      this.pending = [];
    }
    this.flushTimer = null;
  }

  destroy(): void {
    if (this.flushTimer !== null) {
      cancelAnimationFrame(this.flushTimer);
      this.flushTimer = null;
    }
    this.pending = [];
  }
}
