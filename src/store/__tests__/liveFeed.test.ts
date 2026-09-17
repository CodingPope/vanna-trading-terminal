import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startLiveFeed } from '../liveFeed';
import type { AppDispatch } from '../store';

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }

  accept() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  push(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

const bookEntry = (price: number, side: 'bid' | 'ask') =>
  ({ price, size: 100, total: 100, side });

const SNAPSHOT = {
  marketData: {
    AAPL: {
      symbol: 'AAPL', price: 230, change: 1, changePercent: 0.4, volume: 1000,
      high: 231, low: 229, open: 229, close: 230, timestamp: 1_700_000_000_000,
      bid: 229.99, ask: 230.01, bidSize: 100, askSize: 100,
    },
  },
  orderBooks: { AAPL: [bookEntry(230.01, 'ask'), bookEntry(229.99, 'bid')] },
  candlesticks: { AAPL: [{ time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }] },
  // The server took its snapshot at sequence 42 — deltas resume at 43.
  sequences: { AAPL: 42 },
};

function mockFetch(body: unknown | null) {
  return vi.fn(async () => {
    if (body === null) throw new Error('connection refused');
    return { ok: true, json: async () => body } as Response;
  });
}

let dispatch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  dispatch = vi.fn();
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000' });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dispatched = () =>
  dispatch.mock.calls.map(c => (c[0] as { type: string }).type);

describe('startLiveFeed', () => {
  it('reports no backend rather than quietly substituting data', async () => {
    vi.stubGlobal('fetch', mockFetch(null));

    const handle = await startLiveFeed(dispatch as unknown as AppDispatch, ['AAPL']);

    expect(handle).toBeNull();
    // Nothing invented, nothing written — the caller decides what happens next.
    expect(dispatch).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('hydrates quotes, books and candles from the snapshot', async () => {
    vi.stubGlobal('fetch', mockFetch(SNAPSHOT));

    await startLiveFeed(dispatch as unknown as AppDispatch, ['AAPL']);

    const types = dispatched();
    expect(types.some(t => t.includes('batchUpdateMarketData'))).toBe(true);
    expect(types.some(t => t.includes('setOrderBook'))).toBe(true);
    expect(types.some(t => t.includes('updateCandlesticks'))).toBe(true);
  });

  it('hydrates before opening the socket', async () => {
    vi.stubGlobal('fetch', mockFetch(SNAPSHOT));

    await startLiveFeed(dispatch as unknown as AppDispatch, ['AAPL']);

    // A delta cannot be applied against a book that has not landed yet.
    expect(dispatch).toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('adopts the snapshot sequence, so the next delta is not read as a gap', async () => {
    vi.stubGlobal('fetch', mockFetch(SNAPSHOT));

    const handle = await startLiveFeed(dispatch as unknown as AppDispatch, ['AAPL']);
    const ws = FakeWebSocket.instances[0];
    ws.accept();
    dispatch.mockClear();

    // Snapshot was at 42, so 43 continues it.
    ws.push({ type: 'order_book_delta', symbol: 'AAPL', sequence: 43, data: [bookEntry(230, 'bid')] });
    vi.advanceTimersByTime(16);

    expect(dispatched().some(t => t.includes('applyDelta'))).toBe(true);
    // No re-snapshot request: without seeding, the client would have expected
    // sequence 1 and thrown away the book it had just fetched.
    const asks = ws.sent.map(s => JSON.parse(s) as { type: string });
    expect(asks.filter(m => m.type === 'subscribe')).toHaveLength(0);

    handle?.stop();
  });

  it('still detects a genuine gap after seeding', async () => {
    vi.stubGlobal('fetch', mockFetch(SNAPSHOT));

    const handle = await startLiveFeed(dispatch as unknown as AppDispatch, ['AAPL']);
    const ws = FakeWebSocket.instances[0];
    ws.accept();

    // 43 never arrives.
    ws.push({ type: 'order_book_delta', symbol: 'AAPL', sequence: 44, data: [bookEntry(230, 'bid')] });
    vi.advanceTimersByTime(16);

    const asks = ws.sent.map(s => JSON.parse(s) as { type: string; requestSnapshot?: boolean });
    const resubscribe = asks.filter(m => m.type === 'subscribe');
    expect(resubscribe).toHaveLength(1);
    expect(resubscribe[0].requestSnapshot).toBe(true);

    handle?.stop();
  });

  it('connects to a same-origin socket url', async () => {
    vi.stubGlobal('fetch', mockFetch(SNAPSHOT));

    const handle = await startLiveFeed(dispatch as unknown as AppDispatch, ['AAPL']);

    expect(FakeWebSocket.instances[0].url).toMatch(/^ws:\/\/localhost:3000\/ws\?session=[a-zA-Z0-9_-]+$/);
    handle?.stop();
  });

  it('upgrades to wss on an https page', async () => {
    vi.stubGlobal('fetch', mockFetch(SNAPSHOT));
    vi.stubGlobal('location', { protocol: 'https:', host: 'vanna.example.com' });

    const handle = await startLiveFeed(dispatch as unknown as AppDispatch, ['AAPL']);

    // A ws:// socket from an https page is blocked as mixed content.
    expect(FakeWebSocket.instances[0].url).toMatch(/^wss:\/\/vanna\.example\.com\/ws\?session=[a-zA-Z0-9_-]+$/);
    handle?.stop();
  });
});
