import type { CandlestickData } from '@/types';
/** Bar-typical-price approximation over loaded history; not exchange tick VWAP. */
export function computeVWAP(candles: CandlestickData[], fromIndex = 0): (number | null)[] {
  let pv = 0, volume = 0;
  return candles.map((c, index) => {
    if (index < fromIndex) return null;
    pv += ((c.high + c.low + c.close) / 3) * c.volume;
    volume += c.volume;
    return volume ? pv / volume : null;
  });
}
