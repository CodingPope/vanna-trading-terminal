import type { AppDispatch } from '@/store/store';
import { addTrades } from '@/store/slices/tradesSlice';
import type { Trade } from '@/types';

/**
 * Batches incoming prints and dispatches once per animation frame.
 *
 * A tape produces far more messages than a book — several prints per tick per
 * symbol — so dispatching each one would put twenty-odd store writes per frame
 * through the reducer for no visible benefit. Same reasoning as
 * MarketDataHandler, minus the dedup: unlike a quote, a print is not
 * superseded by the next one. Every trade happened, and dropping one falsifies
 * the tape bias.
 */
export class TradeHandler {
  private pending = new Map<string, Trade[]>();
  private readonly dispatch: AppDispatch;

  constructor(dispatch: AppDispatch) {
    this.dispatch = dispatch;
  }

  handle(symbol: string, trades: Trade[]): void {
    if (!trades.length) return;
    const queued = this.pending.get(symbol);
    if (queued) queued.push(...trades);
    else this.pending.set(symbol, [...trades]);
  }

  /** Called by the socket client at the end of its frame drain. */
  flush(): void {
    if (!this.pending.size) return;
    for (const [symbol, trades] of this.pending) {
      this.dispatch(addTrades({ symbol, trades }));
    }
    this.pending.clear();
  }

  destroy(): void {
    this.pending.clear();
  }
}
