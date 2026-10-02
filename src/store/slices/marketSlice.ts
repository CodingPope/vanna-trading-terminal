import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MarketData, CandlestickData, StatsForNerds, TradingPhase } from '@/types';
import type { TelemetrySnapshot } from '@/lib/telemetry';
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
  sourceMode: 'synthetic' | 'replay' | 'recorded';
  lastReceivedAt: number;
  /**
   * Symbols that have actually received a quote from the connected feed.
   *
   * The watchlist covers a fixed 20-symbol universe, but a recorded fixture
   * usually covers far fewer. Symbols outside that coverage never receive an
   * `updateMarketData` dispatch, so their entity stays exactly as it was
   * seeded at module load — a plausible-looking price that will never move.
   * This tracks which symbols are backed by a real dispatch, so a panel can
   * tell "live" apart from "frozen leftover" instead of presenting both the
   * same way. Only ever grows; a brief disconnect doesn't retroactively make
   * a symbol's prior data fake.
   */
  liveSymbols: Record<string, true>;
  diagnostics: { received: number; invalid: number; dropped: number; gaps: number; reconnects: number; queueDepth: number; peakQueue: number; processingMs: number };
  /**
   * Measured feed health. Null until the first sampling window closes, so the
   * panel can say "no samples yet" instead of showing a row of zeroes.
   */
  measurements: PerformanceReport | null;
}

/** What the transport can measure about itself. See docs/PERFORMANCE.md. */
export interface PerformanceReport extends TelemetrySnapshot {
  /** Feed envelopes decoded per second over the last window. */
  eventRate: number;
  /** Main-thread blocks of 50ms or more, or null where unobservable. */
  longTasks: number | null;
  longTaskMs: number | null;
  reconnects: number;
  /** Display quotes shed under backpressure. Never executions. */
  droppedDisplay: number;
  bookGaps: number;
  /** Samples each percentile is drawn from, at most. */
  windowSize: number;
}

const initialState: MarketSliceState = {
  sourceMode: 'synthetic', lastReceivedAt: 0, measurements: null, liveSymbols: {},
  diagnostics: { received: 0, invalid: 0, dropped: 0, gaps: 0, reconnects: 0, queueDepth: 0, peakQueue: 0, processingMs: 0 },
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
    setSourceMode(state, action: PayloadAction<'synthetic' | 'replay' | 'recorded'>) { state.sourceMode = action.payload; },
    setDiagnostics(state, action: PayloadAction<Partial<MarketSliceState['diagnostics']>>) { Object.assign(state.diagnostics, action.payload); },
    setMeasurements(state, action: PayloadAction<PerformanceReport | null>) { state.measurements = action.payload; },
    upsertCandle(state, action: PayloadAction<{ symbol: string; candle: CandlestickData }>) {
      const { symbol, candle } = action.payload;
      const candles = state.candlesticks[symbol] ?? [];
      const last = candles[candles.length - 1];
      if (last && last.time > candle.time) return;
      if (last?.time === candle.time) candles[candles.length - 1] = candle;
      else candles.push(candle);
      state.candlesticks[symbol] = candles.slice(-500);
    },
    updateMarketData(state, action: PayloadAction<MarketData>) {
      state.entities[action.payload.symbol] = action.payload;
      state.liveSymbols[action.payload.symbol] = true;
      state.lastUpdate = Date.now();
      state.lastReceivedAt = state.lastUpdate;
    },
    batchUpdateMarketData(state, action: PayloadAction<MarketData[]>) {
      action.payload.forEach(d => { state.entities[d.symbol] = d; state.liveSymbols[d.symbol] = true; });
      state.lastUpdate = Date.now();
      state.lastReceivedAt = state.lastUpdate;
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
  setSourceMode, setDiagnostics, setMeasurements, upsertCandle,
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
