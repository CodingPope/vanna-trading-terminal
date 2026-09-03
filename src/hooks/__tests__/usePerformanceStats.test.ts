import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePerformanceStats } from '../usePerformanceStats';

const dispatch = vi.fn();
vi.mock('@/store/hooks', () => ({
  useAppDispatch: () => dispatch,
}));

/**
 * Drives the hook's rAF loop by hand so frame timing is deterministic:
 * `step(ms)` advances performance.now() and runs one frame.
 */
function installFrameClock() {
  let now = 0;
  let pending: FrameRequestCallback | null = null;

  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pending = null;
  });

  return (ms: number) => {
    now += ms;
    const cb = pending;
    pending = null;
    cb?.(now);
  };
}

describe('usePerformanceStats', () => {
  beforeEach(() => dispatch.mockClear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports fps from the actual frame count, not a constant', () => {
    const step = installFrameClock();
    renderHook(() => usePerformanceStats());

    // 50 frames of 20ms = exactly 1000ms, i.e. 50fps.
    for (let i = 0; i < 50; i++) step(20);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].payload).toMatchObject({ fps: 50 });
  });

  it('distinguishes a slower frame rate', () => {
    const step = installFrameClock();
    renderHook(() => usePerformanceStats());

    // 10 frames of 100ms = 1000ms, i.e. 10fps.
    for (let i = 0; i < 10; i++) step(100);

    expect(dispatch.mock.calls[0][0].payload.fps).toBe(10);
  });

  it('reports the worst frame in the window, not the average', () => {
    const step = installFrameClock();
    renderHook(() => usePerformanceStats());

    for (let i = 0; i < 48; i++) step(10);
    step(120); // one janky frame
    step(400); // closes the 1000ms window

    expect(dispatch.mock.calls[0][0].payload.renderTime).toBe(400);
  });

  it('never reports wsLatency — only a socket can measure that', () => {
    const step = installFrameClock();
    renderHook(() => usePerformanceStats());
    for (let i = 0; i < 50; i++) step(20);

    expect(dispatch.mock.calls[0][0].payload).not.toHaveProperty('wsLatency');
  });

  it('reports memory as 0 rather than inventing a value when unavailable', () => {
    const step = installFrameClock();
    // jsdom has no performance.memory.
    renderHook(() => usePerformanceStats());
    for (let i = 0; i < 50; i++) step(20);

    expect(dispatch.mock.calls[0][0].payload.memoryUsage).toBe(0);
  });
});
