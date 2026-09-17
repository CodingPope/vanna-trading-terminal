# Front-office UI portfolio guide

## What this project now proves

Use the terminal to discuss engineering problems that front-office teams care about:

- High-consequence UX: order validation, clear paper-mode labeling, lifecycle states,
  cancellation, amendments, stale-state protection, and unknown-acknowledgement recovery.
- Streaming correctness: snapshot-before-delta hydration, monotonic sequences, gap recovery,
  heartbeat health, reconnect backoff, boundary validation, and bounded backpressure.
- Finance-domain state: bid/ask books, time and sales, VWAP, average-cost positions, gross
  and net exposure, fees, realized and unrealized P&L.
- Test strategy: domain tests for matching and accounting, transport tests with malformed and
  missing messages, and Playwright journeys against the built application and real API.
- Honest system boundaries: synthetic data and paper execution are visible in the product and
  documented in the repository.

## Interview demo script

Open the dashboard directly and explain that the initial REST image establishes a coherent
baseline before WebSocket deltas begin. Submit a 150-share market order, point out the
server-owned status and 25-share partial fills, cancel the remainder, then show the execution
fees and position P&L.

Next, inject a sequence gap. Explain why silently applying the next order-book delta would be
more dangerous than temporarily showing recovery. Show the gap counter and the refreshed
book. Stall the feed and show that the ticket disables itself until the transport and account
are synchronized again. Finish by disconnecting and showing that the order and position
reappear from the server after reconnect.

Keep the demo under five minutes. Spend the discussion on invariants and failure modes rather
than visual styling.

## Resume bullets

Adapt these to your own voice and include measured numbers from the final deployed build:

- Built a React/TypeScript paper-execution workstation backed by FastAPI, combining
  sequenced WebSocket market data, REST commands, an order blotter, executions, and real-time
  position risk.
- Designed snapshot-and-delta recovery with schema validation, heartbeat detection, bounded
  priority backpressure, and deterministic chaos scenarios for gaps, stalls, disconnects,
  malformed payloads, and quote bursts.
- Implemented idempotent order submission, optimistic-concurrency amendments, partial fills,
  fees, average-cost accounting, and exposure limits with isolated browser sessions.
- Added 178 frontend tests, 20 server tests, and 21 real-stack browser tests covering market
  integrity, lifecycle transitions, reconnect reconciliation, and responsive keyboard UX.

Verify the counts before publishing; update them when the suite changes.

## Your launch checklist

1. Deploy the application and add the live URL to the README and GitHub repository details.
2. Record a concise demo using the script above. Add captions and show the failure controls,
   since they distinguish the project from a static dashboard.
3. Replace the repository social preview and pin the project on GitHub. Use the dashboard
   screenshot rather than the landing animation.
4. Rewrite the resume bullets in your own words and be ready to explain every claim.
5. Practice the trade-offs: why full account snapshots are acceptable at demo scale, what
   changes for multiple server workers, how to persist an event log, and where real market
   data entitlements and broker controls would enter the design.
6. Ask two frontend and two trading-domain engineers to use the deployed demo without help;
   fix the places where they cannot tell whether an order, feed, or recovery action succeeded.

## Strong next implementation choices

For a front-office UI role, durable event history and historical replay add more signal than
another visualization. A Postgres-backed order/execution log demonstrates auditability. A
licensed historical session with deterministic pause, seek, and replay demonstrates research
and incident-reproduction workflows. Performance marks around tick receipt, state commit, and
paint demonstrate attention to latency without making unsupported low-latency claims.
