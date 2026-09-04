import { describe, it, expect } from 'vitest';
import marketReducer, {
  updateMarketData,
  batchUpdateMarketData,
  appendCandle,
  setSelectedSymbol,
  setPhase,
  setConnected,
} from '../marketSlice';
import type { MarketSliceState } from '../marketSlice';
import type { MarketData, CandlestickData } from '@/types';

const makeMarketData = (symbol: string, price = 100): MarketData => ({
  symbol,
  price,
  change: 0,
  changePercent: 0,
  volume: 1_000_000,
  high: price + 1,
  low: price - 1,
  open: price,
  close: price,
  timestamp: Date.now(),
  bid: price - 0.01,
  ask: price + 0.01,
  bidSize: 500,
  askSize: 500,
});

const makeCandle = (time: number): CandlestickData => ({
  time,
  open: 100,
  high: 105,
  low: 95,
  close: 102,
  volume: 10_000,
});

describe('marketSlice', () => {
  describe('updateMarketData', () => {
    it('upserts a symbol entry', () => {
      const state = marketReducer(undefined, updateMarketData(makeMarketData('TEST', 150)));
      expect(state.entities['TEST']?.price).toBe(150);
    });

    it('updates lastUpdate', () => {
      const before = Date.now();
      const state = marketReducer(undefined, updateMarketData(makeMarketData('TEST')));
      expect(state.lastUpdate).toBeGreaterThanOrEqual(before);
    });
  });

  describe('batchUpdateMarketData', () => {
    it('updates multiple symbols in one action', () => {
      const state = marketReducer(undefined, batchUpdateMarketData([
        makeMarketData('AAA', 10),
        makeMarketData('BBB', 20),
      ]));
      expect(state.entities['AAA']?.price).toBe(10);
      expect(state.entities['BBB']?.price).toBe(20);
    });
  });

  describe('appendCandle', () => {
    it('appends a candle to an existing array', () => {
      let state: MarketSliceState = marketReducer(undefined, { type: '@@init' } as never);
      const symbol = Object.keys(state.candlesticks)[0]!;
      const initialLen = state.candlesticks[symbol]?.length ?? 0;
      state = marketReducer(state, appendCandle({ symbol, candle: makeCandle(Date.now()) }));
      expect(state.candlesticks[symbol]?.length).toBe(initialLen + 1);
    });

    it('caps candle array at 500 entries', () => {
      let state: MarketSliceState = marketReducer(undefined, { type: '@@init' } as never);
      const symbol = 'CAP_TEST';
      // Seed 500 candles
      for (let i = 0; i < 500; i++) {
        state = marketReducer(state, appendCandle({ symbol, candle: makeCandle(i) }));
      }
      // One more should not exceed 500
      state = marketReducer(state, appendCandle({ symbol, candle: makeCandle(500) }));
      expect(state.candlesticks[symbol]?.length).toBeLessThanOrEqual(500);
    });
  });

  describe('setSelectedSymbol', () => {
    it('updates selectedSymbol', () => {
      const state = marketReducer(undefined, setSelectedSymbol('TSLA'));
      expect(state.selectedSymbol).toBe('TSLA');
    });
  });

  describe('setPhase', () => {
    it('updates currentPhase', () => {
      const state = marketReducer(undefined, setPhase('open'));
      expect(state.currentPhase).toBe('open');
    });
  });

  describe('setConnected', () => {
    it('sets isConnected to true', () => {
      const state = marketReducer(undefined, setConnected(true));
      expect(state.isConnected).toBe(true);
    });

    it('sets isConnected to false', () => {
      const state = marketReducer(undefined, setConnected(false));
      expect(state.isConnected).toBe(false);
    });
  });
});
