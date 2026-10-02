import { describe, it, expect, afterEach, vi } from 'vitest';
import { LongTaskCounter } from '../longTasks';

/**
 * A browser that cannot see long tasks must say so. Reporting zero would read
 * as "the main thread never blocked", which is a much stronger claim than
 * "we did not look".
 */

type Callback = (list: { getEntries(): { duration: number }[] }) => void;

function stubObserver(supported = true) {
  const callbacks: Callback[] = [];
  vi.stubGlobal('PerformanceObserver', class {
    constructor(callback: Callback) { callbacks.push(callback); }
    observe(options: { entryTypes: string[] }) {
      if (!supported || !options.entryTypes.includes('longtask')) {
        throw new TypeError('unsupported entry type');
      }
    }
    disconnect() {}
  });
  return { emit: (...durations: number[]) => callbacks.forEach(cb =>
    cb({ getEntries: () => durations.map(duration => ({ duration })) })) };
}

afterEach(() => vi.unstubAllGlobals());

describe('LongTaskCounter', () => {
  it('counts blocks and the time they cost', () => {
    const { emit } = stubObserver();
    const counter = new LongTaskCounter();
    counter.start();
    emit(64, 120.5);
    expect(counter.observing).toBe(true);
    expect(counter.count).toBe(2);
    expect(counter.totalMs).toBeCloseTo(184.5, 6);
  });

  it('reports that it is not observing where the entry type is unsupported', () => {
    stubObserver(false);
    const counter = new LongTaskCounter();
    counter.start();
    expect(counter.observing).toBe(false);
    expect(counter.count).toBe(0);
  });

  it('stays quiet where there is no PerformanceObserver at all', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const counter = new LongTaskCounter();
    counter.start();
    expect(counter.observing).toBe(false);
  });

  it('clears its counts but keeps observing', () => {
    const { emit } = stubObserver();
    const counter = new LongTaskCounter();
    counter.start();
    emit(80);
    counter.reset();
    expect(counter.count).toBe(0);
    expect(counter.totalMs).toBe(0);
    expect(counter.observing).toBe(true);
    emit(90);
    expect(counter.count).toBe(1);
  });

  it('starts once, and stops cleanly', () => {
    const { emit } = stubObserver();
    const counter = new LongTaskCounter();
    counter.start();
    counter.start();
    emit(70);
    expect(counter.count).toBe(1);  // Not double-counted by a second observer.
    counter.stop();
    expect(counter.observing).toBe(false);
  });
});
