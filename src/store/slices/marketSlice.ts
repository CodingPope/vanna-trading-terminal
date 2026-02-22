import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MarketData, CandlestickData, MarketRegime, StatsForNerds, TradingPhase } from '@/types';
import { SYMBOLS, generateMockMarketData, generateMockCandlesticks } from '../mockData';

// Serializable Record (RTK requires no Maps)
const initEntities: Record<string, MarketData> = {};
const initCandlesticks: Record<string, CandlestickData[]> = {};
SYMBOLS.forEach(s => {
  initEntities[s] = generateMockMarketData(s);
  initCandlesticks[s] = generateMockCandlesticks(s);
});

export interface MarketSliceState {
  entities: Record<string, MarketData>;
  candlesticks: Record<string, CandlestickData[]>;
  selectedSymbol: string;
  currentPhase: TradingPhase['id'];
  marketRegime: MarketRegime;
  stats: StatsForNerds;
  isConnected: boolean;
  lastUpdate: number;
}

const initialState: MarketSliceState = {
  entities: initEntities,
  candlesticks: initCandlesticks,
  selectedSymbol: 'AAPL',
  currentPhase: 'pre-market',
  marketRegime: { trend: 'bullish', volatility: 'medium', breadth: 'strong', sentiment: 'neutral' },
  stats: { fps: 60, memoryUsage: 0, wsLatency: 0, renderTime: 0, lastUpdate: Date.now() },
  isConnected: false,
  lastUpdate: Date.now(),
};

export const marketSlice = createSlice({
  name: 'market',
  initialState,
  reducers: {
    updateMarketData(state, action: PayloadAction<MarketData>) {
      state.entities[action.payload.symbol] = action.payload;
      state.lastUpdate = Date.now();
    },
    batchUpdateMarketData(state, action: PayloadAction<MarketData[]>) {
      action.payload.forEach(d => { state.entities[d.symbol] = d; });
      state.lastUpdate = Date.now();
    },
    updateCandlesticks(state, action: PayloadAction<{ symbol: string; data: CandlestickData[] }>) {
      state.candlesticks[action.payload.symbol] = action.payload.data;
    },
    appendCandle(state, action: PayloadAction<{ symbol: string; candle: CandlestickData }>) {
      const candles = state.candlesticks[action.payload.symbol] ?? [];
      candles.push(action.payload.candle);
      if (candles.length > 500) candles.splice(0, candles.length - 500);
      state.candlesticks[action.payload.symbol] = candles;
    },
    setSelectedSymbol(state, action: PayloadAction<string>) {
      state.selectedSymbol = action.payload;
    },
    setPhase(state, action: PayloadAction<TradingPhase['id']>) {
      state.currentPhase = action.payload;
    },
    setMarketRegime(state, action: PayloadAction<MarketRegime>) {
      state.marketRegime = action.payload;
    },
    setStats(state, action: PayloadAction<StatsForNerds>) {
      state.stats = action.payload;
    },
    setConnected(state, action: PayloadAction<boolean>) {
      state.isConnected = action.payload;
    },
  },
});

export const {
  updateMarketData,
  batchUpdateMarketData,
  updateCandlesticks,
  appendCandle,
  setSelectedSymbol,
  setPhase,
  setMarketRegime,
  setStats,
  setConnected,
} = marketSlice.actions;

export default marketSlice.reducer;
