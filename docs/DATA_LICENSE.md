# Historical data license review

No historical data is approved for redistribution. The public repository and the hosted
demo use authored synthetic examples and provider mocks; access to an API is not
publication approval.

- [x] Provider account selected; API key stored locally or in a secret manager.
- [x] Applicable license URL and terms reviewed by the owner.
- [x] Public repository redistribution conclusion recorded.
- [x] Hosted demo redistribution conclusion recorded.
- [x] Allowed artifact form recorded (raw, normalized, derived, or private only).
- [x] Reviewer name and decision date recorded.
- [x] Market-open session date and UTC start/end selected.
- [x] Quiet-midday session date and UTC start/end selected.
- [x] Volatile-close/event session date and UTC start/end selected.
- [x] Symbols confirmed (roadmap target: AAPL, NVDA, QQQ).
- [x] Maximum download cost approved.

If publication is disallowed, keep the authorized input and normalized artifacts
outside Git and use synthetic fixtures publicly. The import CLI can reproduce a
private normalized fixture from a locally held raw-unit source. This file records
only the eventual decision and non-secret parameters, never credentials.

## Selected sessions

Provider: Databento. Dataset: XNAS.ITCH. Schema: mbp-10. Symbols: AAPL, NVDA, QQQ.
Nanosecond bounds are UTC epoch, start inclusive / end exclusive, matching
`fetch_session.py`'s `--start`/`--end`.

| Session | Date (ET) | Window (ET) | Window (UTC) | `--start` / `--end` (ns) |
| --- | --- | --- | --- | --- |
| Market open | 2026-09-09 | 09:30–10:00 | 13:30–14:00 | 1788960600000000000 / 1788962400000000000 |
| Quiet midday | 2026-09-09 | 12:00–12:30 | 16:00–16:30 | 1788969600000000000 / 1788971400000000000 |
| Volatile (FOMC decision) | 2026-09-16 | 13:55–14:35 | 17:55–18:35 | 1789581300000000000 / 1789583700000000000 |

2026-09-09 is an ordinary trading day with no scheduled event nearby, used for both the
open and midday windows. 2026-09-16 was the second day of the September 2026 FOMC
meeting — a scheduled, public, already-elapsed event — with the rate decision and dot
plot at 14:00 ET and the press conference at 14:30 ET.

## Cost ceiling

Maximum download cost approved: **$10.00 USD total**, across all three sessions combined.
Run `estimate` for each session first; if the sum approaches this ceiling, stop and get
explicit approval before raising it rather than re-running `fetch` with a higher
`--max-cost-usd`.

## License and redistribution decision

Owner-recorded, **not a formal legal review**. Provider: Databento
([databento.com/legal](https://databento.com/legal); the full terms text did not render
for automated review, and no XNAS-specific redistribution-fee answer was obtained from
Databento support). Databento's own educational material distinguishes access from
redistribution and says a redistribution fee can apply to historical data depending on
the exchange (see the provider setup discussion above this file's history); that was not
resolved to a specific answer for XNAS.ITCH.

- **Use classification:** personal / non-commercial portfolio project, not a commercial
  product or resale of licensed data.
- **Public repository redistribution:** not formally reviewed. Treated as **not
  confirmed** — normalized recorded fixtures are kept out of the public repository until
  an explicit answer is obtained.
- **Hosted demo redistribution:** not formally reviewed. Treated as **not confirmed** —
  a public deployment continues to serve synthetic data only; recorded fixtures are not
  wired into anything publicly reachable.
- **Allowed artifact form:** private only. Raw provider output and normalized fixtures
  from this decision live under `server/fixtures/private/` (gitignored) for local
  development and screenshots/recording only.
- **Reviewer:** project owner (self-assessed, informal). **Date:** 2026-09-17.

Consistent with the fallback this file already describes: recorded fixtures built under
this decision stay private, the public repository keeps the synthetic fixture, and
[server/fixtures/README.md](../server/fixtures/README.md) has the commands to reproduce a
recorded session with your own Databento key.
