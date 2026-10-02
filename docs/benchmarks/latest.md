# Feed benchmark

**PASS** · 2026-09-18T03:52:40.546Z · commit `743c3b3` · **working tree dirty**

Method and metric definitions: [docs/PERFORMANCE.md](../PERFORMANCE.md).

## Environment

| | |
|---|---|
| Machine | Apple M1, 8 cores, 16 GB |
| Platform | Darwin 25.5.0 arm64 |
| Browser | chromium 151.0.7922.34 |
| Node | v24.18.0 |
| Build | production build behind vite preview |
| Fixture | synthetic-seed-7-1789703476680 (synthetic) |

## Scenario

2 runs · 5s warmup discarded · 30s window · speed 5 · 1366x900 · symbol rotation NVDA, TSLA, AAPL

Percentiles: nearest rank over the last 512 samples.

## Results

| Metric | Run 1 p50 | Run 1 p95 | Run 1 p99 | Run 1 n | Run 2 p50 | Run 2 p95 | Run 2 p99 | Run 2 n |
|---|---|---|---|---|---|---|---|---|
| Transport jitter | -0.0 | 0.1 | 1.0 | 512 | -0.0 | 0.1 | 1.5 | 512 |
| Receive → commit | 7.5 | 15.9 | 16.3 | 512 | 7.0 | 16.3 | 16.5 | 512 |
| Frame delay | 215.4 | 218.7 | 219.1 | 152 | 213.6 | 218.6 | 231.2 | 158 |
| Round trip | 2.8 | 19.3 | 19.3 | 10 | 2.3 | 30.7 | 30.7 | 10 |
| Replay lag | 0.0 | 1000.0 | 1000.0 | 28 | 1000.0 | 1000.0 | 1000.0 | 28 |

| Counter | Run 1 | Run 2 |
|---|---|---|
| Events/s | 320.8 | 399.8 |
| Lost frames | 0 | 0 |
| Book gaps | 0 | 0 |
| Reconnects | 0 | 0 |
| Shed quotes | 0 | 0 |
| Long tasks | 0 | 0 |
| Long-task ms | 0 | 0 |
| Heap (MB) | 20 | 20 |

## Thresholds

| Check | Value | Limit | |
|---|---|---|---|
| frameDelayMs.p99 | 219.10000014305115 | max 500 | pass |
| frameDelayMs.p99 | 231.20000004768372 | max 500 | pass |
| processingMs.p95 | 15.900000095367432 | max 50 | pass |
| processingMs.p95 | 16.299999952316284 | max 50 | pass |
| transportJitterMs.p99 | 1.0188750476837072 | max 100 | pass |
| transportJitterMs.p99 | 1.457333 | max 100 | pass |
| lostFrames | 0 | max 0 | pass |
| lostFrames | 0 | max 0 | pass |
| bookGaps | 0 | max 0 | pass |
| bookGaps | 0 | max 0 | pass |
| eventRate | 320.8 | min 100 | pass |
| eventRate | 399.8 | min 100 | pass |

## Run-to-run stability

A regression signal is only as good as the agreement between two runs of the same build.

| Metric | Runs | Ratio | Limit | |
|---|---|---|---|---|
| frameDelayMs.p50 | 215.40000009536743, 213.59999990463257 | 1.01 | 2 | pass |
| eventRate | 320.8, 399.8 | 1.25 | 2 | pass |

