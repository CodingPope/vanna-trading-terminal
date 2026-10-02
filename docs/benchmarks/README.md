# Benchmarks

`baseline.json` is the reference run every threshold in `benchmark/thresholds.json`
was set from. `latest.md` is the report from the most recent local run, rendered
from the artifact rather than written by hand, so it cannot drift from the
numbers it describes.

Reproduce it:

~~~bash
yarn benchmark
~~~

That builds the app, serves the production bundle behind `vite preview`, starts
the real FastAPI service, and runs the fixed scenario twice. It writes
`benchmark/results/latest.json` and renders `docs/benchmarks/latest.md`.

Method, metric definitions, and what is deliberately not claimed:
[../PERFORMANCE.md](../PERFORMANCE.md).

For a deliberate experiment — comparing speeds, say — the scenario takes
`BENCH_SPEED`, `BENCH_WINDOW_MS`, `BENCH_WARMUP_MS`, `BENCH_RUNS`, and
`BENCH_OUT`. Every artifact records the values it ran with, so an experimental
run cannot be mistaken for the reference one. Experimental runs are expected to
fail the reference thresholds; that is the thresholds working.

## Baseline

| | |
|---|---|
| Taken | 2026-09-18 |
| Commit | `743c3b3` (working tree dirty) |
| Machine | Apple M1, 8 cores, 16 GB |
| Platform | Darwin 25.5.0 arm64 |
| Browser | chromium 151.0.7922.34 |
| Build | production build behind vite preview |
| Fixture | `synthetic-seed-7-1789700880108` (synthetic) |
| Scenario | 2 runs, 5s warmup discarded, 30s window, speed 5, 1366x900 |

Headline figures from that run, all from a 512-sample rolling window:

- **400 feed envelopes per second** sustained, with **0 lost frames**,
  **0 book gaps**, and **0 shed display quotes**.
- Transport jitter p99 **0.4ms**.
- Receive to store commit p95 **14.8ms**, which includes the
  deliberate wait for the next animation frame.
- Round trip p50 **3.1ms** over loopback. A round trip, not a
  one-way time.

There is no claim here about a network, a hosted deployment, or a recorded
fixture. This is loopback, on one machine, against the synthetic source.

## Frame delay is the source, not the client

Frame delay reads ~215ms at 5x, which looks like a rendering problem and is
not one. The synthetic engine advances event time in one-second ticks, so it
emits a burst once per second of *event* time. Dividing that by the speed
predicts the interval between queue drains, and it does, closely:

| Speed | Predicted (1000ms ÷ speed) | Measured p50 |
|---|---|---|
| 1x | 1000ms | 1017ms |
| 2x | 500ms | 517ms |
| 5x | 200ms | 214ms |

The client is idle between bursts. Under a continuous flood at `max` speed it
drains every ~21ms, which is the number that describes the client. Event rate
scales linearly with speed over the same range (82 → 162 → 400/s) with no
shedding and no gaps, so nothing at these rates is client-bound.

Replay lag reads 0 or 1000ms for the same reason: one-second source ticks
against a once-a-second status refresh. That is the quantisation floor of this
source, not a measurement of the client.

## Folding superseded frames

The ceiling is visible at `max` speed, ~1,300 envelopes/second. There the queue
fills with high-priority frames, and once there is nothing low-priority left to
evict, book deltas start being dropped — each drop costing a snapshot recovery
round trip.

The fix folds frames that make each other redundant: a newer book *snapshot*
replaces an older one for the same symbol, and two print batches for one symbol
concatenate. A book *delta* is cumulative and is never folded.

Measured over a 4-second window at `max` speed, before and after
(`flood-before-coalescing.json`, `flood-after-coalescing.json`):

| | Before | After |
|---|---|---|
| Book gaps (recovery round trips) | 20 | **0** |
| Shed display quotes | 595 | 499 |
| Events/s | 1328 | 1307 |
| Receive → commit p95 | 18.6ms | 21.4ms |

Three repeat runs after the change held at 0 gaps and 499–500 shed quotes, so
the gap result is well outside run-to-run noise. Receive-to-commit rose by about
3ms, the cost of scanning the queue and of larger merged batches. That is a fair
trade for removing twenty recovery round trips, and it is recorded here rather
than left out.

Nothing else was changed. Chart batching, list virtualisation, worker offload,
and payload trimming were all considered and **deferred**: at the reference rate
the client sheds nothing and drops nothing, so none of them has a measured
problem to solve yet.
