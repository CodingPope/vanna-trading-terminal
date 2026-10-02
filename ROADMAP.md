# Roadmap

VANNA is a paper-only trading workstation. The goal of this roadmap is a hosted demo that
replays a recorded market session deterministically, fills paper orders against it, and
backs every performance claim with a reproducible measurement.

## Done

- **Recorded-event contract.** Versioned event and provenance schema, checksummed fixtures,
  and synthetic examples ([docs/DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md)).
- **Import pipeline.** Provider-neutral importer with a Databento XNAS.ITCH `mbp-10` adapter.
- **Immutable event store.** Validated on load, shared read-only by every session.
- **Replay.** Per-session clocks with play, pause, speed, step, seek, and reset; a typed
  control protocol with retry-safe acknowledgements ([docs/PROTOCOL.md](docs/PROTOCOL.md));
  atomic seek from sparse checkpoints; determinism and isolation tests.
- **Replay UI.** Transport controls, provenance label, and server-authoritative status.
- **Measurement.** A written protocol ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)), client
  diagnostics, a repeatable benchmark, and one profile-led optimization (frame folding).
- **Build.** Route splitting and enforced bundle budgets.

## To do

### Known bugs

- [ ] **Risk check blocks closing orders.** `_risk` in
  [server/app/paper.py](server/app/paper.py) adds every order's notional to gross exposure
  regardless of side, so a sell that reduces a long position is rejected near the $250k cap.
  Exposure should be computed from the position the order would leave behind.
- [ ] **No buying-power check.** Cash can go negative: a $100k account can buy up to the
  $250k gross limit. Either enforce cash, or model margin explicitly and show it in the UI.
- [ ] **The broadcast loop has no error guard.** An exception inside `Hub._run` in
  [server/app/main.py](server/app/main.py) stops the feed for every client until a new
  connection restarts it. Guard each session's turn and each socket close.
- [ ] **Stale book deltas are treated as gaps.** `handleDelta` in
  [orderBookHandler.ts](src/services/handlers/orderBookHandler.ts) requests a recovery for
  any sequence other than the next one. A delta at or below the current sequence should be
  ignored; snapshot folding in the WebSocket client can otherwise cause a spurious recovery.
- [ ] **Session capacity refuses new visitors.** The registry holds 32 sessions and keeps a
  disconnected one for 30 minutes, so the 33rd visitor gets a 503. Evict the
  least-recently-seen disconnected session instead.

### Recorded data

- [ ] Build recorded AAPL / NVDA / QQQ fixtures for three short regimes: the open, a quiet
  midday, and a volatile close. The license review is in
  [docs/DATA_LICENSE.md](docs/DATA_LICENSE.md); recorded fixtures stay out of the public
  repository, which keeps the synthetic source.

### Execution

- [ ] Fill market orders against recorded depth at event time.
- [ ] Deterministic passive fills for resting limit orders.
- [ ] Execution audit trail with per-order detail and export.
- [ ] Notional confirmation for large orders, and hardening of command races.

### Experience

- [ ] A guided first-run walkthrough, and complete empty, loading, and error states.
- [ ] Accessibility pass: automated checks plus manual keyboard and screen-reader review.

### Deployment

- [ ] Host the UI and the API (the API needs a long-lived process with WebSockets).
- [ ] Rate limits, security headers, logging, and basic observability.
- [ ] Smoke, reconnect, and uptime checks against the deployed system.
- [ ] Case study and public release.

## Decisions

| Decision | Reason |
| --- | --- |
| Databento historical XNAS.ITCH `mbp-10` for recorded sessions. | Depth-oriented history suits both replay and execution. |
| AAPL, NVDA, and QQQ over three short sessions. | Familiar, liquid instruments; bounded fixture size. |
| Synthetic mode stays a first-class fallback. | The public demo must run without credentials or a vendor. |
| Snapshots are authoritative after reconnect and seek. | Bounds recovery complexity and prevents client/server divergence. |
| Nanosecond replay time crosses the wire as a decimal string. | A nanosecond epoch needs 61 bits; a JSON number carries 53 and would silently round. |
| One `snapshot` frame after a rebuild, including the paper account. | Market and account are replaced together, so a client is never half-restored. |
| Seek discards orders, positions, and cash. | A paper fill cannot honestly survive a rewind past its own trade. |

## Out of scope

Live broker connectivity, redistribution of paid market data, real-money trading or custody,
a full exchange matching engine, mobile-first order entry, multi-user accounts with persistent
portfolios, and trading signals or recommendations.
