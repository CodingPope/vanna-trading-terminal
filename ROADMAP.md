# VANNA roadmap

The core portfolio story is implemented: a server-driven market feed, paper order lifecycle,
failure recovery, risk state, boundary validation, and browser tests against the real stack.
The remaining work is about public presentation and production depth.

## Launch blockers

- [ ] Deploy the two-service Docker Compose application to a public URL.
- [ ] Record a 60–90 second demo showing a partial fill, cancel, sequence-gap recovery,
      stale-feed order gating, and reconnect reconciliation.
- [ ] Replace `docs/screenshot.png` whenever the default layout changes.
- [ ] Add the live URL and demo recording to the README and repository description.

## Highest-value engineering extensions

- [ ] Replace in-memory paper accounts with Postgres and an append-only order/execution
      event log; restore account state by replaying events.
- [ ] Add authentication and server-issued sessions before exposing persistent accounts.
- [ ] Add a deterministic historical-session fixture with playback speed, pause, seek, and
      a documented data license.
- [ ] Add order acknowledgements as explicit domain events and model disconnects between
      command receipt and response in browser tests.
- [ ] Add exchange sessions, tick-size tables, short-sale/locate rules, and symbol-specific
      trading halts if the project is positioned as an execution simulator.
- [ ] Measure interaction latency and long-task rate in production; set a bundle and Web
      Vitals budget in CI.
- [ ] Split the dashboard further by panel and remove unused UI packages to reduce the
      current large async dashboard chunk.
- [ ] Run accessibility checks in CI and complete screen-reader testing for the grid,
      dialogs, ticket, and blotter.

## Optional integrations

A real broker or market-data adapter should sit behind a narrow interface and remain
disabled by default. Keep paper mode visually explicit. Do not present delayed or synthetic
prices as live exchange data, and document entitlement and redistribution limits for any
vendor data used in a public demo.
