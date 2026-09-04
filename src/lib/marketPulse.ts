/**
 * Reduces the whole market to four numbers.
 *
 * The landing page calls this "peripheral market awareness", which is a useful
 * test for every value here: it has to be readable at a glance, without
 * reading any number. These four feed the orb.
 *
 * They are continuous on purpose. `MarketRegime` is a set of three-value enums
 * (high/medium/low), so driving a shader from it gave 27 possible appearances
 * total — the orb looked frozen even when the market moved, because the
 * buckets rarely changed. Labels are derived from these numbers for text
 * display, not the other way round.
 */
import type { MarketData, MarketRegime } from '@/types';

export interface MarketPulse {
  /**
   * Cross-sectional dispersion: how far names deviate from the average move,
   * as a fraction. Low means everything is moving together — one macro trade.
   * High means names are diverging and selection matters.
   */
  dispersion: number;
  /** Average absolute move. How much is happening, regardless of direction. */
  volatility: number;
  /** Average signed move. Which way the market as a whole is leaning. */
  trend: number;
  /** Share of names advancing, 0 to 1. How broad the move is. */
  breadth: number;
  /** Symbols the reading is based on. Zero means no data yet. */
  sampleSize: number;
}

export const EMPTY_PULSE: MarketPulse = {
  dispersion: 0,
  volatility: 0,
  trend: 0,
  breadth: 0.5,
  sampleSize: 0,
};

export function computeMarketPulse(quotes: MarketData[]): MarketPulse {
  if (quotes.length === 0) return EMPTY_PULSE;

  const changes = quotes.map(q => q.changePercent);
  const n = changes.length;

  const trend = changes.reduce((a, c) => a + c, 0) / n;
  const volatility = changes.reduce((a, c) => a + Math.abs(c), 0) / n;

  // Population standard deviation around the mean move. This is the dispersion
  // statistic proper: deviation from the average is exactly what the orb's
  // surface displacement represents, so the geometry is the statistic rather
  // than a decoration layered over it.
  const variance = changes.reduce((a, c) => a + (c - trend) ** 2, 0) / n;
  const dispersion = Math.sqrt(variance);

  const advancing = changes.filter(c => c > 0).length;

  return {
    dispersion,
    volatility,
    trend,
    breadth: advancing / n,
    sampleSize: n,
  };
}

/**
 * Squash an unbounded reading into 0..1 for a shader uniform.
 *
 * `half` is the value that should map to 0.5, which keeps the scale honest
 * across symbols of wildly different volatility — a 2% move means something
 * different for TLT than for COIN, and a linear clamp would peg one and
 * flatten the other.
 */
export function normalise(value: number, half: number): number {
  if (half <= 0) return 0;
  const x = Math.abs(value);
  return x / (x + half);
}

/**
 * Midpoints, in percent.
 *
 * Calibrated against what the feed actually produces rather than against what
 * a trading day "should" look like: measured live, dispersion sits near 0.8%,
 * volatility near 0.6% and the average move near 0.15%. Setting the trend
 * midpoint at 0.5 put a typical tape at 0.24 on a 0..1 scale, so the orb
 * hovered near neutral and read as unresponsive even though the numbers were
 * moving underneath it.
 *
 * A market that is genuinely flat should still look flat — that is the point —
 * but the midpoint has to sit inside the range the data occupies.
 */
export const PULSE_SCALE = {
  dispersion: 0.7,
  volatility: 0.6,
  trend: 0.15,
} as const;

/**
 * The text labels shown in the header and morning brief.
 *
 * Derived from the same numbers the orb uses, so the badge and the sphere can
 * never disagree. This used to be a hardcoded object in the store that nothing
 * ever updated — the header read "REGIME BULLISH" permanently, whatever prices
 * did.
 */
export function regimeFromPulse(pulse: MarketPulse): MarketRegime {
  const { trend, volatility, breadth, dispersion, sampleSize } = pulse;

  if (sampleSize === 0) {
    return { trend: 'neutral', volatility: 'low', breadth: 'mixed', sentiment: 'neutral' };
  }

  return {
    trend: trend > 0.15 ? 'bullish' : trend < -0.15 ? 'bearish' : 'neutral',
    volatility: volatility > 1.2 ? 'high' : volatility > 0.4 ? 'medium' : 'low',
    // Breadth is about participation; dispersion tells you whether the move is
    // one trade or many, so a broad tape with names pulling apart reads mixed.
    breadth:
      breadth > 0.65 && dispersion < 1.5 ? 'strong'
      : breadth < 0.35 && dispersion < 1.5 ? 'weak'
      : 'mixed',
    sentiment:
      trend > 0.3 && breadth > 0.6 ? 'greed'
      : trend < -0.3 && breadth < 0.4 ? 'fear'
      : 'neutral',
  };
}
