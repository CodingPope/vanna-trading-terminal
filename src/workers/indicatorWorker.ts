/**
 * Indicator Web Worker — computes technical indicators off the main thread.
 *
 * Supported indicators:
 *   RSI     — Relative Strength Index (14-period default)
 *   MACD    — Moving Average Convergence Divergence (12/26/9 default)
 *   BB      — Bollinger Bands (20-period, 2σ default)
 *
 * Usage (main thread):
 *   const worker = new Worker(new URL('./indicatorWorker.ts', import.meta.url), { type: 'module' });
 *   worker.postMessage({ type: 'RSI', closes: [...], period: 14 });
 *   worker.onmessage = (e) => console.log(e.data); // { type: 'RSI', result: [...] }
 */

export interface IndicatorRequest {
  id: string;
  type: 'RSI' | 'MACD' | 'BB';
  closes: number[];
  period?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  stdDevMultiplier?: number;
}

export interface RSIResult    { id: string; type: 'RSI'; result: number[] }
export interface MACDResult   { id: string; type: 'MACD'; macd: number[]; signal: number[]; histogram: number[] }
export interface BBResult     { id: string; type: 'BB'; upper: number[]; middle: number[]; lower: number[] }
export interface ErrorResult  { id: string; type: 'error'; message: string }

export type IndicatorResult = RSIResult | MACDResult | BBResult | ErrorResult;

// ── Indicator calculations ────────────────────────────────────────────────────

function ema(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let emaPrev = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(emaPrev);
  for (let i = period; i < data.length; i++) {
    emaPrev = data[i] * k + emaPrev * (1 - k);
    result.push(emaPrev);
  }
  return result;
}

function rsi(closes: number[], period = 14): number[] {
  if (closes.length <= period) return [];
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }
  const result: number[] = [];
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function macd(closes: number[], fast = 12, slow = 26, signal = 9): MACDResult['macd'] & never {
  // returns { macd, signal, histogram } arrays
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const offset = slow - fast;
  const macdLine = slowEma.map((v, i) => fastEma[i + offset] - v);
  const signalLine = ema(macdLine, signal);
  const histOffset = macdLine.length - signalLine.length;
  const histogram = signalLine.map((v, i) => macdLine[i + histOffset] - v);
  return { macdLine, signalLine, histogram } as never;
}

function bollingerBands(closes: number[], period = 20, multiplier = 2): BBResult {
  const result: BBResult = { id: '', type: 'BB', upper: [], middle: [], lower: [] };
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    result.middle.push(mean);
    result.upper.push(mean + multiplier * std);
    result.lower.push(mean - multiplier * std);
  }
  return result;
}

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<IndicatorRequest>) => {
  const req = event.data;
  try {
    switch (req.type) {
      case 'RSI': {
        const result = rsi(req.closes, req.period ?? 14);
        self.postMessage({ id: req.id, type: 'RSI', result } satisfies RSIResult);
        break;
      }
      case 'MACD': {
        const { macdLine, signalLine, histogram } = macd(
          req.closes,
          req.fastPeriod ?? 12,
          req.slowPeriod ?? 26,
          req.signalPeriod ?? 9,
        ) as unknown as { macdLine: number[]; signalLine: number[]; histogram: number[] };
        self.postMessage({ id: req.id, type: 'MACD', macd: macdLine, signal: signalLine, histogram } satisfies MACDResult);
        break;
      }
      case 'BB': {
        const bb = bollingerBands(req.closes, req.period ?? 20, req.stdDevMultiplier ?? 2);
        self.postMessage({ ...bb, id: req.id } satisfies BBResult);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ id: req.id, type: 'error', message: (err as Error).message } satisfies ErrorResult);
  }
};
