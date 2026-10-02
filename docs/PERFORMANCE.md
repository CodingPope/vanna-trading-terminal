# Measurement protocol

This defines what VANNA measures, in which clock domain, over what sample, and
what it refuses to claim. It exists so that a number on screen or in the README
can be checked by someone who did not write it.

Nothing here is a performance result. Results come from the benchmark artifact
(see [docs/benchmarks/](benchmarks/)) and carry their own environment.

## The constraint everything follows from

The server stamps each frame with `time.monotonic_ns()`. The browser reads
`performance.now()`. The two clocks share no epoch and are not synchronised, and
neither is a wall clock. Subtracting one from the other yields the quantity we
want plus an unknown constant offset — a number that looks like one-way latency
and is not one.

VANNA therefore never reports one-way transport latency. It reports quantities
that survive an unknown clock offset:

- differences between two readings of the **same** clock;
- differences between two **intervals**, one per clock, where the offset cancels.

A future version could measure one-way latency honestly with an NTP-style
offset estimate over the socket. Until that exists, the number does not exist.

## Timestamps

| Name | Clock | Where it is read |
| --- | --- | --- |
| **Replay event time** | Session replay clock (ns) | `ReplayStatus.eventTimeNs`, and each market frame's own timestamp |
| **Server emit time** | Server process monotonic (ns) | `t.emittedNs`, stamped at the `send`, not when the frame was queued |
| **Client receive time** | Browser `performance.now()` (ms) | The socket's `onmessage` handler |
| **Store commit time** | Browser `performance.now()` (ms) | When the frame has been applied to Redux |
| **Frame time** | Browser `performance.now()` (ms) | The start of each animation-frame drain |

Every frame also carries `t.seq`, a per-connection monotonic counter starting at
1. It counts frames on one socket, not events in a fixture and not a per-symbol
book sequence. A reconnect restarts it, and the client treats a lower sequence
as a new connection rather than as loss.

Replay time and emit time cross the wire as decimal strings. A nanosecond epoch
needs 61 bits and a JSON number carries 53, so sending it as a number rounds it
to roughly 256ns while looking exact. See [PROTOCOL.md](PROTOCOL.md).

## What is measured

| Metric | Definition | Domain |
| --- | --- | --- |
| **Transport jitter** | (browser gap between two consecutive frames) − (server gap between the same two frames) | Interval difference; the clock offset cancels |
| **Receive to commit** | Store commit time − client receive time, per frame | Browser clock only |
| **Frame delay** | Interval between consecutive animation-frame drains | Browser clock only |
| **Round trip** | Ping sent to pong received | Browser clock only |
| **Replay lag** | Session `eventTimeNs` − event time of the latest market frame applied | Replay clock only |
| **Lost frames** | Gaps in `t.seq` on one connection | Counter |

Transport jitter is signed. Positive means the browser saw two frames further
apart than the server sent them — queueing, a busy event loop, or a slow path.
Negative means it saw them closer together, which is the catch-up after that.
Its centre is not latency; its spread is what a stream's smoothness depends on.

Receive to commit includes the wait for the next animation frame. Display
frames are drained one animation frame at a time on purpose, so most of that
number is deliberate batching rather than work — read it against frame delay,
not on its own.

These are deliberately separate. Collapsing receive-to-commit and frame delay
into one "latency" number hides which of the two a regression came from, and
they have different fixes.

## Sampling

Every metric is a **rolling window of the most recent 512 samples**, with
percentiles by nearest rank on that window: sort the window, take the value at
`ceil(p/100 × n)`.

A rolling window rather than an all-time aggregate, because an all-time average
buries the spike that matters and an all-time percentile stops moving once the
sample is large. Nearest rank rather than interpolation, because every reported
value is then a value that was actually observed.

A metric with no samples reports **unavailable**, never `0`. Zero latency is a
claim; no measurement is not.

## Reporting rules

A published number states, at minimum:

- the fixture (id and events checksum) and the command script;
- speed and whether playback ran to the end;
- browser and version, operating system, machine;
- build mode — production build served over the preview server, never a dev
  server with HMR attached;
- warmup discarded and the measurement window;
- whether telemetry was enabled, and the same run with it disabled where the
  overhead matters.

**Warmup.** The first 5 seconds after hydration are discarded: first paint, font
and chart initialisation, and JIT warmup are not steady state and dominate any
percentile they are included in.

**Window.** A measurement window is a stated wall-clock duration at a stated
speed, at least 30 seconds, ending before the fixture does. A run that ends the
session measures the end of the session, not the steady state.

## Measurement overhead

Telemetry is switchable on both sides so its cost can be measured rather than
assumed:

- server: `VANNA_TELEMETRY=false` stops stamping frames;
- client: `new WebSocketClient({ telemetry: false })` stops collecting.

To quantify it, run the same fixture and script twice, once each way, and
compare event throughput and frame delay. Report the difference alongside any
claim that the overhead is negligible; do not assert it.

The client also reports `stampedFrames` and `unstampedFrames`, so a reader can
tell at a glance whether a run had server telemetry on.

## What is deliberately not claimed

- **One-way latency.** No synchronised clocks. See above.
- **Half of a round trip.** That assumes a symmetric path this client cannot
  verify.
- **End-to-end "tick to glass".** Paint time is not yet instrumented; frame
  delay is the interval between drains, which is a lower bound on it.
- **Throughput headroom.** The server drains at most 256 replay units per 100ms
  scheduler turn per session by design, so observed maximum event rate is a
  property of that budget, not of the machine.
