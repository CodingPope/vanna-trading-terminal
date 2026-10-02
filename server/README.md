# VANNA market data server

FastAPI service serving the two halves of snapshot-then-delta:

| | |
|---|---|
| `GET /api/snapshot?symbols=AAPL,MSFT` | Full state, plus the sequence each symbol is at |
| `GET /api/health` | Status, and whether it is replaying or synthesising |
| `GET /api/fixtures` | Validated normalized source metadata; empty when none is configured |
| `WS /ws` | Delta stream continuing from those sequences |

The sequence handoff is the contract. A client applying deltas without knowing
where the snapshot left off cannot distinguish a gap from a fresh start, and a
book that has silently missed an update is worse than no book — it looks right
and prices wrong.

Known bugs and remaining work are in [the roadmap](../ROADMAP.md).

## Running it

```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn app.main:app --reload --port 8000
```

Or the whole system, front end included:

```bash
docker compose up --build     # http://localhost:3000
```

nginx proxies `/api` and `/ws` to this service, so the browser talks to
same-origin paths and needs no CORS or per-environment base URL.

## Data modes

Out of the box the server **synthesises** prices, trades, candles, and depth
from reproducible seed values. This is the only complete data mode currently
shipped with the repository.

`scripts/fetch_session.py` now provides a provider-neutral event import pipeline
with estimate, fetch, normalize, validate, and summarize commands. It validates
canonical NDJSON, writes checksummed manifests atomically, and refuses overwrites
without an explicit flag. See [fixture instructions](fixtures/README.md).

The running engine still accepts an optional legacy `fixtures/session.json` bar
fixture. That mode reconstructs intrabar prices and generates depth; it is not
historical event replay. The new importer does not generate legacy bar fixtures.
Historical acquisition still needs the data-access and license decision in the
root [roadmap](../ROADMAP.md). No historical vendor fixture is bundled.

The API and UI must retain explicit provenance labels:

- **SYNTHETIC:** prices, trades, candles, and depth are generated.
- **REPLAY:** bar anchors are recorded; intrabar movement, trades, and depth are
  reconstructed or generated.
- **RECORDED:** historical trade and depth events are replayed in event order.

### Why replay rather than a live feed

- It works at 3am on a Sunday. A demo whose quality depends on when it is
  opened, and on the market having moved that day, is not a demo you control.
- It is deterministic, so a walkthrough is reproducible.
- **It keeps chaos injection possible.** You cannot force a disconnect, skip a
  sequence, or burst the message rate on someone else's feed.
- No API key, no rate limit, no third-party outage in the demo path.

Market replay is also what real trading systems use for testing, so this is the
normal way to do it rather than a workaround.

## Replay clock and sessions

The market engine owns no timer — `advance()` is called by whoever holds the
clock. Each browser session owns one: `SessionRegistry` gives every `session`
key its own cursor, clock, speed, play state, market state, and paper account
over one shared immutable source. A control in one session cannot touch another.

Capacity and lifetime are configurable:

| Variable | Default | Meaning |
|---|---|---|
| `VANNA_MAX_SESSIONS` | `32` | Concurrent sessions before new ones are refused with 503 |
| `VANNA_SESSION_IDLE_SECONDS` | `1800` | Idle lifetime before a disconnected session is released |

Play, pause, speed, step, seek, and reset are typed WebSocket commands with
acknowledgements and an authoritative status. The contract — including why
nanosecond timestamps cross the wire as strings, what one "replay unit" is, and
what `max` speed precisely means — is [docs/PROTOCOL.md](../docs/PROTOCOL.md).

Seek requires an indexed event store; a synthetic session reports
`canSeek: false` rather than pretending it can rewind a generated path. Paper
matching still runs on the session clock at the synthetic touch; moving
execution onto recorded event time is the next milestone in the [roadmap](../ROADMAP.md).

## Contract testing

`src/schemas/__tests__/contract.test.ts` on the front end validates captured
output from this server against the client's Zod schemas. Two model layers in
two languages drift silently otherwise — nothing in either build fails when a
Pydantic model gains a field Zod does not know about. Regenerate the capture
whenever the wire format changes:

```bash
./.venv/bin/python scripts/capture_samples.py
```
