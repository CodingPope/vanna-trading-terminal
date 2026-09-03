/**
 * Candle aggregation.
 *
 * The feed publishes one-minute bars. Every other timeframe is derived from
 * them here rather than requested separately, which is how the chart's
 * timeframe buttons come to mean anything — before this they set state that
 * nothing read, so clicking 15M moved the highlight and left the chart alone.
 */
import type { CandlestickData } from '@/types';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d' | '1w';

/** Minutes per bar for each timeframe. */
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '1d': 1440,
  '1w': 10_080,
};

/**
 * Fewest bars worth drawing. Below this a chart is a handful of rectangles
 * that reads as broken rather than as zoomed out, so the control is disabled
 * instead — an honest "not enough history" beats a button that technically
 * works and produces nonsense.
 */
export const MIN_USABLE_BARS = 6;

const MINUTE_MS = 60_000;

/**
 * Roll one-minute bars up into `barMinutes` buckets.
 *
 * Standard OHLC aggregation: the bucket opens where the first bar opened,
 * closes where the last one closed, and takes the extremes and volume sum
 * across everything between. Buckets are aligned to absolute epoch time rather
 * than to the first bar in the array, so a bar covers the same wall-clock
 * window regardless of where the data happens to start.
 */
export function aggregateCandles(
  candles: CandlestickData[],
  barMinutes: number,
): CandlestickData[] {
  if (barMinutes <= 1 || candles.length === 0) return candles;

  const bucketMs = barMinutes * MINUTE_MS;
  const out: CandlestickData[] = [];
  let current: CandlestickData | null = null;
  let currentBucket = NaN;

  for (const candle of candles) {
    const bucket = Math.floor(candle.time / bucketMs) * bucketMs;

    if (current === null || bucket !== currentBucket) {
      if (current) out.push(current);
      currentBucket = bucket;
      current = {
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      };
      continue;
    }

    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
  }

  if (current) out.push(current);
  return out;
}

/** How many bars a timeframe would produce from the given history. */
export function barCountFor(candles: CandlestickData[], timeframe: Timeframe): number {
  return aggregateCandles(candles, TIMEFRAME_MINUTES[timeframe]).length;
}

/**
 * Whether there is enough history for this timeframe to draw something
 * meaningful. One session of one-minute bars cannot produce a daily chart.
 */
export function isTimeframeUsable(candles: CandlestickData[], timeframe: Timeframe): boolean {
  if (candles.length === 0) return timeframe === '1m';
  return barCountFor(candles, timeframe) >= MIN_USABLE_BARS;
}
