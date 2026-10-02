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
  side: z.enum(['buy', 'sell', 'unknown']),
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

// ── Replay control protocol (docs/PROTOCOL.md) ────────────────────────────────
// Nanosecond epochs need 61 bits; a JSON number carries 53. They cross the wire
// as decimal strings so replay time stays exact on both sides of the boundary.
export const NanosSchema = z.string().regex(/^\d+$/, 'nanoseconds must be decimal digits');
export const ReplaySpeedSchema = z.union([z.number().positive(), z.literal('max')]);
export type ReplaySpeed = z.infer<typeof ReplaySpeedSchema>;

export const ReplayStatusSchema = z.object({
  protocolVersion: z.number().int().positive(),
  fixtureId: z.string().min(1),
  mode: z.enum(['synthetic', 'replay', 'recorded']),
  unit: z.enum(['event', 'tick']),
  eventTimeNs: NanosSchema,
  startNs: NanosSchema,
  endNs: NanosSchema,
  speed: ReplaySpeedSchema,
  speeds: z.array(ReplaySpeedSchema).min(1),
  playing: z.boolean(),
  ended: z.boolean(),
  sequence: z.number().int().nonnegative(),
  generation: z.number().int().nonnegative(),
  canSeek: z.boolean(),
  canStep: z.boolean(),
});
export type ReplayStatus = z.infer<typeof ReplayStatusSchema>;

export const ReplayActionSchema = z.enum(['play', 'pause', 'speed', 'step', 'seek', 'reset']);
export type ReplayAction = z.infer<typeof ReplayActionSchema>;

export const ReplayAckSchema = z.object({
  commandId: z.string().min(1),
  action: ReplayActionSchema,
  accepted: z.boolean(),
  code: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  duplicate: z.boolean().default(false),
  status: ReplayStatusSchema,
});
export type ReplayAck = z.infer<typeof ReplayAckSchema>;

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
  source: z.enum(['synthetic', 'replay', 'recorded']).default('synthetic'),
  sessionDate: z.string().nullable().optional(),
  replay: ReplayStatusSchema.nullable().optional(),
  // The server sends the account alongside the market after a rebuild, so one
  // frame makes a client whole. Its shape is owned by the paper module there
  // and enforced here, which is the boundary that actually protects the UI.
  account: PaperAccountSchema.nullable().optional(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

// ── WebSocket messages (discriminated union on `type`) ────────────────────────
/** Server send stamp. `emittedNs` is the server's monotonic clock, not a wall
 *  clock, so it is only ever compared with another `emittedNs`. See
 *  docs/PERFORMANCE.md. */
export const FrameStampSchema = z.object({
  seq: z.number().int().positive(),
  emittedNs: NanosSchema,
});

const WsBase = {
  symbol: z.string().optional(), sequence: z.number().optional(),
  requestSnapshot: z.boolean().optional(), t: FrameStampSchema.optional(),
};

export const WsMessageSchema = z.discriminatedUnion('type', [
  z.object({ ...WsBase, type: z.literal('market_data'), data: MarketDataSchema }),
  z.object({ ...WsBase, type: z.literal('account_snapshot'), data: PaperAccountSchema }),
  z.object({ ...WsBase, type: z.literal('candle'), symbol: z.string(), data: CandleSchema }),
  z.object({ ...WsBase, type: z.literal('candle_snapshot'), symbol: z.string(), data: z.array(CandleSchema) }),
  z.object({ ...WsBase, type: z.literal('burst'), data: z.array(MarketDataSchema).max(1000) }),
  z.object({ ...WsBase, type: z.literal('order_book_snapshot'), symbol: z.string(), sequence: z.number().int().nonnegative(), data: z.array(OrderBookEntrySchema) }),
  z.object({ ...WsBase, type: z.literal('order_book_delta'), symbol: z.string(), sequence: z.number().int().nonnegative(), data: z.array(OrderBookEntrySchema) }),
  z.object({ ...WsBase, type: z.literal('position_update'), data: PositionSchema }),
  z.object({ ...WsBase, type: z.literal('trade'), symbol: z.string(), data: z.array(TradeSchema) }),
  z.object({ ...WsBase, type: z.literal('ping'), data: z.null() }),
  z.object({ ...WsBase, type: z.literal('pong'), data: z.null() }),
  z.object({ ...WsBase, type: z.literal('subscribe'), data: z.null() }),
  z.object({ ...WsBase, type: z.literal('error'), data: z.object({ message: z.string(), code: z.string().optional(), commandId: z.string().optional() }) }),
  z.object({ ...WsBase, type: z.literal('snapshot'), data: SnapshotSchema }),
  z.object({ ...WsBase, type: z.literal('replay_status'), data: ReplayStatusSchema }),
  z.object({ ...WsBase, type: z.literal('replay_ack'), data: ReplayAckSchema }),
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
