import type { AppDispatch } from '@/store/store';
import { setConnected, setStats, setDiagnostics, setMeasurements, upsertCandle, updateCandlesticks } from '@/store/slices/marketSlice';
import { setBookRecovering } from '@/store/slices/orderBookSlice';
import { receiveAccount, invalidateAccount } from '@/store/slices/paperSlice';
import { receiveStatus, receiveAck, feedLost } from '@/store/slices/replaySlice';
import { MarketDataHandler } from './handlers/marketDataHandler';
import { OrderBookHandler } from './handlers/orderBookHandler';
import { TradeHandler } from './handlers/tradeHandler';
import { BackpressureQueue } from './buffers';
import { WsMessageSchema, type WsMessageValidated } from '@/schemas';
import { FeedTelemetry, type TelemetrySnapshot } from '@/lib/telemetry';
import { LongTaskCounter } from '@/lib/longTasks';

/** Prints merged into one queued frame before the merge is refused. */
const TAPE_MERGE_LIMIT = 500;

export interface WsMessage {
  type: string; symbol?: string; sequence?: number; requestSnapshot?: boolean; data: unknown;
}
interface WebSocketClientOptions {
  url: string; dispatch: AppDispatch; onMessage?: (msg: WsMessage) => void;
  maxRetries?: number; heartbeatIntervalMs?: number; queueCapacity?: number;
  /** Off makes the client's own measurement cost quantifiable. */
  telemetry?: boolean;
}

/** FIFO application order, bounded buffering, validated messages, explicit recovery. */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private readonly options: WebSocketClientOptions;
  private retryCount = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private latencyStart = 0;
  private lastPongAt = 0;
  private drainHandle: number | null = null;
  private readonly market: MarketDataHandler;
  private readonly book: OrderBookHandler;
  private readonly trades: TradeHandler;
  private readonly queue: BackpressureQueue<WsMessageValidated>;
  private recovering = new Map<string, { sequence: number; since: number }>();
  private readonly telemetry = new FeedTelemetry();
  /** When each queued frame arrived, keyed by the frame itself. */
  private readonly arrivals = new WeakMap<object, number>();
  private lastDrainAt = 0;
  private readonly longTasks = new LongTaskCounter();
  /** Envelope count at the last sampling window, for the event rate. */
  private rateMark = { received: 0, at: 0 };
  /** Event time of the latest market frame applied, in replay milliseconds. */
  private lastEventMs = 0;
  private counters = { received: 0, invalid: 0, dropped: 0, gaps: 0, reconnects: 0, queueDepth: 0, peakQueue: 0, processingMs: 0, coalesced: 0 };

  constructor(options: WebSocketClientOptions) {
    this.options = options;
    this.market = new MarketDataHandler(options.dispatch);
    this.book = new OrderBookHandler(options.dispatch);
    this.trades = new TradeHandler(options.dispatch);
    this.queue = new BackpressureQueue(options.queueCapacity ?? 250);
  }
  get droppedMessages() { return this.queue.dropped; }
  /** Current measurements. See docs/PERFORMANCE.md for what each one means. */
  get measurements(): TelemetrySnapshot { return this.telemetry.snapshot(); }

  /** Clears every counter a reader might be looking at, and says so upstream. */
  resetMeasurements() {
    this.telemetry.reset();
    this.longTasks.reset();
    this.counters.reconnects = 0;
    this.counters.gaps = 0;
    this.counters.invalid = 0;
    this.queue.resetDropped();
    this.rateMark = { received: this.counters.received, at: performance.now() };
    this.options.dispatch(setMeasurements(null));
  }

  private report() {
    const now = performance.now();
    const elapsed = (now - this.rateMark.at) / 1000;
    const eventRate = elapsed > 0 ? (this.counters.received - this.rateMark.received) / elapsed : 0;
    this.rateMark = { received: this.counters.received, at: now };
    this.options.dispatch(setMeasurements({
      ...this.telemetry.snapshot(),
      eventRate: Math.round(eventRate * 10) / 10,
      longTasks: this.longTasks.observing ? this.longTasks.count : null,
      longTaskMs: this.longTasks.observing ? Math.round(this.longTasks.totalMs) : null,
      reconnects: this.counters.reconnects,
      droppedDisplay: this.queue.dropped,
      bookGaps: this.counters.gaps,
      windowSize: this.telemetry.transportJitterMs.capacity,
    }));
  }
  seedSequences(sequences: Record<string, number>) { this.book.seedSequences(sequences); }

  connect(): void {
    if (this.destroyed) return;
    let ws: WebSocket;
    try { ws = new WebSocket(this.options.url); }
    catch { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      if (this.destroyed || this.ws !== ws) return;
      this.retryCount = 0;
      this.options.dispatch(setConnected(true));
      this.lastPongAt = Date.now();
      this.startTimers();
    };
    ws.onmessage = event => {
      if (this.destroyed || this.ws !== ws) return;
      this.counters.received++;
      const receivedAt = performance.now();
      try {
        const result = WsMessageSchema.safeParse(JSON.parse(event.data as string));
        if (!result.success) { this.counters.invalid++; return; }
        const message = result.data;
        if (this.options.telemetry !== false) {
          this.telemetry.observe(message.t, receivedAt);
          this.arrivals.set(message, receivedAt);
        }
        if (message.type === 'burst') {
          for (const data of message.data) this.enqueue({ type: 'market_data', data });
          this.counters.received += message.data.length;
        } else this.enqueue(message);
        this.options.onMessage?.(message);
      } catch { this.counters.invalid++; }
    };
    ws.onclose = () => {
      if (this.destroyed || this.ws !== ws) return;
      this.disconnected();
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* WebSocket follows errors with close. */ };
  }

  private disconnected() {
    this.options.dispatch(setConnected(false));
    this.options.dispatch(invalidateAccount());
    this.options.dispatch(feedLost());
    this.stopTimers();
    if (this.drainHandle !== null) cancelAnimationFrame(this.drainHandle);
    this.drainHandle = null;
    this.queue.drainAll();
    this.telemetry.reset();
    this.lastDrainAt = 0;
    this.lastEventMs = 0;
    this.market.destroy();
    this.trades.destroy();
    this.book.resetAll();
    this.recovering.clear();
  }

  private recover(symbol: string, sequence: number) {
    const pending = this.recovering.get(symbol);
    if (pending) { pending.sequence = Math.max(pending.sequence, sequence); return; }
    this.recovering.set(symbol, { sequence, since: Date.now() });
    this.counters.gaps++;
    this.options.dispatch(setBookRecovering(symbol));
    this.send({ type: 'subscribe', symbol, requestSnapshot: true, data: null });
  }

  /**
   * Folds a frame into one already waiting, where the newer frame makes the
   * older one redundant. Returns true when the frame has been absorbed.
   *
   * Under a flood the queue fills with high-priority frames and there is
   * nothing low-priority left to evict, so book deltas start being dropped and
   * every drop costs a snapshot recovery round trip. Two frames can be folded
   * without losing anything:
   *
   * - a book *snapshot* is absolute, so a newer one replaces an older one;
   * - the tape is append-only, so two print batches for one symbol concatenate.
   *
   * A book *delta* is cumulative and is never folded — that is the difference
   * between compressing the stream and corrupting it.
   */
  private coalesce(message: WsMessageValidated): boolean {
    if (message.type === 'order_book_snapshot') {
      const pending = this.queue.find(queued =>
        queued.type === 'order_book_snapshot' && queued.symbol === message.symbol);
      if (!pending || pending.type !== 'order_book_snapshot') return false;
      pending.data = message.data;
      pending.sequence = message.sequence;
      this.counters.coalesced++;
      return true;
    }
    if (message.type === 'trade') {
      const pending = this.queue.find(queued => queued.type === 'trade' && queued.symbol === message.symbol);
      if (!pending || pending.type !== 'trade') return false;
      // The tape keeps a bounded history anyway; an unbounded merge would just
      // move the memory problem into the queue.
      if (pending.data.length + message.data.length > TAPE_MERGE_LIMIT) return false;
      pending.data.push(...message.data);
      this.counters.coalesced++;
      return true;
    }
    return false;
  }

  private enqueue(message: WsMessageValidated) {
    // Authoritative account images and control traffic cannot be shed with ticks.
    if (message.type === 'account_snapshot' || message.type === 'pong' || message.type === 'error'
      || message.type === 'replay_status' || message.type === 'replay_ack') {
      this.handle(message); return;
    }
    if (this.coalesce(message)) return;
    const priority = message.type === 'market_data' || message.type === 'candle' ? 'low' : 'high';
    const accepted = this.queue.enqueue(message, priority);
    if (!accepted && 'symbol' in message && message.symbol && (message.type === 'order_book_snapshot' || message.type === 'order_book_delta')) {
      this.recover(message.symbol, message.sequence ?? 0);
    }
    this.counters.peakQueue = Math.max(this.counters.peakQueue, this.queue.length);
    if (this.drainHandle !== null || this.destroyed) return;
    this.drainHandle = requestAnimationFrame(() => {
      this.drainHandle = null;
      const started = performance.now();
      if (this.lastDrainAt) this.telemetry.frame(started - this.lastDrainAt);
      this.lastDrainAt = started;
      while (!this.queue.isEmpty) {
        const queued = this.queue.dequeue();
        if (queued) this.handle(queued.data);
      }
      this.market.flush();
      this.trades.flush();
      this.counters.processingMs = Math.round((performance.now() - started) * 100) / 100;
    });
  }

  private handle(message: WsMessageValidated) {
    const dispatch = this.options.dispatch;
    const arrived = this.arrivals.get(message);
    if (arrived !== undefined) this.telemetry.commit(arrived, performance.now());
    switch (message.type) {
      case 'market_data':
        this.lastEventMs = Math.max(this.lastEventMs, message.data.timestamp);
        this.market.handle(message.data);
        break;
      case 'candle': dispatch(upsertCandle({ symbol: message.symbol, candle: message.data })); break;
      case 'candle_snapshot': dispatch(updateCandlesticks({ symbol: message.symbol, data: message.data })); break;
      case 'account_snapshot': dispatch(receiveAccount(message.data)); break;
      case 'replay_status':
        // Both readings are replay event time, so their difference is how far
        // the rendered market trails the session clock.
        if (this.lastEventMs > 0) {
          this.telemetry.replayLag(message.data.eventTimeNs, `${BigInt(Math.round(this.lastEventMs)) * 1_000_000n}`);
        }
        dispatch(receiveStatus(message.data));
        break;
      case 'replay_ack': dispatch(receiveAck(message.data)); break;
      case 'snapshot': {
        // A rebuilt session. Replace state outright; do not reconcile it with
        // deltas from before the rebuild, which describe a market that is gone.
        const snapshot = message.data;
        this.recovering.clear();
        this.book.resetAll();
        for (const [symbol, book] of Object.entries(snapshot.orderBooks)) {
          this.book.handleSnapshot(symbol, book, snapshot.sequences[symbol] ?? 0);
        }
        for (const [symbol, candles] of Object.entries(snapshot.candlesticks ?? {})) {
          dispatch(updateCandlesticks({ symbol, data: candles }));
        }
        for (const [symbol, prints] of Object.entries(snapshot.trades ?? {})) {
          this.trades.handle(symbol, prints);
        }
        for (const quote of Object.values(snapshot.marketData)) this.market.handle(quote);
        if (snapshot.account) dispatch(receiveAccount(snapshot.account));
        if (snapshot.replay) dispatch(receiveStatus(snapshot.replay));
        break;
      }
      case 'order_book_snapshot': {
        const pending = this.recovering.get(message.symbol);
        if (pending && message.sequence < pending.sequence) break;
        this.book.handleSnapshot(message.symbol, message.data, message.sequence);
        this.recovering.delete(message.symbol);
        break;
      }
      case 'order_book_delta':
        if (this.recovering.has(message.symbol)) break;
        if (!this.book.handleDelta(message.symbol, message.data, message.sequence)) this.recover(message.symbol, message.sequence);
        break;
      case 'trade': this.trades.handle(message.symbol, message.data); break;
      case 'pong': {
        this.lastPongAt = Date.now();
        // A round trip, on one clock. Halving it to claim a one-way time would
        // assume a symmetric path this client cannot verify.
        const roundTrip = performance.now() - this.latencyStart;
        this.telemetry.roundTrip(roundTrip);
        dispatch(setStats({ wsLatency: Math.round(roundTrip) }));
        break;
      }
      default: break;
    }
  }

  private startTimers() {
    this.stopTimers();
    const interval = this.options.heartbeatIntervalMs ?? 15_000;
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastPongAt > interval * 2) {
        this.ws?.close();
        this.disconnected();
        this.scheduleReconnect();
        return;
      }
      this.latencyStart = performance.now();
      this.send({ type: 'ping', data: null });
    }, interval);
    this.longTasks.start();
    this.rateMark = { received: this.counters.received, at: performance.now() };
    this.metricsTimer = setInterval(() => {
      this.options.dispatch(setDiagnostics({ ...this.counters, dropped: this.queue.dropped, queueDepth: this.queue.length }));
      if (this.options.telemetry !== false) this.report();
      // A lost recovery snapshot must not leave a symbol stuck forever.
      for (const [symbol, pending] of this.recovering) {
        if (Date.now() - pending.since > 2000) {
          pending.since = Date.now();
          this.send({ type: 'subscribe', symbol, requestSnapshot: true, data: null });
        }
      }
    }, 1000);
  }
  private stopTimers() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    this.heartbeatTimer = this.metricsTimer = null;
    this.longTasks.stop();
  }
  private scheduleReconnect() {
    if (this.destroyed || this.retryTimer || this.retryCount >= (this.options.maxRetries ?? Infinity)) return;
    const delay = Math.min(1000 * 2 ** this.retryCount++, 30_000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.counters.reconnects++;
      this.connect();
    }, delay);
  }
  send(message: WsMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }
  destroy() {
    this.destroyed = true;
    this.disconnected();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.ws?.close();
    this.ws = null;
  }
}
