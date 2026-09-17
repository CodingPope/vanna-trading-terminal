import { describe, expect, it } from 'vitest';
import { computeVWAP } from '../vwap';
const candles = [10, 20, 30].map((price, i) => ({ time: i, open: price, high: price, low: price, close: price, volume: [100, 200, 100][i] }));
describe('window and anchored VWAP', () => {
  it('weights by volume and keeps the window value independent of the anchor', () => {
    expect(computeVWAP(candles).at(-1)).toBe(20);
    expect(computeVWAP(candles, 2)).toEqual([null, null, 30]);
    expect(computeVWAP(candles).at(-1)).toBe(20);
  });
  it('reports no value for zero volume or an anchor beyond loaded history', () => {
    expect(computeVWAP(candles, 3)).toEqual([null, null, null]);
    expect(computeVWAP([{ ...candles[0], volume: 0 }])).toEqual([null]);
  });
});
