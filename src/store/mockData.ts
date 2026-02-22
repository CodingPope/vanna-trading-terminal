import type { MarketData, CandlestickData, OrderBookEntry, AnaAnalysis, FocusItem } from '@/types';

export const SYMBOLS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX', 'AMD', 'CRM',
  'UBER', 'COIN', 'PLTR', 'ARKK', 'SPY', 'QQQ', 'IWM', 'VIX', 'GLD', 'TLT',
];

export const generateMockMarketData = (symbol: string): MarketData => {
  const basePrice = Math.random() * 200 + 50;
  const change = (Math.random() - 0.5) * 10;
  return {
    symbol,
    price: basePrice,
    change,
    changePercent: (change / basePrice) * 100,
    volume: Math.floor(Math.random() * 10_000_000),
    high: basePrice + Math.random() * 5,
    low: basePrice - Math.random() * 5,
    open: basePrice - change,
    close: basePrice,
    timestamp: Date.now(),
    bid: basePrice - 0.01,
    ask: basePrice + 0.01,
    bidSize: Math.floor(Math.random() * 1000),
    askSize: Math.floor(Math.random() * 1000),
  };
};

export const generateMockCandlesticks = (_symbol: string, count = 100): CandlestickData[] => {
  const candles: CandlestickData[] = [];
  let price = 100 + Math.random() * 100;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 5;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * 2;
    const low = Math.min(open, close) - Math.random() * 2;
    candles.push({ time: now - (count - i) * 60_000, open, high, low, close, volume: Math.floor(Math.random() * 100_000) });
    price = close;
  }

  return candles;
};

export const generateMockOrderBook = (price: number): OrderBookEntry[] => {
  const entries: OrderBookEntry[] = [];

  for (let i = 0; i < 10; i++) {
    entries.push({ price: price - (i + 1) * 0.01, size: Math.floor(Math.random() * 5000) + 100, total: 0, side: 'bid' });
  }
  for (let i = 0; i < 10; i++) {
    entries.push({ price: price + (i + 1) * 0.01, size: Math.floor(Math.random() * 5000) + 100, total: 0, side: 'ask' });
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

  const basePrice = 100 + Math.random() * 100;
  const triggerPrice = basePrice + (Math.random() - 0.5) * 10;
  const invalidation = triggerPrice - (Math.random() * 5 + 2);
  const target = triggerPrice + (Math.random() * 15 + 5);

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
