import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render as rtlRender, screen, fireEvent, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import marketReducer, { setMeasurements, type PerformanceReport } from '@/store/slices/marketSlice';
import replayReducer, { receiveStatus } from '@/store/slices/replaySlice';
import { NO_SAMPLES } from '@/lib/telemetry';
import { PerformanceReadout } from '../PerformanceReadout';

/**
 * The panel's job is to be checkable. A reviewer should be able to tell an
 * unmeasured metric from a fast one, and to take the numbers away with the
 * environment that produced them.
 */

const summary = (p50: number, p95: number, p99: number, count = 512) => ({ count, p50, p95, p99 });

const REPORT: PerformanceReport = {
  transportJitterMs: summary(0.4, 3.1, 9.7),
  processingMs: summary(0.2, 0.9, 2.4),
  frameDelayMs: summary(16.6, 22.1, 48.3),
  roundTripMs: summary(2, 5, 11, 40),
  replayLagMs: NO_SAMPLES,
  lostFrames: 3, stampedFrames: 900, unstampedFrames: 0,
  eventRate: 120.4, longTasks: 2, longTaskMs: 130,
  reconnects: 1, droppedDisplay: 7, bookGaps: 2, windowSize: 512,
};

function makeStore() {
  return configureStore({ reducer: { market: marketReducer, replay: replayReducer } });
}

let store: ReturnType<typeof makeStore>;
const render = (onReset = () => {}) =>
  rtlRender(<Provider store={store}><PerformanceReadout onReset={onReset} /></Provider>);
const row = (metric: string) => document.querySelector(`[data-metric="${metric}"]`) as HTMLElement;

beforeEach(() => {
  store = makeStore();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PerformanceReadout', () => {
  it('says nothing has been measured rather than showing zeroes', () => {
    render();
    expect(screen.getByTestId('measurements-empty')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('shows a percentile per metric from a stated sample count', () => {
    store.dispatch(setMeasurements(REPORT));
    render();
    const jitter = within(row('transportJitterMs'));
    expect(jitter.getByText('0.4')).toBeInTheDocument();
    expect(jitter.getByText('3.1')).toBeInTheDocument();
    expect(jitter.getByText('9.7')).toBeInTheDocument();
    expect(jitter.getByText('512')).toBeInTheDocument();
    expect(within(row('roundTripMs')).getByText('40')).toBeInTheDocument();
  });

  it('marks an unmeasured metric unavailable rather than fast', () => {
    store.dispatch(setMeasurements(REPORT));
    render();
    const lag = within(row('replayLagMs'));
    expect(lag.getAllByText('—')).toHaveLength(3);
    expect(lag.getByText('0')).toBeInTheDocument();
  });

  it('reports long tasks as unavailable where the browser cannot see them', () => {
    store.dispatch(setMeasurements({ ...REPORT, longTasks: null, longTaskMs: null }));
    render();
    expect(row('longTasks')).toHaveTextContent('unavailable');
  });

  it('warns when server stamps are off, instead of reporting zero jitter', () => {
    store.dispatch(setMeasurements({
      ...REPORT, stampedFrames: 0, unstampedFrames: 400, transportJitterMs: NO_SAMPLES,
    }));
    render();
    expect(screen.getByRole('status')).toHaveTextContent('Server frame stamps are off');
  });

  it('explains every metric it shows, including the method', () => {
    store.dispatch(setMeasurements(REPORT));
    render();
    const details = screen.getByText('What these mean').closest('details') as HTMLElement;
    for (const label of ['Transport jitter', 'Receive → commit', 'Frame delay', 'Round trip', 'Replay lag']) {
      expect(within(details).getByText(label)).toBeInTheDocument();
    }
    expect(details).toHaveTextContent('nearest rank over a rolling window of the last 512 samples');
    expect(details).toHaveTextContent('One-way latency is not reported');
    // Receive to commit includes the deliberate animation-frame wait, and says so.
    expect(details).toHaveTextContent('deliberate batching, not overhead');
  });

  it('exports the numbers with the environment that produced them', () => {
    store.dispatch(setMeasurements(REPORT));
    store.dispatch(receiveStatus({
      protocolVersion: 1, fixtureId: 'aapl-open:abc', mode: 'recorded', unit: 'event',
      eventTimeNs: '1789678816585999872', startNs: '1789678816585999000',
      endNs: '1789678916585999872', speed: 2, speeds: [1, 2], playing: true, ended: false,
      sequence: 9, generation: 1, canSeek: true, canStep: true,
    }));
    // jsdom has neither object URLs nor Blob.text(), so the payload is caught
    // on its way into the Blob.
    let exported = '';
    vi.stubGlobal('Blob', class {
      constructor(parts: string[]) { exported = parts.join(''); }
    });
    Object.assign(URL, { createObjectURL: () => 'blob:vanna', revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(click).toHaveBeenCalled();
    const artifact = JSON.parse(exported);
    expect(artifact.measurements.transportJitterMs.p99).toBe(9.7);
    expect(artifact.replay).toMatchObject({ fixtureId: 'aapl-open:abc', mode: 'recorded', speed: 2 });
    expect(artifact.method).toMatchObject({ window: 512, percentile: 'nearest rank' });
    expect(artifact.environment.userAgent).toBeTruthy();
    expect(artifact.takenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('hands the reset straight to the feed that owns the counters', () => {
    const onReset = vi.fn();
    store.dispatch(setMeasurements(REPORT));
    render(onReset);
    fireEvent.click(screen.getByRole('button', { name: 'Reset measurements' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
