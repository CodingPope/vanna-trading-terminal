import { describe, it, expect } from 'vitest';
import { FeedTelemetry, RollingSamples, NO_SAMPLES } from '../telemetry';

/**
 * A latency number a reader cannot check is worse than no number. These tests
 * pin the two claims the panel rests on: the percentiles come from a stated
 * window, and nothing here subtracts one machine's clock from another's.
 */

describe('RollingSamples', () => {
  it('reports unavailable rather than zero before anything is measured', () => {
    expect(new RollingSamples().summary()).toEqual(NO_SAMPLES);
    expect(new RollingSamples().percentile(95)).toBeNull();
  });

  it('takes percentiles by nearest rank over the window', () => {
    const samples = new RollingSamples(100);
    for (let value = 1; value <= 100; value++) samples.add(value);
    expect(samples.percentile(50)).toBe(50);
    expect(samples.percentile(95)).toBe(95);
    expect(samples.percentile(99)).toBe(99);
    expect(samples.percentile(100)).toBe(100);
  });

  it('forgets beyond its capacity, so a spike cannot hide behind history', () => {
    const samples = new RollingSamples(4);
    for (const value of [100, 100, 100, 100, 1, 2, 3, 4]) samples.add(value);
    expect(samples.length).toBe(4);
    expect(samples.total).toBe(8);
    expect(samples.percentile(99)).toBe(4);
  });

  it('ignores values that are not numbers to measure', () => {
    const samples = new RollingSamples();
    samples.add(Number.NaN);
    samples.add(Number.POSITIVE_INFINITY);
    expect(samples.length).toBe(0);
  });

  it('refuses a capacity that cannot hold a sample', () => {
    expect(() => new RollingSamples(0)).toThrow(/positive integer/);
  });
});

describe('FeedTelemetry', () => {
  const stamp = (seq: number, emittedNs: bigint) => ({ seq, emittedNs: emittedNs.toString() });

  it('cancels the clock offset between server and browser', () => {
    const telemetry = new FeedTelemetry();
    // The server clock reads far from the browser clock — the usual case, since
    // they share no epoch. Only the intervals matter.
    const base = 900_000_000_000_000n;
    telemetry.observe(stamp(1, base), 10);
    telemetry.observe(stamp(2, base + 100_000_000n), 115);   // sent +100ms, seen +105ms
    telemetry.observe(stamp(3, base + 200_000_000n), 215);   // sent +100ms, seen +100ms
    const jitter = telemetry.snapshot().transportJitterMs;
    expect(jitter.count).toBe(2);
    expect(jitter.p50).toBeCloseTo(0, 6);
    expect(jitter.p99).toBeCloseTo(5, 6);
  });

  it('counts frames the server sent that never arrived', () => {
    const telemetry = new FeedTelemetry();
    const base = 1_000n;
    telemetry.observe(stamp(1, base), 0);
    telemetry.observe(stamp(4, base + 1_000_000n), 1);
    expect(telemetry.snapshot().lostFrames).toBe(2);
  });

  it('starts over on reconnect rather than reporting a phantom loss', () => {
    const telemetry = new FeedTelemetry();
    telemetry.observe(stamp(9, 5_000n), 0);
    telemetry.observe(stamp(1, 9_000n), 1);   // A fresh connection restarts at 1.
    expect(telemetry.snapshot().lostFrames).toBe(0);
    expect(telemetry.snapshot().transportJitterMs.count).toBe(0);
  });

  it('says how many frames arrived without a stamp, so "off" is visible', () => {
    const telemetry = new FeedTelemetry();
    telemetry.observe(undefined, 0);
    telemetry.observe(undefined, 1);
    telemetry.observe(stamp(1, 1_000n), 2);
    const snapshot = telemetry.snapshot();
    expect(snapshot.unstampedFrames).toBe(2);
    expect(snapshot.stampedFrames).toBe(1);
    expect(snapshot.transportJitterMs).toEqual(NO_SAMPLES);
  });

  it('measures processing, frame delay, and round trip on the browser clock', () => {
    const telemetry = new FeedTelemetry();
    telemetry.commit(100, 103.5);
    telemetry.frame(16.7);
    telemetry.roundTrip(42);
    const snapshot = telemetry.snapshot();
    expect(snapshot.processingMs.p50).toBeCloseTo(3.5, 6);
    expect(snapshot.frameDelayMs.p50).toBeCloseTo(16.7, 6);
    expect(snapshot.roundTripMs.p50).toBe(42);
  });

  it('measures replay lag in event time, exactly, past 2^53 nanoseconds', () => {
    const telemetry = new FeedTelemetry();
    // Two readings of the same replay clock, 250ms apart, at a nanosecond epoch
    // that a JS number cannot represent.
    telemetry.replayLag('1789678816585999872', '1789678816335999872');
    expect(telemetry.snapshot().replayLagMs.p50).toBeCloseTo(250, 6);
  });

  it('clears everything on reset, including the sequence it was following', () => {
    const telemetry = new FeedTelemetry();
    telemetry.observe(stamp(1, 1_000n), 0);
    telemetry.observe(stamp(3, 2_000n), 1);
    telemetry.commit(0, 1);
    telemetry.reset();
    expect(telemetry.snapshot()).toEqual({
      transportJitterMs: NO_SAMPLES, processingMs: NO_SAMPLES, frameDelayMs: NO_SAMPLES,
      roundTripMs: NO_SAMPLES, replayLagMs: NO_SAMPLES,
      lostFrames: 0, stampedFrames: 0, unstampedFrames: 0,
    });
  });
});
