import type { AppDispatch } from '@/store/store';
import { setConnected, setStats } from '@/store/slices/marketSlice';
import { MarketDataHandler } from './handlers/marketDataHandler';
import { OrderBookHandler } from './handlers/orderBookHandler';
import { TradeHandler } from './handlers/tradeHandler';
import { BackpressureQueue } from './buffers';
import type { MarketData } from '@/types';
import type { OrderBookEntry, Trade } from '@/types';

export type WsMessageType =
  | 'market_data'
  | 'order_book_snapshot'
  | 'order_book_delta'
  | 'trade'
  | 'position_update'
  | 'ping'
  | 'pong'
  | 'subscribe'
  | 'error';

export interface WsMessage {
  type: WsMessageType;
  symbol?: string;
  sequence?: number;
  requestSnapshot?: boolean;
  data: unknown;
}

interface WebSocketClientOptions {
  url: string;
  dispatch: AppDispatch;
  onMessage?: (msg: WsMessage) => void;
  maxRetries?: number;
  heartbeatIntervalMs?: number;
  queueCapacity?: number;
}

/**
 * Messages the queue will hold before shedding low-priority ones.
 *
 * The queue drains every animation frame, so this is really "one frame's
 * worth": at ~16ms a frame, 250 messages is roughly a 15k/sec feed. Above
 * that the client is not keeping up and stale market data is the right thing
 * to throw away. Order book and position updates are never dropped.
 */
const DEFAULT_QUEUE_CAPACITY = 250;

/**
 * Production-grade WebSocket client:
 * - Exponential backoff reconnect: 1s → 2s → 4s → max 30s
 * - Heartbeat ping/pong every 15s with latency measurement
 * - Handler-based message routing (market data, order book)
 * - BackpressureQueue: drops non-critical messages on overload
 * - OrderBookHandler validates sequence numbers, signals re-snapshot on gaps
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private readonly dispatch: AppDispatch;
  private readonly url: string;
  private retryCount = 0;
  private readonly maxRetries: number;
  private readonly heartbeatIntervalMs: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private latencyStart = 0;
  private drainHandle: number | null = null;

  private readonly marketDataHandler: MarketDataHandler;
  private readonly orderBookHandler: OrderBookHandler;
  private readonly tradeHandler: TradeHandler;
  private readonly messageQueue: BackpressureQueue<WsMessage>;
  private readonly onMessage?: (msg: WsMessage) => void;

  constructor(options: WebSocketClientOptions) {
    this.url = options.url;
    this.dispatch = options.dispatch;
    this.maxRetries = options.maxRetries ?? Infinity;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.onMessage = options.onMessage;
    this.marketDataHandler = new MarketDataHandler(this.dispatch);
    this.orderBookHandler = new OrderBookHandler(this.dispatch);
    this.tradeHandler = new TradeHandler(this.dispatch);
    this.messageQueue = new BackpressureQueue<WsMessage>(options.queueCapacity ?? DEFAULT_QUEUE_CAPACITY);
  }

  /**
   * Messages discarded because the client could not keep up. Only ever
   * low-priority ones — see BackpressureQueue.
   */
  get droppedMessages(): number {
    return this.messageQueue.dropped;
  }

  /**
   * Adopt the sequence numbers a REST snapshot was taken at, so the first
   * delta continues from the fetched book rather than reading as a gap.
   */
  seedSequences(sequences: Record<string, number>): void {
    this.orderBookHandler.seedSequences(sequences);
  }

  connect(): void {
    if (this.destroyed) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.info('[WS] No backend available (demo mode):', (err as Error).message);
      return;
    }

    this.ws.onopen = () => {
      console.info('[WS] Connected');
      this.retryCount = 0;
      this.dispatch(setConnected(true));
      this.startHeartbeat();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as WsMessage;
        this.enqueueAndProcess(msg);
        this.onMessage?.(msg);
      } catch (err) {
        console.warn('[WS] Parse error:', err);
      }
    };

    this.ws.onclose = (event) => {
      console.warn('[WS] Disconnected:', event.code, event.reason);
      this.dispatch(setConnected(false));
      this.stopHeartbeat();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose fires after onerror — no extra action needed here
    };
  }

  /**
   * Queue on arrival, process on the next frame.
   *
   * Draining synchronously inside onmessage would mean the queue never holds
   * more than one item, which makes its capacity — and therefore the whole
   * point of it — unreachable. Deferring to a frame lets a burst actually
   * accumulate, so the queue can shed load when the client cannot keep up.
   *
   * Priority decides what gets evicted, never what gets processed first:
   * draining stays FIFO because order book deltas are cumulative and must be
   * applied in the order they were sent.
   */
  private enqueueAndProcess(msg: WsMessage): void {
    // Control messages skip the queue. A pong measures network round-trip, so
    // making it wait for a drain would fold our own backlog into the reported
    // latency — worst exactly when the queue is deep and the number matters.
    if (msg.type === 'pong' || msg.type === 'error') {
      this.handleMessage(msg);
      return;
    }

    const priority =
      msg.type === 'order_book_snapshot' ||
      msg.type === 'order_book_delta' ||
      msg.type === 'trade' ||
      msg.type === 'position_update'
        ? 'high'
        : 'low';

    this.messageQueue.enqueue(msg, priority);
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.drainHandle !== null || this.destroyed) return;
    this.drainHandle = requestAnimationFrame(() => {
      this.drainHandle = null;
      while (!this.messageQueue.isEmpty) {
        const queued = this.messageQueue.dequeue();
        if (queued) this.handleMessage(queued.data);
      }
      // Already inside a frame — push the deduped batch out now rather than
      // waiting for the handler's own frame.
      this.marketDataHandler.flush();
      this.tradeHandler.flush();
    });
  }

  private handleMessage(msg: WsMessage): void {
    switch (msg.type) {
      case 'market_data':
        if (msg.data) this.marketDataHandler.handle(msg.data as MarketData);
        break;

      case 'order_book_snapshot':
        if (msg.symbol && msg.data && msg.sequence !== undefined) {
          this.orderBookHandler.handleSnapshot(msg.symbol, msg.data as OrderBookEntry[], msg.sequence);
        }
        break;

      case 'order_book_delta':
        if (msg.symbol && msg.data && msg.sequence !== undefined) {
          const ok = this.orderBookHandler.handleDelta(msg.symbol, msg.data as OrderBookEntry[], msg.sequence);
          if (!ok) {
            // Sequence gap — request a fresh snapshot for this symbol
            this.send({ type: 'subscribe', symbol: msg.symbol, requestSnapshot: true, data: null });
          }
        }
        break;

      case 'trade':
        if (msg.symbol && Array.isArray(msg.data)) {
          this.tradeHandler.handle(msg.symbol, msg.data as Trade[]);
        }
        break;

      case 'pong': {
        // Report only what the socket can measure. fps, render time and memory
        // are client-side metrics owned by usePerformanceStats; a transport
        // asserting them would be inventing numbers.
        this.dispatch(setStats({
          wsLatency: Date.now() - this.latencyStart,
          lastUpdate: Date.now(),
        }));
        break;
      }

      default:
        break;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.latencyStart = Date.now();
        this.send({ type: 'ping', data: null });
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.retryCount >= this.maxRetries) return;
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30_000);
    console.info(`[WS] Reconnecting in ${delay}ms (attempt ${this.retryCount + 1})`);
    this.retryCount++;

    this.retryTimer = setTimeout(() => {
      this.orderBookHandler.resetAll();
      this.connect();
    }, delay);
  }

  send(msg: WsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.drainHandle !== null) { cancelAnimationFrame(this.drainHandle); this.drainHandle = null; }
    this.marketDataHandler.destroy();
    this.tradeHandler.destroy();
    this.ws?.close();
    this.ws = null;
  }
}
