/**
 * Measures real client-side render performance and reports it to the store.
 *
 * These are browser-side numbers — no backend can supply them, which is why
 * this does not live with the market feed and must survive the mock -> WebSocket
 * swap. `wsLatency` is deliberately absent: only a real socket can measure it.
 *
 * Runs its own rAF loop, separate from whatever is driving market data, so
 * instrumentation and data delivery stay independent.
 */
import { useEffect } from 'react';
import { useAppDispatch } from '@/store/hooks';
import { setStats } from '@/store/slices/marketSlice';

const SAMPLE_WINDOW_MS = 1000;

type PerformanceWithMemory = Performance & {
  memory?: { usedJSHeapSize: number };
};

export function usePerformanceStats() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let peakFrameMs = 0;
    let lastFrameAt = performance.now();
    let windowStartedAt = lastFrameAt;

    const tick = () => {
      const now = performance.now();
      const frameMs = now - lastFrameAt;
      lastFrameAt = now;
      frames += 1;
      if (frameMs > peakFrameMs) peakFrameMs = frameMs;

      const elapsed = now - windowStartedAt;
      if (elapsed >= SAMPLE_WINDOW_MS) {
        // `performance.memory` is Chromium-only. Report 0 where it is
        // unavailable and let the UI show that as unknown, rather than
        // inventing a plausible-looking number.
        const mem = (performance as PerformanceWithMemory).memory;

        dispatch(setStats({
          fps: Math.round((frames * 1000) / elapsed),
          // Worst frame in the window — the jank number, not the average,
          // which would just be the reciprocal of fps.
          renderTime: Math.round(peakFrameMs),
          memoryUsage: mem ? Math.round(mem.usedJSHeapSize / 1_048_576) : 0,
          lastUpdate: Date.now(),
        }));

        frames = 0;
        peakFrameMs = 0;
        windowStartedAt = now;
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dispatch]);
}
