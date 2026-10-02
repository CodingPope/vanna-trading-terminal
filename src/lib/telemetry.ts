/**
 * Feed measurement.
 *
 * The hard constraint is clock domains. The server stamps frames with its own
 * monotonic clock and the browser reads `performance.now()`; the two share no
 * epoch and are not synchronised, so their difference is an unknown constant
 * plus the thing we want. Subtracting one from the other produces a number that
 * looks like one-way latency and is not.
 *
 * What survives that constraint:
 *
 * - **Transport jitter.** Compare the gap between two frames as the server sent
 *   them with the gap as the browser received them. Both are intervals inside
 *   one clock domain, so the unknown offset cancels. What is left is how much
 *   the network and the event loop stretched or compressed the stream.
 * - **Processing latency.** Receive to store commit, browser clock only.
 * - **Frame delay.** Time between drain frames, browser clock only.
 * - **Round trip.** Ping to pong, browser clock only. A round trip is honest;
 *   halving it to claim one-way latency is not.
 * - **Replay lag.** How far the rendered state trails the replay clock, both
 *   read in replay event time.
 * - **Lost frames.** Gaps in the per-connection frame sequence.
 *
 * Definitions and method live in docs/PERFORMANCE.md.
 */

/** Stamped by the server on send. See docs/PERFORMANCE.md. */
export interface FrameStamp {
  /** Per-connection monotonic frame counter, starting at 1. */
  seq: number;
  /** Server monotonic nanoseconds, as a decimal string. Not a wall clock. */
  emittedNs: string;
}

export interface SampleSummary {
  count: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

/** Nothing measured yet reads as unavailable, never as zero. */
export const NO_SAMPLES: SampleSummary = { count: 0, p50: null, p95: null, p99: null };

/**
 * A fixed-capacity ring of recent samples.
 *
 * Percentiles come from a documented window rather than an all-time average:
 * an average over a whole session hides the spike that matters, and an all-time
 * percentile stops responding once the sample is large enough.
 */
export class RollingSamples {
  private readonly values: number[] = [];
  private next = 0;
  /** Samples seen, including ones the window has since dropped. */
  private seen = 0;

  readonly capacity: number;

  // Written out rather than a parameter property: tsconfig sets
  // erasableSyntaxOnly, so only syntax that survives type-stripping is allowed.
  constructor(capacity = 512) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('RollingSamples capacity must be a positive integer');
    }
    this.capacity = capacity;
  }

  add(value: number): void {
    if (!Number.isFinite(value)) return;
    this.seen++;
    if (this.values.length < this.capacity) this.values.push(value);
    else {
      this.values[this.next] = value;
      this.next = (this.next + 1) % this.capacity;
    }
  }

  get length(): number { return this.values.length; }
  get total(): number { return this.seen; }

  /** Nearest-rank on the current window. Null while the window is empty. */
  percentile(p: number): number | null {
    if (!this.values.length) return null;
    const sorted = [...this.values].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
  }

  summary(): SampleSummary {
    if (!this.values.length) return NO_SAMPLES;
    return {
      count: this.values.length,
      p50: this.percentile(50), p95: this.percentile(95), p99: this.percentile(99),
    };
  }

  reset(): void {
    this.values.length = 0;
    this.next = 0;
    this.seen = 0;
  }
}

export interface TelemetrySnapshot {
  /** Receive-interval minus send-interval, in ms. Signed: negative is catch-up. */
  transportJitterMs: SampleSummary;
  /** Receive to store commit, in ms. */
  processingMs: SampleSummary;
  /** Interval between drain frames, in ms. */
  frameDelayMs: SampleSummary;
  /** Ping to pong, in ms. A round trip, not a one-way time. */
  roundTripMs: SampleSummary;
  /** How far rendered state trails the replay clock, in ms of event time. */
  replayLagMs: SampleSummary;
  /** Frames the server sent that never arrived, counted from sequence gaps. */
  lostFrames: number;
  /** Frames observed carrying a server stamp. */
  stampedFrames: number;
  /** Frames observed without one, so a reader can tell telemetry is off. */
  unstampedFrames: number;
}

/**
 * Collects samples from the feed. Pure apart from the numbers handed to it —
 * it reads no clock itself, so a test drives it with exact values.
 */
export class FeedTelemetry {
  readonly transportJitterMs: RollingSamples;
  readonly processingMs: RollingSamples;
  readonly frameDelayMs: RollingSamples;
  readonly roundTripMs: RollingSamples;
  readonly replayLagMs: RollingSamples;
  private lost = 0;
  private stamped = 0;
  private unstamped = 0;
  private previous: { seq: number; emittedNs: bigint; receivedAt: number } | null = null;

  constructor(capacity = 512) {
    this.transportJitterMs = new RollingSamples(capacity);
    this.processingMs = new RollingSamples(capacity);
    this.frameDelayMs = new RollingSamples(capacity);
    this.roundTripMs = new RollingSamples(capacity);
    this.replayLagMs = new RollingSamples(capacity);
  }

  /** One frame off the socket. `receivedAt` is a browser-clock millisecond. */
  observe(stamp: FrameStamp | undefined, receivedAt: number): void {
    if (!stamp) { this.unstamped++; return; }
    this.stamped++;
    const emittedNs = BigInt(stamp.emittedNs);
    const previous = this.previous;
    this.previous = { seq: stamp.seq, emittedNs, receivedAt };
    if (!previous || stamp.seq <= previous.seq) return;  // Reconnects restart the count.
    this.lost += stamp.seq - previous.seq - 1;
    // Both sides are intervals within one clock domain, so the unknown offset
    // between the two clocks cancels and what is left is real.
    const sentGapMs = Number(emittedNs - previous.emittedNs) / 1e6;
    this.transportJitterMs.add(receivedAt - previous.receivedAt - sentGapMs);
  }

  /** Receive to the moment the frame is in the store. */
  commit(receivedAt: number, committedAt: number): void {
    this.processingMs.add(committedAt - receivedAt);
  }

  frame(delayMs: number): void { this.frameDelayMs.add(delayMs); }
  roundTrip(ms: number): void { this.roundTripMs.add(ms); }

  /**
   * Replay lag, from two readings of the same replay clock: where the session
   * says it is, and the event time of the last frame the client applied.
   */
  replayLag(clockNs: string, appliedNs: string): void {
    this.replayLagMs.add(Number(BigInt(clockNs) - BigInt(appliedNs)) / 1e6);
  }

  snapshot(): TelemetrySnapshot {
    return {
      transportJitterMs: this.transportJitterMs.summary(),
      processingMs: this.processingMs.summary(),
      frameDelayMs: this.frameDelayMs.summary(),
      roundTripMs: this.roundTripMs.summary(),
      replayLagMs: this.replayLagMs.summary(),
      lostFrames: this.lost,
      stampedFrames: this.stamped,
      unstampedFrames: this.unstamped,
    };
  }

  reset(): void {
    for (const samples of [this.transportJitterMs, this.processingMs, this.frameDelayMs,
                           this.roundTripMs, this.replayLagMs]) samples.reset();
    this.lost = this.stamped = this.unstamped = 0;
    this.previous = null;
  }
}
