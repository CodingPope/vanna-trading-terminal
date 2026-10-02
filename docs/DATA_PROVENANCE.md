# Fixture contract and provenance

The running terminal still uses the existing synthetic/bar engine. The version 1
fixture models in `server/app/replay_models.py` do not change its wire protocol.

- **SYNTHETIC:** authored or seeded market events; no claim of historical prices.
- **REPLAY:** recorded anchors with reconstructed intrabar events or simulated
  depth. This is the legacy bar mode, not recorded order-book history.
- **RECORDED:** historical trades, quotes, depth, and status in source event order.
  Candles may be derived; all paper executions remain simulated.

Each manifest declares provenance separately for trades, quotes, depth, status,
candles, and execution, with a list of transformations. Events repeat their origin,
which must agree with the manifest. Normalizing units does not reconstruct an event;
interpolating a price path does. Never infer redistribution permission from access
or from successful normalization. `unknown` and `private` licenses are not permission
to publish. The checked-in examples are authored synthetic data with no vendor input.

## Canonical version 1 format

A fixture directory contains `manifest.json` and `events.ndjson`. Both are UTF-8,
with sorted object keys, compact JSON separators, no NaN/Infinity, and a final LF.
NDJSON contains one discriminated event per line. The manifest's SHA-256 covers the
**exact event file bytes**, including newlines. An optional source checksum describes
the original input; it is not a substitute for the normalized checksum.

Timestamps are positive integer Unix **nanoseconds** in UTC; prices are positive
integer **billionths of the quote currency**; sizes are integer shares, never negative.
These integers must not pass through JavaScript `Number` without an explicit unit
conversion or lossless parser. The manifest's IANA timezone is display metadata.
Session bounds are inclusive. Equal timestamps are valid; the positive, strictly
increasing fixture-global sequence preserves source order. Sequence gaps are allowed
and reported by import summaries; duplicates and reversals are errors. A provider's
native sequence is not assumed globally unique and is not used as the normalized ID.

Event types are `trade`, `quote`, `depth_snapshot`, `depth_update`, and
`trading_status`. Unknown versions/types/fields fail validation. Trades have positive
size and an explicit aggressor (`unknown` when unavailable). Quotes permit a missing
side. Empty depth sides are valid around closed markets. Snapshots contain at most ten
positive-size levels per side: bids descending, asks ascending, without duplicate
prices. Locked and crossed books are rejected in this portfolio contract; providers
must surface unsupported states as import failures, never silently repair them.

Depth updates apply absolute sizes at `(side, price_nanos)` atomically; zero deletes
a level. Each symbol needs a prior snapshot. The resulting book must remain uncrossed
and within ten levels. A normalized top-ten feed must explicitly delete displaced
levels; it must not append a new touch while keeping stale levels outside the top ten.

Stream validation rejects out-of-bounds/reversed timestamps, duplicate/reversed IDs,
undeclared symbols, declared symbols with no events, inconsistent origins, and invalid
book transitions. Parsing reports file line numbers plus Pydantic field paths.
Models and nested tuples are immutable. `ReplayMetadata` describes a validated source;
it is separate from future session cursor and control state.

Manifests also record provider, dataset, source schema, symbols, venue, source format,
normalization version, import/capture times, license note, and redistribution status.
Provider-specific parsing belongs in import adapters, not the runtime event union.

## Databento adapter

The import-only adapter targets XNAS.ITCH `mbp-10`, with raw AAPL, NVDA, and QQQ
symbols. It uses metadata for estimates, then historical range retrieval. The SDK
exports temporary JSON with `pretty_px=False`, `pretty_ts=False`, and resolved
symbols, so prices and timestamps never round-trip through floating point.

For each provider record, the adapter emits a trade for action `T`, then the full
ten-level snapshot and its top quote. Those derived envelopes share the original
event timestamp and use new globally increasing IDs; native venue sequences need
not be unique across instruments. A trade's `B` side means buy aggressor, `A` means
sell aggressor, and `N` stays unknown. Undefined depth slots are omitted. No market
status is inferred from MBP-10; a separate status source is needed for halt-aware
matching. Reversed timestamps, unsupported records, missing symbols, crossed books,
and malformed levels fail the import. No sorting or price repair hides those cases.

These mappings follow the provider's [MBP-10 field specification](https://databento.com/docs/schemas-and-data-formats/mbp-10)
and [official Python export API](https://github.com/databento/databento-python/blob/main/databento/common/dbnstore.py).
The estimate uses the [official metadata API](https://github.com/databento/databento-python/blob/main/databento/historical/api/metadata.py).
The SDK is pinned only in `requirements-import.txt`; the running service does not
import it. Tests use authored provider-shaped records and mocks, never credentials.
