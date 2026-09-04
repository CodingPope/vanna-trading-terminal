import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MarketData, CandlestickData, StatsForNerds, TradingPhase } from '@/types';
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
  stats: StatsForNerds;
  isConnected: boolean;
  /**
   * Where the data on screen is actually coming from. `isConnected` alone
   * could not distinguish a live socket from the local simulation, so the
   * footer read LIVE either way — next to a latency readout with nothing
   * behind it.
   */
  feedSource: 'connecting' | 'live' | 'simulated';
  lastUpdate: number;
}

const initialState: MarketSliceState = {
  entities: initEntities,
  candlesticks: initCandlesticks,
  selectedSymbol: 'AAPL',
  currentPhase: 'pre-market',
  stats: { fps: 60, memoryUsage: 0, wsLatency: 0, renderTime: 0, lastUpdate: Date.now() },
  isConnected: false,
  feedSource: 'connecting',
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
    /**
     * Merges, rather than replaces, so each producer reports only what it can
     * actually measure: the renderer knows fps and frame time, the socket knows
     * latency. Neither should be inventing the other's numbers.
     */
    setStats(state, action: PayloadAction<Partial<StatsForNerds>>) {
      Object.assign(state.stats, action.payload);
    },
    setConnected(state, action: PayloadAction<boolean>) {
      state.isConnected = action.payload;
    },
    setFeedSource(state, action: PayloadAction<MarketSliceState['feedSource']>) {
      state.feedSource = action.payload;
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
  setStats,
  setConnected,
  setFeedSource,
} = marketSlice.actions;

export default marketSlice.reducer;
