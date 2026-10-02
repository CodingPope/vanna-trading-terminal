# Market fixtures

`examples/valid/` is a five-event, hand-authored **SYNTHETIC** fixture exercising every
event type. `examples/invalid.ndjson` deliberately contains a negative trade size.
Neither represents a recorded session. See [the format specification](../../docs/DATA_PROVENANCE.md).

No historical vendor data is bundled. Do not put raw licensed downloads or credentials
in Git. A historical fixture requires the license decision recorded in
[docs/DATA_LICENSE.md](../../docs/DATA_LICENSE.md).
Without a configured fixture the runtime uses seeded synthesis; the example is not
auto-loaded.

## Import commands

From `server/`, run `.venv/bin/python scripts/fetch_session.py --help`.
The CLI provides `estimate`, `fetch`, `normalize`, `validate`, and `summarize`.
Imports require explicit provider, dataset, schema, comma-separated symbols, UTC
nanosecond `--start`/`--end`, output directory, and license note. Provider fetches
use an exclusive end; normalized manifest validation accepts inclusive bounds.

```bash
.venv/bin/python scripts/fetch_session.py validate --input fixtures/examples/valid
.venv/bin/python scripts/fetch_session.py summarize --input fixtures/examples/valid
```

`fetch` always prints an estimate before retrieval. The default cost ceiling is
zero; `--max-cost-usd` must explicitly cover a paid request. `normalize` reads local
provider-shaped JSON lines and performs no network request. Provider clients are
injected in tests.

Imports fail on the first invalid record; no records are silently repaired or
dropped. Successful summaries include counts by type/symbol, time bounds, sequence
gaps, invalid/dropped/crossed counts (zero for accepted fixtures), byte size, and
SHA-256. An invalid import publishes no summary or fixture; stderr identifies the
failure. Existing output requires `--overwrite`, and a failed replacement restores
the old directory. Readers may briefly find an absent path during replacement,
but cannot accept a partially written fixture. After a process crash, inspect a
sibling `.NAME.previous` directory and `.NAME.import-lock` before retrying; do not
remove either while an import is running. Runtime fixtures should be immutable
once deployed, rather than overwritten under active readers.

## Historical provider setup (requires a provider account and license)

Use a separate Python 3.12 environment for `requirements-import.txt`. The repository's
existing runtime environment can remain independent. Export `DATABENTO_API_KEY` in
your shell or secret manager; `.env.example` documents its name but is not loaded
automatically. Do not include the key in command arguments or tracked files.

```bash
python3.12 -m venv .venv-import
.venv-import/bin/pip install -r requirements-import.txt
.venv-import/bin/python scripts/fetch_session.py estimate \
  --provider databento --dataset XNAS.ITCH --schema mbp-10 \
  --symbols AAPL,NVDA,QQQ --start YOUR_START_NS --end YOUR_END_NS
```

Replace the timestamp placeholders with your approved session. To download, use
`fetch` with the same request arguments plus `--output PATH`, `--license-note TEXT`,
`--redistribution private`, and the approved `--max-cost-usd AMOUNT`. A cost estimate
is a preflight check, not a vendor-side hard billing cap. Keep private output outside
this repository until redistribution approval is documented. Local `normalize`
accepts the raw-unit, symbol-mapped JSON exported by the adapter, without a key or SDK.

## Event-store API

`EventStore.load(directory)` checks schema version, checksum, canonical event bytes,
stream ordering, and book transitions before exposing immutable source events.
`discover_fixtures(root)` returns deterministic immediate-child manifest locations.
Timestamp ranges are half-open `[start_ns, end_ns)`; `index_at(t, after=True)` finds
the position after all events tied at `t`. Sequence lookups are exact, including gaps.
Symbol/type indices narrow filtered reads without changing source order. Source
identity includes the manifest's friendly name and full event checksum.

`SourceConfig.from_environment().load()` is the configuration boundary for replay
sessions. `VANNA_DATA_MODE` defaults to `synthetic`;
`VANNA_FIXTURE` selects a normalized fixture directory whose mode must match.
`VANNA_ALLOW_MISSING_FIXTURE=true` explicitly permits missing sources to fall back
to synthesis. Damaged, incompatible, or mislabeled fixtures always fail closed.
The server loads this source once and exposes its metadata at `GET /api/fixtures`.
An empty catalog means no normalized source was selected. This endpoint describes
available source data.
The market snapshot and health endpoint retain their actual feed provenance.
No fixture reads depend on the vendor SDK.
