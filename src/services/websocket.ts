import type { AppDispatch } from '@/store/store';
import { setConnected, setStats, setDiagnostics, upsertCandle, updateCandlesticks } from '@/store/slices/marketSlice';
import { setBookRecovering } from '@/store/slices/orderBookSlice';
import { receiveAccount, invalidateAccount } from '@/store/slices/paperSlice';
import { MarketDataHandler } from './handlers/marketDataHandler';
import { OrderBookHandler } from './handlers/orderBookHandler';
import { TradeHandler } from './handlers/tradeHandler';
import { BackpressureQueue } from './buffers';
import { WsMessageSchema, type WsMessageValidated } from '@/schemas';

export interface WsMessage {
  type: string; symbol?: string; sequence?: number; requestSnapshot?: boolean; data: unknown;
}
interface WebSocketClientOptions {
  url: string; dispatch: AppDispatch; onMessage?: (msg: WsMessage) => void;
  maxRetries?: number; heartbeatIntervalMs?: number; queueCapacity?: number;
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
  private counters = { received: 0, invalid: 0, dropped: 0, gaps: 0, reconnects: 0, queueDepth: 0, peakQueue: 0, processingMs: 0 };

  constructor(options: WebSocketClientOptions) {
    this.options = options;
    this.market = new MarketDataHandler(options.dispatch);
    this.book = new OrderBookHandler(options.dispatch);
    this.trades = new TradeHandler(options.dispatch);
    this.queue = new BackpressureQueue(options.queueCapacity ?? 250);
  }
  get droppedMessages() { return this.queue.dropped; }
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
      try {
        const result = WsMessageSchema.safeParse(JSON.parse(event.data as string));
        if (!result.success) { this.counters.invalid++; return; }
        const message = result.data;
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
    this.stopTimers();
    if (this.drainHandle !== null) cancelAnimationFrame(this.drainHandle);
    this.drainHandle = null;
    this.queue.drainAll();
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

  private enqueue(message: WsMessageValidated) {
    // Authoritative account images and control traffic cannot be shed with ticks.
    if (message.type === 'account_snapshot' || message.type === 'pong' || message.type === 'error') {
      this.handle(message); return;
    }
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
    switch (message.type) {
      case 'market_data': this.market.handle(message.data); break;
      case 'candle': dispatch(upsertCandle({ symbol: message.symbol, candle: message.data })); break;
      case 'candle_snapshot': dispatch(updateCandlesticks({ symbol: message.symbol, data: message.data })); break;
      case 'account_snapshot': dispatch(receiveAccount(message.data)); break;
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
      case 'pong':
        this.lastPongAt = Date.now();
        dispatch(setStats({ wsLatency: Date.now() - this.latencyStart }));
        break;
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
      this.latencyStart = Date.now();
      this.send({ type: 'ping', data: null });
    }, interval);
    this.metricsTimer = setInterval(() => {
      this.options.dispatch(setDiagnostics({ ...this.counters, dropped: this.queue.dropped, queueDepth: this.queue.length }));
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
