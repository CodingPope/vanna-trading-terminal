/**
 * Zod schemas for all API boundaries.
 * Types are derived via z.infer so they stay in sync with schemas automatically.
 */
import { z } from 'zod';
import { PaperAccountSchema } from './paper';

// ── Market Data ───────────────────────────────────────────────────────────────
export const MarketDataSchema = z.object({
  symbol: z.string().min(1).max(10),
  price: z.number().positive(),
  change: z.number(),
  changePercent: z.number(),
  volume: z.number().nonnegative(),
  high: z.number().positive(),
  low: z.number().positive(),
  open: z.number().positive(),
  close: z.number().positive(),
  timestamp: z.number().positive(),
  bid: z.number().positive(),
  ask: z.number().positive(),
  bidSize: z.number().nonnegative(),
  askSize: z.number().nonnegative(),
});

// ── Order Book ────────────────────────────────────────────────────────────────
export const OrderBookEntrySchema = z.object({
  price: z.number().positive(),
  size: z.number().nonnegative(),
  total: z.number().nonnegative(),
  side: z.enum(['bid', 'ask']),
});

// ── Trades (time & sales) ─────────────────────────────────────────────────────
export const TradeSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1).max(10),
  price: z.number().positive(),
  size: z.number().positive(),
  side: z.enum(['buy', 'sell']),
  timestamp: z.number().positive(),
});

// ── ANA Analysis ──────────────────────────────────────────────────────────────
export const AnaVerdictSchema = z.enum(['VALID', 'NO_TRADE', 'STANDBY']);

export const AnaAnalysisSchema = z.object({
  symbol: z.string().min(1),
  setupType: z.enum(['breakout', 'pullback', 'reversal', 'continuation', 'range']),
  triggerPrice: z.number().positive(),
  invalidationLevel: z.number().positive(),
  targetPrice: z.number().positive(),
  regimeFit: z.enum(['strong', 'moderate', 'weak']),
  riskRewardRatio: z.number().positive(),
  verdict: AnaVerdictSchema,
  confidence: z.number().min(0).max(100),
  notes: z.string(),
});

// ── ANA SSE stream chunks (discriminated union on `type`) ─────────────────────
export const AnaStreamChunkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), content: z.string() }),
  z.object({ type: z.literal('analysis'), data: AnaAnalysisSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('done') }),
]);
export type AnaStreamChunk = z.infer<typeof AnaStreamChunkSchema>;

// ── Positions ─────────────────────────────────────────────────────────────────
export const PositionSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(['long', 'short']),
  size: z.number().positive(),
  entryPrice: z.number().positive(),
  currentPrice: z.number().positive(),
  pnl: z.number(),
  pnlPercent: z.number(),
});

export const CandleSchema = z.object({
  time: z.number().positive(), open: z.number().positive(), high: z.number().positive(),
  low: z.number().positive(), close: z.number().positive(), volume: z.number().nonnegative(),
});
export const SnapshotSchema = z.object({
  marketData: z.record(z.string(), MarketDataSchema),
  orderBooks: z.record(z.string(), z.array(OrderBookEntrySchema)),
  candlesticks: z.record(z.string(), z.array(CandleSchema)).optional(),
  trades: z.record(z.string(), z.array(TradeSchema)).optional(),
  positions: z.array(PositionSchema).optional(),
  sequences: z.record(z.string(), z.number().int().nonnegative()),
  source: z.enum(['synthetic', 'replay']).default('synthetic'),
  sessionDate: z.string().nullable().optional(),
});

// ── WebSocket messages (discriminated union on `type`) ────────────────────────
const WsBase = { symbol: z.string().optional(), sequence: z.number().optional(), requestSnapshot: z.boolean().optional() };

export const WsMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...WsBase, type: z.literal('market_data'), data: MarketDataSchema }),
  z.object({ type: z.literal('account_snapshot'), data: PaperAccountSchema }),
  z.object({ type: z.literal('candle'), symbol: z.string(), data: CandleSchema }),
  z.object({ type: z.literal('candle_snapshot'), symbol: z.string(), data: z.array(CandleSchema) }),
  z.object({ type: z.literal('burst'), data: z.array(MarketDataSchema).max(1000) }),
  z.object({ ...WsBase, type: z.literal('order_book_snapshot'), symbol: z.string(), sequence: z.number().int().nonnegative(), data: z.array(OrderBookEntrySchema) }),
  z.object({ ...WsBase, type: z.literal('order_book_delta'), symbol: z.string(), sequence: z.number().int().nonnegative(), data: z.array(OrderBookEntrySchema) }),
  z.object({ ...WsBase, type: z.literal('position_update'), data: PositionSchema }),
  z.object({ ...WsBase, type: z.literal('trade'), symbol: z.string(), data: z.array(TradeSchema) }),
  z.object({ ...WsBase, type: z.literal('ping'), data: z.null() }),
  z.object({ ...WsBase, type: z.literal('pong'), data: z.null() }),
  z.object({ ...WsBase, type: z.literal('subscribe'), data: z.null() }),
  z.object({ ...WsBase, type: z.literal('error'), data: z.object({ message: z.string() }) }),
]);
export type WsMessageValidated = z.infer<typeof WsMessageSchema>;

// ── Market Regime ─────────────────────────────────────────────────────────────
export const MarketRegimeSchema = z.object({
  trend: z.enum(['bullish', 'bearish', 'neutral']),
  volatility: z.enum(['high', 'medium', 'low']),
  breadth: z.enum(['strong', 'weak', 'mixed']),
  sentiment: z.enum(['greed', 'fear', 'neutral']),
});

// ── Price Alert ───────────────────────────────────────────────────────────────
export const PriceAlertSchema = z.object({
  id: z.string(),
  symbol: z.string().min(1),
  price: z.number().positive(),
  note: z.string().optional(),
  createdAt: z.number(),
  triggered: z.boolean(),
});
