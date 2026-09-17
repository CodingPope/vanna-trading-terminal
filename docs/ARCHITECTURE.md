# Architecture and invariants

## Market-data path

The API owns one shared synthetic market clock. `GET /api/snapshot` reads its current state
without advancing time or consuming random values, so multiple clients cannot perturb the
market by requesting snapshots. The response contains quotes, books, candle history, tape
history, and the latest sequence for each requested symbol.

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

## Paper execution

The command path is REST and the state path is WebSocket. Each browser tab owns a random
session identifier stored in `sessionStorage`; the server uses it only to isolate ephemeral
demo accounts. Every response returns the entire account with an increasing revision.

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

## Backpressure and failure behavior

The browser queue preserves recovery and account messages ahead of display quotes. Under a
burst it may shed low-priority display data, records the drop count, and continues to keep
transaction state authoritative. The server also bounds each connection's outgoing queue;
overflow closes the socket with a retryable code so a reconnect can rebuild state.

Heartbeat timeouts and missing market events mark the feed stale. New orders remain disabled
until both transport health and account synchronization are restored. Existing server orders
continue to exist; reconnecting fetches their current state.

## Ownership boundaries

| Concern | Owner |
|---|---|
| Market clock, books, candles, tape | FastAPI replay engine |
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
