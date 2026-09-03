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

  /**
   * Adopt the sequence a REST snapshot was taken at.
   *
   * Without this the `sequences` map in the snapshot response is decoration:
   * the client would hold a book from the snapshot but expect deltas to start
   * at 1, so the first genuine delta would read as a gap and immediately throw
   * the book away it had just fetched.
   */
  seedSequences(sequences: Record<string, number>): void {
    for (const [symbol, sequence] of Object.entries(sequences)) {
      this.sequences.set(symbol, sequence);
    }
  }

  resetSequence(symbol: string): void { this.sequences.delete(symbol); }
  resetAll(): void { this.sequences.clear(); }
}
