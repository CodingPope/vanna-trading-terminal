/**
 * TradingView Lightweight Charts integration.
 * Handles candlesticks, volume, VWAP, and anchored VWAP with rAF-throttled updates.
 */
import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData as LWCandlestick,
  type HistogramData,
  type LineData,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { CandlestickData, MarketData } from '@/types';

interface LightweightChartProps {
  candlesticks: CandlestickData[];
  marketData?: MarketData;
  showVolume?: boolean;
  anchorTs?: number | null;
  onAnchor?: (ts: number) => void;
}

// Convert millisecond timestamp → seconds (lightweight-charts uses UTCTimestamp in seconds)
function msToSec(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

function computeVWAP(candles: CandlestickData[], fromIndex = 0): (number | null)[] {
  let cumPV = 0;
  let cumVol = 0;
  return candles.map((c, i) => {
    if (i < fromIndex) return null;
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumVol += c.volume;
    return cumVol ? cumPV / cumVol : c.close;
  });
}

export function LightweightChart({
  candlesticks,
  marketData,
  showVolume = true,
  anchorTs,
  onAnchor,
}: LightweightChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const avwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingUpdateRef = useRef<CandlestickData | null>(null);

  // Initialize chart once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#606080',
        fontSize: 10,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.2)', style: 1 },
        horzLine: { color: 'rgba(255,255,255,0.2)', style: 1 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)',
      },
      width: container.clientWidth,
      height: container.clientHeight,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(96,96,128,0.3)',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const vwapLine = chart.addSeries(LineSeries, {
      color: '#7dd3fc',
      lineWidth: 1,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const avwapLine = chart.addSeries(LineSeries, {
      color: '#f97316',
      lineWidth: 1,
      lineStyle: 2, // dashed
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volSeries;
    vwapSeriesRef.current = vwapLine;
    avwapSeriesRef.current = avwapLine;

    // Handle click → set anchor
    chart.subscribeClick((param) => {
      if (param.time && onAnchor) {
        onAnchor((param.time as number) * 1000);
      }
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (container && chartRef.current) {
        chartRef.current.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Set full candlestick dataset
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;
    if (!candlesticks.length) return;

    // Sort ascending by time (required by lightweight-charts)
    const sorted = [...candlesticks].sort((a, b) => a.time - b.time);

    const lwData: LWCandlestick[] = sorted.map(c => ({
      time: msToSec(c.time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volData: HistogramData[] = sorted.map(c => ({
      time: msToSec(c.time),
      value: c.volume,
      color: c.close >= c.open ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)',
    }));

    candleSeriesRef.current.setData(lwData);
    volumeSeriesRef.current.setData(showVolume ? volData : []);

    // VWAP
    const vwapValues = computeVWAP(sorted);
    const vwapData: LineData[] = sorted
      .map((c, i) => vwapValues[i] !== null ? { time: msToSec(c.time), value: vwapValues[i]! } : null)
      .filter(Boolean) as LineData[];
    vwapSeriesRef.current?.setData(vwapData);

    // Anchored VWAP
    if (anchorTs !== null && anchorTs !== undefined) {
      const anchorIdx = sorted.findIndex(c => c.time >= anchorTs);
      const avwapValues = computeVWAP(sorted, Math.max(0, anchorIdx));
      const avwapData: LineData[] = sorted
        .map((c, i) => avwapValues[i] !== null ? { time: msToSec(c.time), value: avwapValues[i]! } : null)
        .filter(Boolean) as LineData[];
      avwapSeriesRef.current?.setData(avwapData);
    } else {
      avwapSeriesRef.current?.setData([]);
    }
  }, [candlesticks, showVolume, anchorTs]);

  // Real-time tick update — rAF throttled to ~60fps
  const scheduleUpdate = useCallback((data: CandlestickData) => {
    pendingUpdateRef.current = data;
    if (rafRef.current) return; // already scheduled
    rafRef.current = requestAnimationFrame(() => {
      const pending = pendingUpdateRef.current;
      if (pending && candleSeriesRef.current) {
        candleSeriesRef.current.update({
          time: msToSec(pending.time),
          open: pending.open,
          high: pending.high,
          low: pending.low,
          close: pending.close,
        });
      }
      pendingUpdateRef.current = null;
      rafRef.current = null;
    });
  }, []);

  // When the price changes, update the last candle in real-time
  const price = marketData?.price;
  useEffect(() => {
    if (price === undefined || !candlesticks.length) return;
    const last = candlesticks[candlesticks.length - 1];
    if (!last) return;
    scheduleUpdate({
      ...last,
      close: price,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
    });
  }, [price, candlesticks, scheduleUpdate]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ cursor: 'crosshair' }}
      aria-label="Price chart"
    />
  );
}
