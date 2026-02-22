import type { AppDispatch } from '@/store/store';
import { setOrderBook, applyDelta } from '@/store/slices/orderBookSlice';
import type { OrderBookEntry } from '@/types';

/**
 * Handles order book snapshot and delta messages with sequence number validation.
 * Detects out-of-order deltas and signals the caller to request a re-snapshot.
 */
export class OrderBookHandler {
  private readonly sequences = new Map<string, number>();
  private readonly dispatch: AppDispatch;

  constructor(dispatch: AppDispatch) {
    this.dispatch = dispatch;
  }

  /** Apply a full snapshot — replaces the current order book for the symbol. */
  handleSnapshot(symbol: string, entries: OrderBookEntry[], sequence: number): void {
    this.sequences.set(symbol, sequence);
    this.dispatch(setOrderBook({ symbol, entries }));
  }

  /**
   * Apply a delta update.
   * Returns false if the sequence number is out of order (caller should re-snapshot).
   */
  handleDelta(symbol: string, delta: OrderBookEntry[], sequence: number): boolean {
    const expected = (this.sequences.get(symbol) ?? 0) + 1;
    if (sequence !== expected) {
      console.warn(`[OrderBook] Out-of-order delta for ${symbol}: expected ${expected}, got ${sequence}`);
      return false;
    }
    this.sequences.set(symbol, sequence);
    this.dispatch(applyDelta({ symbol, delta }));
    return true;
  }

  resetSequence(symbol: string): void { this.sequences.delete(symbol); }
  resetAll(): void { this.sequences.clear(); }
}
