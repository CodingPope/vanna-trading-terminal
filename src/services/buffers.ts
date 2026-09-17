/**
 * Fixed-size circular buffer for time-series data (trade history, tick data).
 * Prevents unbounded memory growth during high-frequency market data updates.
 */
export class CircularBuffer<T> {
  private readonly buffer: T[];
  private head = 0;
  private _size = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array<T>(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  toArray(): T[] {
    if (this._size < this.capacity) return this.buffer.slice(0, this._size);
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];
  }

  get size(): number { return this._size; }
  get isFull(): boolean { return this._size === this.capacity; }
  clear(): void { this.head = 0; this._size = 0; }
}

/**
 * Object pool to reduce GC pressure for high-frequency price tick objects.
 * Pre-allocates a pool of objects and reuses them instead of allocating new ones.
 */
export class ObjectPool<T extends object> {
  private readonly pool: T[] = [];
  private readonly factory: () => T;
  private readonly reset: (obj: T) => void;
  private readonly maxSize: number;

  constructor(factory: () => T, reset: (obj: T) => void, maxSize = 200) {
    this.factory = factory;
    this.reset = reset;
    this.maxSize = maxSize;
  }

  acquire(): T {
    return this.pool.length > 0 ? this.pool.pop()! : this.factory();
  }

  release(obj: T): void {
    if (this.pool.length < this.maxSize) {
      this.reset(obj);
      this.pool.push(obj);
    }
  }

  get available(): number { return this.pool.length; }
}

/**
 * Priority message queue with backpressure.
 * Drops low-priority messages when the queue exceeds capacity.
 * If all entries are high priority, enqueue returns false; the caller must recover.
 */
export type MessagePriority = 'high' | 'low';

export interface QueuedMessage<T> {
  data: T;
  priority: MessagePriority;
  timestamp: number;
}

export class BackpressureQueue<T> {
  private queue: QueuedMessage<T>[] = [];
  private readonly maxSize: number;
  private _dropped = 0;

  constructor(maxSize = 1000) { this.maxSize = maxSize; }

  enqueue(data: T, priority: MessagePriority = 'low'): boolean {
    if (this.queue.length >= this.maxSize) {
      // Evict the oldest low-priority item regardless of incoming priority.
      // High-priority messages can still bump a low-priority one out.
      const lowIdx = this.queue.findIndex(m => m.priority === 'low');
      if (lowIdx !== -1) {
        this.queue.splice(lowIdx, 1);
        this._dropped++;
      } else {
        // All queued items are high priority — drop the incoming message.
        this._dropped++;
        return false;
      }
    }
    this.queue.push({ data, priority, timestamp: Date.now() });
    return true;
  }

  dequeue(): QueuedMessage<T> | undefined { return this.queue.shift(); }

  drainAll(): QueuedMessage<T>[] {
    const items = [...this.queue];
    this.queue = [];
    return items;
  }

  get length(): number { return this.queue.length; }
  get dropped(): number { return this._dropped; }
  get isEmpty(): boolean { return this.queue.length === 0; }
}
