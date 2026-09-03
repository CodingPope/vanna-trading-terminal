import { describe, it, expect } from 'vitest';
import {
  aggregateCandles,
  isTimeframeUsable,
  barCountFor,
  TIMEFRAME_MINUTES,
} from '../candles';
import type { CandlestickData } from '@/types';

const MINUTE = 60_000;

/** `count` one-minute bars starting at an exact bucket boundary. */
function minuteBars(count: number, startAt = 0): CandlestickData[] {
  return Array.from({ length: count }, (_, i) => ({
    time: startAt + i * MINUTE,
    open: 100 + i,
    high: 100 + i + 2,
    low: 100 + i - 2,
    close: 100 + i + 1,
    volume: 10,
  }));
}

describe('aggregateCandles', () => {
  it('returns one-minute bars untouched', () => {
    const bars = minuteBars(10);
    expect(aggregateCandles(bars, 1)).toBe(bars);
  });

  it('collapses five one-minute bars into one five-minute bar', () => {
    const result = aggregateCandles(minuteBars(5), 5);
    expect(result).toHaveLength(1);
  });

  it('takes open from the first bar and close from the last', () => {
    const bars = minuteBars(5);
    const [bar] = aggregateCandles(bars, 5);

    expect(bar.open).toBe(bars[0].open);
    expect(bar.close).toBe(bars[4].close);
  });

  it('takes the extremes across the whole bucket', () => {
    const bars = minuteBars(5);
    bars[2].high = 999;
    bars[3].low = -999;

    const [bar] = aggregateCandles(bars, 5);

    expect(bar.high).toBe(999);
    expect(bar.low).toBe(-999);
  });

  it('sums volume rather than averaging or overwriting it', () => {
    const [bar] = aggregateCandles(minuteBars(5), 5);
    expect(bar.volume).toBe(50);
  });

  it('splits into separate buckets once the window is exceeded', () => {
    expect(aggregateCandles(minuteBars(15), 5)).toHaveLength(3);
    expect(aggregateCandles(minuteBars(60), 15)).toHaveLength(4);
  });

  it('keeps a trailing partial bucket rather than discarding it', () => {
    // 7 minutes at 5m is one full bar plus a two-minute stub, and the stub is
    // the live one — dropping it would freeze the right edge of the chart.
    const result = aggregateCandles(minuteBars(7), 5);
    expect(result).toHaveLength(2);
    expect(result[1].volume).toBe(20);
  });

  it('aligns buckets to the clock, not to the first bar', () => {
    // Start three minutes into a five-minute window: the first bucket should
    // hold two bars, not five, so a bar always covers the same wall-clock span.
    const result = aggregateCandles(minuteBars(10, 3 * MINUTE), 5);
    expect(result[0].volume).toBe(20);
    expect(result[0].time % (5 * MINUTE)).toBe(0);
  });

  it('handles an empty series', () => {
    expect(aggregateCandles([], 15)).toEqual([]);
  });
});

describe('isTimeframeUsable', () => {
  it('accepts timeframes a session of one-minute bars can support', () => {
    const session = minuteBars(390); // a full US session

    expect(isTimeframeUsable(session, '1m')).toBe(true);
    expect(isTimeframeUsable(session, '5m')).toBe(true);
    expect(isTimeframeUsable(session, '15m')).toBe(true);
    expect(isTimeframeUsable(session, '1h')).toBe(true);
  });

  it('rejects timeframes one session cannot fill', () => {
    const session = minuteBars(390);

    // 6.5 hours cannot make a daily chart, let alone a weekly one.
    expect(isTimeframeUsable(session, '1d')).toBe(false);
    expect(isTimeframeUsable(session, '1w')).toBe(false);
  });

  it('rejects an hourly chart when only 100 minutes exist', () => {
    const short = minuteBars(100);
    expect(isTimeframeUsable(short, '15m')).toBe(true);
    expect(isTimeframeUsable(short, '1h')).toBe(false);
  });

  it('falls back to 1m before any data arrives', () => {
    expect(isTimeframeUsable([], '1m')).toBe(true);
    expect(isTimeframeUsable([], '1h')).toBe(false);
  });
});

describe('barCountFor', () => {
  it('reports the bar count a timeframe would yield', () => {
    const session = minuteBars(390);
    expect(barCountFor(session, '1m')).toBe(390);
    expect(barCountFor(session, '5m')).toBe(78);
  });

  it('covers every timeframe the UI offers', () => {
    expect(Object.keys(TIMEFRAME_MINUTES).sort())
      .toEqual(['15m', '1d', '1h', '1m', '1w', '5m']);
  });
});
