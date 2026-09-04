/**
 * Cross-language contract test.
 *
 * The server is Python and the client is TypeScript, so the two model layers
 * can drift apart silently — nothing in either build fails when a Pydantic
 * model gains a field the Zod schema does not know about, or when a number
 * becomes a string on the wire. The first sign is a runtime rejection in the
 * browser, usually as a panel that mysteriously stops updating.
 *
 * `server-samples.json` is captured from the running FastAPI server (see
 * server/README.md). Validating it against the same Zod schemas the app uses
 * turns that class of drift into a failing test instead of a support ticket.
 *
 * Regenerate the fixture whenever the wire format changes.
 */
import { describe, it, expect } from 'vitest';
import {
  WsMessageSchema,
  MarketDataSchema,
  OrderBookEntrySchema,
  TradeSchema,
  PositionSchema,
} from '../index';
import samples from './server-samples.json';

const messages = samples.messages as unknown[];

describe('server messages satisfy the client schemas', () => {
  it('captured every message type the client handles', () => {
    const types = messages.map(m => (m as { type: string }).type).sort();
    expect(types).toEqual([
      'market_data',
      'order_book_delta',
      'order_book_snapshot',
      'pong',
      'trade',
    ]);
  });

  it.each(
    messages.map(m => [(m as { type: string }).type, m] as const)
  )('%s parses', (_type, message) => {
    const result = WsMessageSchema.safeParse(message);
    if (!result.success) {
      throw new Error(
        `server frame rejected by client schema:\n${JSON.stringify(result.error.issues, null, 2)}`
      );
    }
    expect(result.success).toBe(true);
  });
});

describe('snapshot response satisfies the client schemas', () => {
  const snapshot = samples.snapshot as {
    marketData: Record<string, unknown>;
    orderBooks: Record<string, unknown[]>;
    candlesticks: Record<string, unknown[]>;
    sequences: Record<string, number>;
  };

  it('carries the keys SnapshotService expects', () => {
    expect(Object.keys(snapshot).sort()).toEqual([
      'candlesticks',
      'marketData',
      'orderBooks',
      'positions',
      'sequences',
      'trades',
    ]);
  });

  it('backfills the tape so the panel is not empty on first paint', () => {
    const trades = (samples.snapshot as { trades: Record<string, unknown[]> }).trades;
    for (const [symbol, prints] of Object.entries(trades)) {
      expect(prints.length, `${symbol} tape`).toBeGreaterThan(0);
      for (const print of prints) {
        const result = TradeSchema.safeParse(print);
        if (!result.success) {
          throw new Error(`${symbol}: ${JSON.stringify(result.error.issues)}`);
        }
      }
    }
  });

  it('carries an open position book that parses', () => {
    const positions = (samples.snapshot as { positions: unknown[] }).positions;
    expect(positions.length).toBeGreaterThan(0);
    for (const position of positions) {
      const result = PositionSchema.safeParse(position);
      if (!result.success) {
        throw new Error(JSON.stringify(result.error.issues));
      }
    }
  });

  it('every quote parses', () => {
    for (const [symbol, quote] of Object.entries(snapshot.marketData)) {
      const result = MarketDataSchema.safeParse(quote);
      if (!result.success) {
        throw new Error(`${symbol}: ${JSON.stringify(result.error.issues)}`);
      }
    }
  });

  it('every order book level parses', () => {
    for (const [symbol, book] of Object.entries(snapshot.orderBooks)) {
      expect(book.length).toBeGreaterThan(0);
      for (const level of book) {
        const result = OrderBookEntrySchema.safeParse(level);
        if (!result.success) {
          throw new Error(`${symbol}: ${JSON.stringify(result.error.issues)}`);
        }
      }
    }
  });

  it('quotes a sequence for every symbol it quotes a book for', () => {
    // Without this pairing the client cannot tell a gap from a fresh start,
    // which is the whole basis of snapshot-then-delta.
    expect(Object.keys(snapshot.sequences).sort())
      .toEqual(Object.keys(snapshot.orderBooks).sort());
  });

  it('books are sorted best-bid-down, so asks sit above bids', () => {
    for (const book of Object.values(snapshot.orderBooks)) {
      const levels = book as Array<{ price: number; side: string }>;
      const prices = levels.map(l => l.price);
      expect([...prices].sort((a, b) => b - a)).toEqual(prices);

      const bestBid = Math.max(...levels.filter(l => l.side === 'bid').map(l => l.price));
      const bestAsk = Math.min(...levels.filter(l => l.side === 'ask').map(l => l.price));
      expect(bestAsk).toBeGreaterThan(bestBid);
    }
  });
});
