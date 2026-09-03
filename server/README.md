# VANNA market data server

FastAPI service serving the two halves of snapshot-then-delta:

| | |
|---|---|
| `GET /api/snapshot?symbols=AAPL,MSFT` | Full state, plus the sequence each symbol is at |
| `GET /api/health` | Status, and whether it is replaying or synthesising |
| `WS /ws` | Delta stream continuing from those sequences |

The sequence handoff is the contract. A client applying deltas without knowing
where the snapshot left off cannot distinguish a gap from a fresh start, and a
book that has silently missed an update is worse than no book — it looks right
and prices wrong.

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

## Real data

Out of the box the server **synthesises** prices from seed anchors, so it runs
with no setup. To replay a real recorded session instead:

```bash
./.venv/bin/python scripts/fetch_session.py --interval d --bars 390
```

That writes `fixtures/session.json`, which is picked up automatically —
`/api/health` reports `"mode": "replay"` once it is present.

### What is real and what is not

Worth being precise about, because it is the first thing anyone asks:

- **Real:** bar anchors — open, high, low, close, volume per bar, from a
  recorded session.
- **Reconstructed:** the tick path *within* each bar. Minute bars do not record
  the intra-minute route, so it is interpolated to touch the real high and low.
- **Synthesised:** order book depth, built around the real mid. Historical L2
  is not freely available at any sane cost, and the sequence numbering has to
  be ours regardless — injecting gaps is the entire point of owning the feed.

### Why replay rather than a live feed

- It works at 3am on a Sunday. A demo whose quality depends on when it is
  opened, and on the market having moved that day, is not a demo you control.
- It is deterministic, so a walkthrough is reproducible.
- **It keeps chaos injection possible.** You cannot force a disconnect, skip a
  sequence, or burst the message rate on someone else's feed.
- No API key, no rate limit, no third-party outage in the demo path.

Market replay is also what real trading systems use for testing, so this is the
normal way to do it rather than a workaround.

## Playback speed

`ReplayEngine` deliberately owns no timer — `advance()` is called by whoever
holds the clock. Playback rate is therefore a caller decision: 1x for authentic
pacing, 100x to compress a session into a demo, unbounded to push the client
into shedding load. That is also what makes the engine testable without waiting
on wall time.

## Contract testing

`src/schemas/__tests__/contract.test.ts` on the front end validates captured
output from this server against the client's Zod schemas. Two model layers in
two languages drift silently otherwise — nothing in either build fails when a
Pydantic model gains a field Zod does not know about. Regenerate
`server-samples.json` whenever the wire format changes.
