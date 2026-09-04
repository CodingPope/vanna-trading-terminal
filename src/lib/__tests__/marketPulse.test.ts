import { describe, it, expect } from 'vitest';
import {
  computeMarketPulse,
  regimeFromPulse,
  normalise,
  EMPTY_PULSE,
} from '../marketPulse';
import type { MarketData } from '@/types';

/** A quote carrying a given percentage move; other fields are irrelevant here. */
function quote(symbol: string, changePercent: number): MarketData {
  const price = 100 * (1 + changePercent / 100);
  return {
    symbol, price, change: price - 100, changePercent,
    volume: 1000, high: price, low: price, open: 100, close: price,
    timestamp: 1_700_000_000_000, bid: price - 0.01, ask: price + 0.01,
    bidSize: 100, askSize: 100,
  };
}

const market = (...changes: number[]) =>
  computeMarketPulse(changes.map((c, i) => quote(`S${i}`, c)));

describe('computeMarketPulse', () => {
  it('reports nothing for an empty market', () => {
    expect(computeMarketPulse([])).toEqual(EMPTY_PULSE);
  });

  it('reads dispersion as zero when everything moves together', () => {
    // The macro case: one trade, every name doing the same thing.
    const pulse = market(1, 1, 1, 1);
    expect(pulse.dispersion).toBeCloseTo(0, 6);
    expect(pulse.trend).toBeCloseTo(1, 6);
  });

  it('reads high dispersion when names diverge', () => {
    // Same average move as above — zero — but the names are pulling apart.
    const together = market(0, 0, 0, 0);
    const apart = market(-3, -1, 1, 3);

    expect(apart.trend).toBeCloseTo(together.trend, 6);
    expect(apart.dispersion).toBeGreaterThan(together.dispersion);
  });

  it('separates dispersion from direction', () => {
    // A market up 2% in lockstep is calm; one averaging 2% with names all over
    // the place is not. Trend alone cannot tell them apart.
    const lockstep = market(2, 2, 2, 2);
    const ragged = market(-2, 0, 4, 6);

    expect(ragged.trend).toBeCloseTo(lockstep.trend, 6);
    expect(lockstep.dispersion).toBeLessThan(ragged.dispersion);
  });

  it('measures volatility as magnitude, ignoring direction', () => {
    const up = market(2, 2, 2);
    const mixed = market(-2, 2, -2);

    expect(mixed.volatility).toBeCloseTo(up.volatility, 6);
    // But they lean opposite ways.
    expect(up.trend).toBeGreaterThan(mixed.trend);
  });

  it('counts breadth as the share advancing', () => {
    expect(market(1, 1, 1, -1).breadth).toBeCloseTo(0.75, 6);
    expect(market(-1, -1, -1, -1).breadth).toBe(0);
    expect(market(1, 1).breadth).toBe(1);
  });

  it('does not count an unchanged name as advancing', () => {
    expect(market(0, 0, 1, 1).breadth).toBeCloseTo(0.5, 6);
  });

  it('reports the sample it is based on', () => {
    expect(market(1, 2, 3).sampleSize).toBe(3);
  });
});

describe('normalise', () => {
  it('maps the midpoint to a half', () => {
    expect(normalise(0.8, 0.8)).toBeCloseTo(0.5, 6);
  });

  it('stays inside 0..1 however extreme the input', () => {
    for (const v of [0, 0.1, 5, 500, -500]) {
      const n = normalise(v, 0.8);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it('is monotonic, so a bigger reading always looks bigger', () => {
    // A hard clamp would peg quiet and violent markets to the same value.
    expect(normalise(2, 0.8)).toBeGreaterThan(normalise(1, 0.8));
    expect(normalise(10, 0.8)).toBeGreaterThan(normalise(2, 0.8));
  });

  it('ignores sign', () => {
    expect(normalise(-2, 0.8)).toBeCloseTo(normalise(2, 0.8), 6);
  });
});

describe('regimeFromPulse', () => {
  it('is neutral with no data rather than guessing', () => {
    expect(regimeFromPulse(EMPTY_PULSE)).toEqual({
      trend: 'neutral', volatility: 'low', breadth: 'mixed', sentiment: 'neutral',
    });
  });

  it('calls a broad rally bullish', () => {
    const r = regimeFromPulse(market(1.2, 0.9, 1.5, 1.1));
    expect(r.trend).toBe('bullish');
    expect(r.breadth).toBe('strong');
  });

  it('calls a broad selloff bearish', () => {
    const r = regimeFromPulse(market(-1.2, -0.9, -1.5, -1.1));
    expect(r.trend).toBe('bearish');
    expect(r.breadth).toBe('weak');
  });

  it('reads a flat tape as neutral and quiet', () => {
    const r = regimeFromPulse(market(0.05, -0.05, 0.02, -0.02));
    expect(r.trend).toBe('neutral');
    expect(r.volatility).toBe('low');
  });

  it('does not call a violently split market strong', () => {
    // More than half advancing, but the names are pulling apart hard — that is
    // not a healthy broad move, and calling it "strong" would mislead.
    const r = regimeFromPulse(market(6, 4, -5, -3, 2));
    expect(r.breadth).toBe('mixed');
    expect(r.volatility).toBe('high');
  });

  it('changes as the market changes', () => {
    // The whole point: the old regime was a frozen literal in the store and
    // the header read BULLISH forever.
    const a = regimeFromPulse(market(2, 2, 2));
    const b = regimeFromPulse(market(-2, -2, -2));
    expect(a.trend).not.toBe(b.trend);
  });
});
