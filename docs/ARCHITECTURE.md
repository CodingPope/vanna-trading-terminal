# Architecture and invariants

## Market-data path

Each session owns its own market clock over one shared, immutable source; no cursor is
global. `GET /api/snapshot` reads the session's current state without advancing time or
consuming random values, so multiple clients cannot perturb the market by requesting
snapshots, and a request without a session header gets a throwaway preview rather than
someone else's cursor. The response contains quotes, books, candle history, tape history,
the latest sequence for each requested symbol, and the session's playback status.

After hydration, the browser connects to `/ws` and seeds its order-book sequence handlers
from the REST response. Quotes, book deltas, candles, trades, and paper-account snapshots
are validated at the boundary. A malformed message increments diagnostics and is discarded.

The book invariant is:

```text
next delta sequence = last accepted sequence + 1
best bid < best ask
```

When a sequence is missing, the browser does not apply later deltas. It marks the symbol as
recovering and requests an authoritative book snapshot. Reconnect resets transport state and
reconciles the complete paper account.

## Replay control

Playback is server-authoritative. Play, pause, speed, step, seek, and reset arrive as typed
WebSocket commands carrying a `commandId`, and each is answered exactly once with an
acknowledgement containing current status. Retrying an ID returns the original decision
instead of applying it twice, which is what makes a control safe to resend across a
reconnect. Rejections are ordinary answers on a healthy socket, with stable codes.

Seek and reset rebuild market and paper state as one transaction and then publish exactly
one authoritative snapshot per client — market and paper account together — so no client
reconciles a rebuild against deltas from before it. The replacement is folded in full
before it is swapped in, so a failed rebuild leaves the session untouched. Both discard
user orders and positions: a fill that happened after the target instant cannot honestly
survive a rewind past its own trade.

Seek replays from sparse checkpoints rather than from the start, so its cost is a fixed
stride rather than the length of the fixture, and the checkpoint index is shared by every
session reading the same immutable store.

Nanosecond replay time crosses the wire as a decimal string. A nanosecond epoch needs 61
bits and a JSON number carries 53, so sending it as a number would round the clock to the
nearest ~256ns while appearing exact. [PROTOCOL.md](PROTOCOL.md) is the full contract.

## Paper execution

The command path is REST and the state path is WebSocket. Each browser tab owns a random
session identifier stored in `sessionStorage`; the server uses it to isolate an ephemeral
demo account *and* that tab's playback cursor. Every response returns the entire account
with an increasing revision.

Order submission is idempotent by `clientOrderId`. Repeating the same body returns the
original result. Reusing the identifier with different fields is rejected. Amendments carry
the last observed order version and fail if the order changed in the meantime.

The matching model is intentionally small enough to explain:

- integral share quantities and $0.01 price ticks;
- GTC and IOC limit or market paper orders;
- at most 25 shares filled per eligible order every 750 ms;
- fills at the current synthetic touch;
- a 1% collar on market orders;
- average-cost positions and $0.005/share fees;
- $50,000 maximum order notional and $250,000 gross exposure including reservations.

This model demonstrates lifecycle and consistency behavior. It does not claim queue
position, venue routing, price improvement, or exchange-grade fill simulation.

## Measurement

Every frame carries a per-connection sequence and the server's monotonic send time, so the
client can count frames it never received and compare send intervals with receive intervals.
That interval comparison is deliberate: the two clocks share no epoch, so their difference is
an unknown constant plus the quantity wanted. VANNA therefore reports transport jitter,
processing latency, frame delay, round trip, and replay lag — and does not report one-way
latency at all, because it cannot measure one. Percentiles come from a stated rolling window,
and a metric with no samples reads as unavailable rather than zero.
[PERFORMANCE.md](PERFORMANCE.md) has the definitions and the reporting rules.

## Backpressure and failure behavior

The browser queue preserves recovery and account messages ahead of display quotes. Under a
burst it may shed low-priority display data, records the drop count, and continues to keep
transaction state authoritative. It also folds frames that make each other redundant — a
newer book snapshot replaces an older one for the same symbol, and print batches for one
symbol concatenate — which measurably keeps book deltas out of the shed path under flood. A
book delta is cumulative and is never folded; that is the line between compressing the
stream and corrupting it. The server also bounds each connection's outgoing queue;
overflow closes the socket with a retryable code so a reconnect can rebuild state.

Heartbeat timeouts and missing market events mark the feed stale. New orders remain disabled
until both transport health and account synchronization are restored. Existing server orders
continue to exist; reconnecting fetches their current state.

## Bundle shape

Four dependencies dominate the build: three.js for the market orb, AG Grid for the order
book, Recharts for the depth chart, and Lightweight Charts for the price chart. Each sits
behind the dynamic import for the panel or page that uses it, so a first visit downloads
~108 kB of gzipped JavaScript — React, Redux, Zod, the transport, and the panels that carry
no visualization library — and nothing else. The order book grid registers the three AG Grid
modules it uses rather than the whole community set, which halved that chunk.

Rollup's own splitting is left alone. Hand-partitioning it with `manualChunks` was tried and
reverted: naming a chunk for React reordered module initialisation across chunk boundaries
and React 19 died at startup, and naming one for a library without its private dependency
web left the leftovers in a shared chunk that then imported the library's chunk, so the entry
preloaded three.js to reach a date formatter. The build writes `dist/bundle-analysis.json`
with every chunk, its gzipped size and the modules inside it; `yarn budget` enforces
`bundle-budget.json` against it and names the offending asset on failure.

## Ownership boundaries

| Concern | Owner |
|---|---|
| Immutable source events and fixture identity | FastAPI event store |
| Per-session clock, cursor, books, candles, tape | FastAPI replay session |
| Playback control, acknowledgements, authoritative status | FastAPI session registry |
| Orders, executions, cash, positions, fees, risk | FastAPI paper account |
| Envelope and response validation | Zod/Pydantic boundaries |
| Gap detection and display backpressure | Browser transport layer |
| Render state and derived view data | Redux selectors |
| Layout and personal UI preferences | Zustand/local storage |

## Deliberate limits

The server is single-process and state is in memory. A multi-worker deployment would split
the market clock and paper accounts unless state and event distribution moved to shared
infrastructure. There is no durable audit log, user authentication, authorization, market
data entitlement layer, or production observability. Those are explicit next steps rather
than hidden claims.
