import { describe, it, expect } from 'vitest';
import {
  MarketDataSchema,
  OrderBookEntrySchema,
  AnaAnalysisSchema,
  AnaStreamChunkSchema,
  WsMessageSchema,
  PositionSchema,
  MarketRegimeSchema,
  PriceAlertSchema,
} from '../index';

// ── MarketDataSchema ───────────────────────────────────────────────────────────
describe('MarketDataSchema', () => {
  const valid = {
    symbol: 'AAPL', price: 182.5, change: 1.2, changePercent: 0.66,
    volume: 55_000_000, high: 184, low: 181, open: 181.5, close: 182.5,
    timestamp: Date.now(), bid: 182.49, ask: 182.51, bidSize: 200, askSize: 300,
  };

  it('accepts a valid market data object', () => {
    expect(MarketDataSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a negative price', () => {
    expect(MarketDataSchema.safeParse({ ...valid, price: -1 }).success).toBe(false);
  });

  it('rejects an empty symbol', () => {
    expect(MarketDataSchema.safeParse({ ...valid, symbol: '' }).success).toBe(false);
  });
});

// ── OrderBookEntrySchema ──────────────────────────────────────────────────────
describe('OrderBookEntrySchema', () => {
  it('accepts bid and ask entries', () => {
    expect(OrderBookEntrySchema.safeParse({ price: 100, size: 10, total: 10, side: 'bid' }).success).toBe(true);
    expect(OrderBookEntrySchema.safeParse({ price: 100, size: 10, total: 10, side: 'ask' }).success).toBe(true);
  });

  it('rejects an unknown side', () => {
    expect(OrderBookEntrySchema.safeParse({ price: 100, size: 10, total: 10, side: 'unknown' }).success).toBe(false);
  });
});

// ── AnaAnalysisSchema ─────────────────────────────────────────────────────────
describe('AnaAnalysisSchema', () => {
  const valid = {
    symbol: 'MSFT', setupType: 'breakout', triggerPrice: 420,
    invalidationLevel: 415, targetPrice: 430, regimeFit: 'strong',
    riskRewardRatio: 2.5, verdict: 'VALID', confidence: 85, notes: 'Clean setup',
  };

  it('accepts a valid analysis', () => {
    expect(AnaAnalysisSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects confidence outside 0-100', () => {
    expect(AnaAnalysisSchema.safeParse({ ...valid, confidence: 110 }).success).toBe(false);
    expect(AnaAnalysisSchema.safeParse({ ...valid, confidence: -5 }).success).toBe(false);
  });

  it('rejects invalid verdict', () => {
    expect(AnaAnalysisSchema.safeParse({ ...valid, verdict: 'MAYBE' }).success).toBe(false);
  });
});

// ── AnaStreamChunkSchema ──────────────────────────────────────────────────────
describe('AnaStreamChunkSchema', () => {
  it('accepts token chunk', () => {
    expect(AnaStreamChunkSchema.safeParse({ type: 'token', content: 'Breaking out...' }).success).toBe(true);
  });

  it('accepts done chunk', () => {
    expect(AnaStreamChunkSchema.safeParse({ type: 'done' }).success).toBe(true);
  });

  it('accepts error chunk', () => {
    expect(AnaStreamChunkSchema.safeParse({ type: 'error', message: 'timeout' }).success).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(AnaStreamChunkSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });
});

// ── WsMessageSchema ───────────────────────────────────────────────────────────
describe('WsMessageSchema', () => {
  it('accepts a ping message', () => {
    expect(WsMessageSchema.safeParse({ type: 'ping', data: null }).success).toBe(true);
  });

  it('accepts a subscribe message', () => {
    expect(WsMessageSchema.safeParse({ type: 'subscribe', symbol: 'AAPL', data: null }).success).toBe(true);
  });

  it('rejects an unknown message type', () => {
    expect(WsMessageSchema.safeParse({ type: 'unknown', data: null }).success).toBe(false);
  });
});

// ── PositionSchema ────────────────────────────────────────────────────────────
describe('PositionSchema', () => {
  it('accepts long and short sides', () => {
    const base = { symbol: 'NVDA', size: 100, entryPrice: 800, currentPrice: 850, pnl: 5000, pnlPercent: 6.25 };
    expect(PositionSchema.safeParse({ ...base, side: 'long' }).success).toBe(true);
    expect(PositionSchema.safeParse({ ...base, side: 'short' }).success).toBe(true);
  });
});

// ── MarketRegimeSchema ────────────────────────────────────────────────────────
describe('MarketRegimeSchema', () => {
  it('accepts a valid regime', () => {
    expect(MarketRegimeSchema.safeParse({ trend: 'bullish', volatility: 'low', breadth: 'strong', sentiment: 'greed' }).success).toBe(true);
  });

  it('rejects invalid enum values', () => {
    expect(MarketRegimeSchema.safeParse({ trend: 'sideways', volatility: 'low', breadth: 'strong', sentiment: 'greed' }).success).toBe(false);
  });
});

// ── PriceAlertSchema ──────────────────────────────────────────────────────────
describe('PriceAlertSchema', () => {
  it('accepts a valid alert', () => {
    expect(PriceAlertSchema.safeParse({ id: 'al_1', symbol: 'SPY', price: 500, createdAt: Date.now(), triggered: false }).success).toBe(true);
  });

  it('note is optional', () => {
    expect(PriceAlertSchema.safeParse({ id: 'al_2', symbol: 'QQQ', price: 450, createdAt: Date.now(), triggered: true, note: 'breakout' }).success).toBe(true);
  });
});
