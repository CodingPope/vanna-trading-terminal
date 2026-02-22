import { describe, it, expect, beforeEach } from 'vitest';
import { CircularBuffer, ObjectPool, BackpressureQueue } from '../buffers';

// ── CircularBuffer ─────────────────────────────────────────────────────────────
describe('CircularBuffer', () => {
  let buf: CircularBuffer<number>;

  beforeEach(() => {
    buf = new CircularBuffer<number>(3);
  });

  it('starts empty', () => {
    expect(buf.size).toBe(0);
    expect(buf.isFull).toBe(false);
    expect(buf.toArray()).toEqual([]);
  });

  it('push increases size up to capacity', () => {
    buf.push(1);
    buf.push(2);
    expect(buf.size).toBe(2);
    expect(buf.isFull).toBe(false);
    buf.push(3);
    expect(buf.size).toBe(3);
    expect(buf.isFull).toBe(true);
  });

  it('returns items in insertion order when not full', () => {
    buf.push(10);
    buf.push(20);
    expect(buf.toArray()).toEqual([10, 20]);
  });

  it('overwrites oldest item when full (ring behaviour)', () => {
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4); // overwrites 1
    expect(buf.toArray()).toEqual([2, 3, 4]);
    expect(buf.size).toBe(3);
  });

  it('clear resets size and head', () => {
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.toArray()).toEqual([]);
  });
});

// ── ObjectPool ────────────────────────────────────────────────────────────────
describe('ObjectPool', () => {
  interface Tick { price: number; volume: number }

  const makePool = () => new ObjectPool<Tick>(
    () => ({ price: 0, volume: 0 }),
    (obj) => { obj.price = 0; obj.volume = 0; },
    5,
  );

  it('creates a new object when pool is empty', () => {
    const pool = makePool();
    const obj = pool.acquire();
    expect(obj).toEqual({ price: 0, volume: 0 });
  });

  it('reuses released objects', () => {
    const pool = makePool();
    const obj = pool.acquire();
    obj.price = 999;
    pool.release(obj);
    expect(pool.available).toBe(1);
    const reused = pool.acquire();
    // reset was called — price should be back to 0
    expect(reused.price).toBe(0);
    expect(pool.available).toBe(0);
  });

  it('does not exceed maxSize', () => {
    const pool = makePool();
    for (let i = 0; i < 10; i++) {
      pool.release({ price: i, volume: i });
    }
    expect(pool.available).toBe(5);
  });
});

// ── BackpressureQueue ─────────────────────────────────────────────────────────
describe('BackpressureQueue', () => {
  it('enqueues and dequeues in FIFO order', () => {
    const q = new BackpressureQueue<number>(10);
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    expect(q.dequeue()?.data).toBe(1);
    expect(q.dequeue()?.data).toBe(2);
    expect(q.length).toBe(1);
  });

  it('drops low-priority messages when full', () => {
    const q = new BackpressureQueue<string>(2);
    q.enqueue('a', 'low');
    q.enqueue('b', 'low');
    q.enqueue('c', 'low'); // should drop 'a'
    expect(q.dropped).toBe(1);
    expect(q.length).toBe(2);
    const items = q.drainAll().map(m => m.data);
    expect(items).toContain('b');
    expect(items).toContain('c');
  });

  it('never drops high-priority messages', () => {
    const q = new BackpressureQueue<string>(2);
    q.enqueue('low-1', 'low');
    q.enqueue('low-2', 'low');
    // Queue is full — high priority should evict a low one
    q.enqueue('high', 'high');
    const items = q.drainAll().map(m => m.data);
    expect(items).toContain('high');
    expect(q.dropped).toBe(1);
  });

  it('isEmpty / length helpers', () => {
    const q = new BackpressureQueue<number>(5);
    expect(q.isEmpty).toBe(true);
    q.enqueue(1);
    expect(q.isEmpty).toBe(false);
    expect(q.length).toBe(1);
  });
});
