import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketClient } from '../websocket';
import type { WsMessage } from '../websocket';
import type { AppDispatch } from '@/store/store';

/**
 * Minimal WebSocket stand-in.
 *
 * Deliberately not mock-socket: these tests run on fake timers to prove the
 * backoff schedule without waiting 30 real seconds, and mock-socket delivers
 * its own messages through setTimeout, so its internals get captured by the
 * fake clock and you end up advancing timers to flush the mock rather than to
 * exercise the client. The real surface used by WebSocketClient is four
 * handlers, send, close and readyState, so a hand-rolled double is both smaller
 * and more precise.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Every socket the client has constructed, oldest first. */
  static instances: FakeWebSocket[] = [];

  readyState: number = FakeWebSocket.CONNECTING;
  sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  readonly url: string;

  constructor(url: string) {
    // Written out rather than a parameter property: tsconfig sets
    // erasableSyntaxOnly, so only syntax that survives plain type-stripping
    // is allowed.
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  // ── Test controls ──────────────────────────────────────────────────────────

  /** Server accepted the connection. */
  accept() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Server pushed a frame. */
  push(msg: WsMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  /** Connection dropped from the other end. */
  drop(code = 1006, reason = 'abnormal closure') {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  /** Messages this socket sent, parsed. */
  get sentMessages(): WsMessage[] {
    return this.sent.map(s => JSON.parse(s) as WsMessage);
  }
}

/** The most recently constructed socket. */
const latest = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

function makeClient() {
  const dispatch = vi.fn() as unknown as AppDispatch;
  const client = new WebSocketClient({ url: 'ws://test/stream', dispatch });
  client.connect();
  return { client, dispatch };
}

function bookEntry(price: number) {
  return [{ price, size: 10, total: 10, side: 'bid' as const }];
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Reconnect backoff ─────────────────────────────────────────────────────────
describe('reconnect backoff', () => {
  it('does not reconnect before the first delay elapses', () => {
    const { client } = makeClient();
    latest().accept();
    latest().drop();

    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    client.destroy();
  });

  it('doubles the delay on each successive failure', () => {
    const { client } = makeClient();
    const delays: number[] = [];

    // Each drop without an intervening successful open should back off further.
    for (const expected of [1000, 2000, 4000, 8000]) {
      latest().drop();
      const before = FakeWebSocket.instances.length;

      vi.advanceTimersByTime(expected - 1);
      expect(FakeWebSocket.instances).toHaveLength(before);

      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(before + 1);

      delays.push(expected);
    }

    expect(delays).toEqual([1000, 2000, 4000, 8000]);
    client.destroy();
  });

  it('caps the delay at 30s instead of growing without bound', () => {
    const { client } = makeClient();

    // 2^5 * 1000 = 32000, which is past the cap.
    for (const delay of [1000, 2000, 4000, 8000, 16000]) {
      latest().drop();
      vi.advanceTimersByTime(delay);
    }

    const before = FakeWebSocket.instances.length;
    latest().drop();

    // Would have been 32s uncapped.
    vi.advanceTimersByTime(29_999);
    expect(FakeWebSocket.instances).toHaveLength(before);

    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(before + 1);

    client.destroy();
  });

  it('resets the backoff after a successful connection', () => {
    const { client } = makeClient();

    latest().drop();
    vi.advanceTimersByTime(1000);
    latest().drop();
    vi.advanceTimersByTime(2000);

    // A successful open should put the next failure back to 1s, not 4s.
    latest().accept();
    latest().drop();

    const before = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(before + 1);

    client.destroy();
  });

  it('stops reconnecting once destroyed', () => {
    const { client } = makeClient();
    latest().accept();
    client.destroy();
    latest().drop();

    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

// ── Sequence gap detection ────────────────────────────────────────────────────
describe('order book sequence validation', () => {
  it('applies deltas that arrive in order without asking for a snapshot', () => {
    const { client } = makeClient();
    const ws = latest();
    ws.accept();

    ws.push({ type: 'order_book_snapshot', symbol: 'AAPL', sequence: 1, data: bookEntry(100) });
    ws.push({ type: 'order_book_delta', symbol: 'AAPL', sequence: 2, data: bookEntry(101) });
    ws.push({ type: 'order_book_delta', symbol: 'AAPL', sequence: 3, data: bookEntry(102) });

    expect(ws.sentMessages.filter(m => m.type === 'subscribe')).toHaveLength(0);
    client.destroy();
  });

  it('requests a fresh snapshot when a delta skips a sequence number', () => {
    const { client } = makeClient();
    const ws = latest();
    ws.accept();

    ws.push({ type: 'order_book_snapshot', symbol: 'AAPL', sequence: 1, data: bookEntry(100) });
    // 2 never arrives.
    ws.push({ type: 'order_book_delta', symbol: 'AAPL', sequence: 3, data: bookEntry(102) });

    const resubscribes = ws.sentMessages.filter(m => m.type === 'subscribe');
    expect(resubscribes).toHaveLength(1);
    expect(resubscribes[0]).toMatchObject({ symbol: 'AAPL', requestSnapshot: true });

    client.destroy();
  });

  it('does not apply the gapped delta to the store', () => {
    const { client, dispatch } = makeClient();
    const ws = latest();
    ws.accept();

    ws.push({ type: 'order_book_snapshot', symbol: 'AAPL', sequence: 1, data: bookEntry(100) });
    (dispatch as unknown as ReturnType<typeof vi.fn>).mockClear();

    ws.push({ type: 'order_book_delta', symbol: 'AAPL', sequence: 3, data: bookEntry(102) });

    // A book that silently missed an update is worse than no book: it looks
    // right and prices wrong. Nothing should reach the store.
    const applied = (dispatch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(c => (c[0] as { type: string }).type)
      .filter(t => t.includes('applyDelta'));
    expect(applied).toHaveLength(0);

    client.destroy();
  });

  it('tracks sequences per symbol rather than globally', () => {
    const { client } = makeClient();
    const ws = latest();
    ws.accept();

    ws.push({ type: 'order_book_snapshot', symbol: 'AAPL', sequence: 1, data: bookEntry(100) });
    ws.push({ type: 'order_book_snapshot', symbol: 'MSFT', sequence: 1, data: bookEntry(200) });

    // Interleaved, each correct for its own symbol.
    ws.push({ type: 'order_book_delta', symbol: 'AAPL', sequence: 2, data: bookEntry(101) });
    ws.push({ type: 'order_book_delta', symbol: 'MSFT', sequence: 2, data: bookEntry(201) });

    expect(ws.sentMessages.filter(m => m.type === 'subscribe')).toHaveLength(0);
    client.destroy();
  });

  it('re-snapshots after a reconnect, since sequence state cannot survive a gap in the stream', () => {
    const { client } = makeClient();
    latest().accept();
    latest().push({ type: 'order_book_snapshot', symbol: 'AAPL', sequence: 5, data: bookEntry(100) });

    latest().drop();
    vi.advanceTimersByTime(1000);

    const reconnected = latest();
    reconnected.accept();

    // Sequences were reset on reconnect, so seq 6 is now treated as a gap
    // (expected 1) rather than silently trusted against pre-drop state.
    reconnected.push({ type: 'order_book_delta', symbol: 'AAPL', sequence: 6, data: bookEntry(101) });

    expect(reconnected.sentMessages.filter(m => m.type === 'subscribe')).toHaveLength(1);
    client.destroy();
  });
});

// ── Heartbeat ─────────────────────────────────────────────────────────────────
describe('heartbeat', () => {
  it('pings on an interval once connected', () => {
    const { client } = makeClient();
    const ws = latest();
    ws.accept();

    vi.advanceTimersByTime(15_000);
    expect(ws.sentMessages.filter(m => m.type === 'ping')).toHaveLength(1);

    vi.advanceTimersByTime(15_000);
    expect(ws.sentMessages.filter(m => m.type === 'ping')).toHaveLength(2);

    client.destroy();
  });

  it('stops pinging after the connection drops', () => {
    const { client } = makeClient();
    const ws = latest();
    ws.accept();
    vi.advanceTimersByTime(15_000);
    const before = ws.sentMessages.filter(m => m.type === 'ping').length;

    ws.drop();
    vi.advanceTimersByTime(60_000);

    expect(ws.sentMessages.filter(m => m.type === 'ping')).toHaveLength(before);
    client.destroy();
  });

  it('reports round-trip latency on pong, and claims nothing else', () => {
    const { client, dispatch } = makeClient();
    const ws = latest();
    ws.accept();

    vi.advanceTimersByTime(15_000); // ping goes out
    vi.advanceTimersByTime(42);     // server takes 42ms
    ws.push({ type: 'pong', data: null });

    const calls = (dispatch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const stats = calls.map(c => c[0] as { type: string; payload: Record<string, unknown> })
      .find(a => a.type.includes('setStats'));

    expect(stats?.payload.wsLatency).toBe(42);
    // fps / renderTime are client-side metrics; a transport must not invent them.
    expect(stats?.payload).not.toHaveProperty('fps');
    expect(stats?.payload).not.toHaveProperty('renderTime');

    client.destroy();
  });
});

// ── Load shedding ─────────────────────────────────────────────────────────────
describe('behaviour under a message burst', () => {
  /** Market-data writes only, ignoring connection/stats actions. */
  const marketWrites = (dispatch: AppDispatch) =>
    (dispatch as unknown as ReturnType<typeof vi.fn>).mock.calls
      .map(c => c[0] as { type: string; payload: unknown })
      .filter(a => a.type.includes('batchUpdate'));

  it('collapses a burst of ticks for one symbol into a single store write', () => {
    const { client, dispatch } = makeClient();
    const ws = latest();
    ws.accept();

    // 500 ticks for AAPL inside a single frame.
    for (let i = 0; i < 500; i++) {
      ws.push({ type: 'market_data', data: { symbol: 'AAPL', price: 100 + i, timestamp: i } });
    }

    // Nothing written yet — MarketDataHandler batches per animation frame.
    expect(marketWrites(dispatch)).toHaveLength(0);

    vi.advanceTimersByTime(16);

    const writes = marketWrites(dispatch);
    expect(writes).toHaveLength(1);
    // Deduplicated to the latest value per symbol, not 500 rows.
    expect(writes[0].payload as unknown[]).toHaveLength(1);

    client.destroy();
  });

  it('DOCUMENTS A GAP: the priority queue never sheds, because it is drained on every message', () => {
    const { client, dispatch } = makeClient();
    const ws = latest();
    ws.accept();

    // 2000 distinct symbols — twice the BackpressureQueue's 1000 capacity, and
    // all low priority, so a working queue would have dropped roughly half.
    for (let i = 0; i < 2000; i++) {
      ws.push({ type: 'market_data', data: { symbol: `SYM${i}`, price: i, timestamp: i } });
    }
    vi.advanceTimersByTime(16);

    const written = marketWrites(dispatch)[0].payload as unknown[];

    // Every single one survives. enqueueAndProcess() enqueues one message then
    // drains the whole queue synchronously, so the queue never holds more than
    // one item and its maxSize of 1000 is unreachable. The load shedding that
    // actually happens is MarketDataHandler's per-frame dedup above, not this.
    expect(written).toHaveLength(2000);

    client.destroy();
  });
});
