import type { MarketData, CandlestickData, OrderBookEntry, AnaAnalysis, FocusItem } from '@/types';

export const SYMBOLS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX', 'AMD', 'CRM',
  'UBER', 'COIN', 'PLTR', 'ARKK', 'SPY', 'QQQ', 'IWM', 'VIX', 'GLD', 'TLT',
];

interface SymbolSeed {
  /** Rough price anchor, so a ticker at least lands in its own postcode. */
  price: number;
  /** Movement multiplier, 1.0 being a typical large-cap. */
  volatility: number;
}

/**
 * Starting points for the simulated feed.
 *
 * These are approximate anchors, NOT quotes — they are hardcoded, they do not
 * update, and they drift further from reality every day this file is not
 * touched. They exist so the terminal does not price AAPL at $73 next to a
 * $180 VIX, which the previous `Math.random() * 200 + 50` did regardless of
 * symbol.
 *
 * The replay fixture supersedes all of this once the backend lands; this is
 * the fallback for when no session is loaded.
 */
const SYMBOL_SEEDS: Record<string, SymbolSeed> = {
  AAPL: { price: 232, volatility: 0.8 },
  MSFT: { price: 438, volatility: 0.7 },
  GOOGL: { price: 178, volatility: 0.9 },
  AMZN: { price: 205, volatility: 0.9 },
  TSLA: { price: 342, volatility: 2.2 },
  NVDA: { price: 141, volatility: 1.8 },
  META: { price: 604, volatility: 1.1 },
  NFLX: { price: 890, volatility: 1.2 },
  AMD: { price: 152, volatility: 1.6 },
  CRM: { price: 276, volatility: 1.0 },
  UBER: { price: 74, volatility: 1.2 },
  COIN: { price: 248, volatility: 2.6 },
  PLTR: { price: 82, volatility: 2.4 },
  ARKK: { price: 63, volatility: 1.7 },
  SPY: { price: 598, volatility: 0.4 },
  QQQ: { price: 522, volatility: 0.5 },
  IWM: { price: 228, volatility: 0.7 },
  VIX: { price: 15.4, volatility: 3.0 },
  GLD: { price: 251, volatility: 0.4 },
  TLT: { price: 89, volatility: 0.5 },
};

const FALLBACK_SEED: SymbolSeed = { price: 100, volatility: 1.0 };

export const getSymbolSeed = (symbol: string): SymbolSeed =>
  SYMBOL_SEEDS[symbol] ?? FALLBACK_SEED;

/**
 * Per-tick movement as a fraction of price.
 *
 * Proportional rather than absolute: the old feed moved every symbol by up to
 * ±$0.25 a tick, which is a rounding error on a $600 SPY and a 1.6% lurch on
 * a $15 VIX.
 */
export const tickMagnitude = (symbol: string): number =>
  getSymbolSeed(symbol).volatility * 0.00015;

/** Quoted spread — a penny on liquid names, wider as price scales up. */
export const spreadFor = (price: number): number =>
  Math.max(0.01, Number((price * 0.00005).toFixed(2)));

export const generateMockMarketData = (symbol: string): MarketData => {
  const { price: basePrice, volatility } = getSymbolSeed(symbol);
  // Open somewhere plausible for the session, then express the day's move
  // relative to that rather than as a flat ±$5 for everything.
  const open = basePrice * (1 + (Math.random() - 0.5) * 0.01 * volatility);
  const price = open * (1 + (Math.random() - 0.5) * 0.02 * volatility);
  const change = price - open;
  const spread = spreadFor(price);

  return {
    symbol,
    price,
    change,
    changePercent: (change / open) * 100,
    volume: Math.floor(Math.random() * 10_000_000),
    high: Math.max(open, price) * (1 + Math.random() * 0.004 * volatility),
    low: Math.min(open, price) * (1 - Math.random() * 0.004 * volatility),
    open,
    close: price,
    timestamp: Date.now(),
    bid: price - spread / 2,
    ask: price + spread / 2,
    bidSize: Math.floor(Math.random() * 1000),
    askSize: Math.floor(Math.random() * 1000),
  };
};

export const generateMockCandlesticks = (symbol: string, count = 100): CandlestickData[] => {
  const { price: seedPrice, volatility } = getSymbolSeed(symbol);
  const candles: CandlestickData[] = [];
  const now = Date.now();

  // Walk backwards from the seed so the last candle lands near the quoted
  // price, rather than starting the chart at an unrelated random level.
  let price = seedPrice * (1 - (Math.random() - 0.5) * 0.02 * volatility);

  for (let i = 0; i < count; i++) {
    const open = price;
    const close = open * (1 + (Math.random() - 0.5) * 0.004 * volatility);
    const high = Math.max(open, close) * (1 + Math.random() * 0.002 * volatility);
    const low = Math.min(open, close) * (1 - Math.random() * 0.002 * volatility);
    candles.push({ time: now - (count - i) * 60_000, open, high, low, close, volume: Math.floor(Math.random() * 100_000) });
    price = close;
  }

  return candles;
};

export const generateMockOrderBook = (price: number): OrderBookEntry[] => {
  const entries: OrderBookEntry[] = [];
  // Ladder step scales with price: a penny-wide book is right for a $70 name
  // and absurdly tight for a $900 one.
  const step = Math.max(0.01, Number((price * 0.00005).toFixed(2)));

  for (let i = 0; i < 10; i++) {
    entries.push({ price: price - (i + 1) * step, size: Math.floor(Math.random() * 5000) + 100, total: 0, side: 'bid' });
  }
  for (let i = 0; i < 10; i++) {
    entries.push({ price: price + (i + 1) * step, size: Math.floor(Math.random() * 5000) + 100, total: 0, side: 'ask' });
  }

  let bidTotal = 0;
  let askTotal = 0;
  entries.forEach(e => {
    if (e.side === 'bid') { bidTotal += e.size; e.total = bidTotal; }
    else { askTotal += e.size; e.total = askTotal; }
  });

  return entries.sort((a, b) => b.price - a.price);
};

export const generateMockAnaAnalysis = (symbol: string): AnaAnalysis => {
  const setups: AnaAnalysis['setupType'][] = ['breakout', 'pullback', 'reversal', 'continuation', 'range'];
  const regimes: AnaAnalysis['regimeFit'][] = ['strong', 'moderate', 'weak'];
  const verdicts: AnaAnalysis['verdict'][] = ['VALID', 'NO_TRADE', 'STANDBY'];

  // Levels have to be anchored to the symbol's own price and scaled to its
  // volatility. Anchoring on `100 + Math.random() * 100` produced a $141
  // trigger for a stock quoted at $232 — a setup nobody could act on, sitting
  // next to a chart showing the real level.
  const { price: basePrice, volatility } = getSymbolSeed(symbol);
  const band = basePrice * 0.01 * volatility;

  const triggerPrice = basePrice + (Math.random() - 0.5) * band;
  const invalidation = triggerPrice - (Math.random() * band + band * 0.4);
  const target = triggerPrice + (Math.random() * band * 3 + band);

  return {
    symbol,
    setupType: setups[Math.floor(Math.random() * setups.length)],
    triggerPrice: Number(triggerPrice.toFixed(2)),
    invalidationLevel: Number(invalidation.toFixed(2)),
    targetPrice: Number(target.toFixed(2)),
    regimeFit: regimes[Math.floor(Math.random() * regimes.length)],
    riskRewardRatio: Number(((target - triggerPrice) / (triggerPrice - invalidation)).toFixed(2)),
    verdict: verdicts[Math.floor(Math.random() * verdicts.length)],
    confidence: Math.floor(Math.random() * 40) + 60,
    notes: `Setup based on ${Math.random() > 0.5 ? 'volume profile' : 'price action'} analysis.`,
  };
};

export const generateInitialFocusList = (marketEntities: Record<string, MarketData>): FocusItem[] => {
  return SYMBOLS.slice(0, 12)
    .map((symbol, index) => ({
      symbol,
      name: symbol,
      sector: (['Tech', 'Finance', 'Healthcare', 'Energy'] as const)[Math.floor(Math.random() * 4)],
      setupQuality: Math.floor(Math.random() * 30) + 70 - index * 3,
      anaAnalysis: generateMockAnaAnalysis(symbol),
      marketData: marketEntities[symbol],
      tags: ['momentum', 'volume', 'breakout'].slice(0, Math.floor(Math.random() * 3) + 1),
    }))
    .sort((a, b) => b.setupQuality - a.setupQuality);
};
