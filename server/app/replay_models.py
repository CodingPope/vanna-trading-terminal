"""Version 1 normalized fixture contract; deliberately independent of the live feed.

Prices and timestamps use integer nanounits. Source order is preserved by a
fixture-global sequence, including when multiple events share a timestamp.
"""
from __future__ import annotations

import hashlib
import json
from typing import Annotated, Iterable, Literal, Optional, Tuple, Union
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

PositiveInt = Annotated[int, Field(strict=True, gt=0)]
NonnegativeInt = Annotated[int, Field(strict=True, ge=0)]
Symbol = Annotated[str, Field(pattern=r"^[A-Z0-9][A-Z0-9.\-]{0,19}$")]
Mode = Literal["synthetic", "replay", "recorded"]
Origin = Literal["recorded", "derived", "reconstructed", "simulated"]


class FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", populate_by_name=True, serialize_by_alias=True)


class Level(FrozenModel):
    price_nanos: PositiveInt
    size: NonnegativeInt


def check_book(bids, asks):
    for name, levels, descending in (("bids", bids, True), ("asks", asks, False)):
        prices = [level.price_nanos for level in levels]
        if prices != sorted(set(prices), reverse=descending):
            raise ValueError(f"{name}: levels must be unique and ordered best first")
    if bids and asks and bids[0].price_nanos >= asks[0].price_nanos:
        raise ValueError("book: locked or crossed best bid/ask")


class EventBase(FrozenModel):
    schema_version: Literal[1] = 1
    sequence: PositiveInt
    timestamp_ns: PositiveInt
    symbol: Symbol
    origin: Origin


class TradeEvent(EventBase):
    type: Literal["trade"] = "trade"
    price_nanos: PositiveInt
    size: PositiveInt
    aggressor: Literal["buy", "sell", "unknown"] = "unknown"


class QuoteEvent(EventBase):
    type: Literal["quote"] = "quote"
    bid: Optional[Level] = None
    ask: Optional[Level] = None

    @model_validator(mode="after")
    def coherent(self):
        check_book((self.bid,) if self.bid else (), (self.ask,) if self.ask else ())
        return self


class DepthSnapshotEvent(EventBase):
    type: Literal["depth_snapshot"] = "depth_snapshot"
    bids: Annotated[Tuple[Level, ...], Field(max_length=10)] = ()
    asks: Annotated[Tuple[Level, ...], Field(max_length=10)] = ()

    @model_validator(mode="after")
    def coherent(self):
        check_book(self.bids, self.asks)
        if any(level.size == 0 for level in (*self.bids, *self.asks)):
            raise ValueError("snapshot: omit zero-size levels")
        return self


class DepthChange(Level):
    side: Literal["bid", "ask"]


class DepthUpdateEvent(EventBase):
    type: Literal["depth_update"] = "depth_update"
    changes: Annotated[Tuple[DepthChange, ...], Field(min_length=1, max_length=40)]

    @model_validator(mode="after")
    def unique_levels(self):
        keys = [(level.side, level.price_nanos) for level in self.changes]
        if len(set(keys)) != len(keys):
            raise ValueError("changes: duplicate side/price in one atomic update")
        return self


class TradingStatusEvent(EventBase):
    type: Literal["trading_status"] = "trading_status"
    status: Literal["preopen", "open", "halted", "closed", "unknown"]
    reason: str = ""


MarketEvent = Annotated[Union[TradeEvent, QuoteEvent, DepthSnapshotEvent,
                              DepthUpdateEvent, TradingStatusEvent], Field(discriminator="type")]
EVENT_ADAPTER = TypeAdapter(MarketEvent)


class Provenance(FrozenModel):
    trades: Origin
    quotes: Origin
    depth: Origin
    status: Origin
    candles: Origin = "derived"
    execution: Literal["simulated"] = "simulated"
    transformations: Tuple[str, ...] = ()


class Manifest(FrozenModel):
    schema_version: Literal[1] = 1
    fixture_id: Annotated[str, Field(min_length=1, max_length=128)]
    mode: Mode
    provider: Annotated[str, Field(min_length=1)]
    dataset: Annotated[str, Field(min_length=1)]
    source_schema: Annotated[str, Field(min_length=1, alias="schema")]
    symbols: Annotated[Tuple[Symbol, ...], Field(min_length=1)]
    venue: Annotated[str, Field(min_length=1)]
    timezone: str
    start_ns: PositiveInt
    end_ns: PositiveInt
    source_format: Annotated[str, Field(min_length=1)]
    normalization_version: Literal[1] = 1
    events_file: Literal["events.ndjson"] = "events.ndjson"
    events_sha256: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    source_sha256: Optional[Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]] = None
    license_note: Annotated[str, Field(min_length=1)]
    redistribution: Literal["approved", "private", "unknown"]
    imported_at_ns: PositiveInt
    captured_at_ns: Optional[PositiveInt] = None
    provenance: Provenance

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone: expected an IANA timezone") from exc
        return value

    @field_validator("symbols")
    @classmethod
    def unique_symbols(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("symbols: duplicates are not allowed")
        return value

    @model_validator(mode="after")
    def coherent(self):
        if self.end_ns < self.start_ns:
            raise ValueError("end_ns: must be at or after start_ns")
        origins = (self.provenance.trades, self.provenance.quotes,
                   self.provenance.depth, self.provenance.status)
        if self.mode == "synthetic" and "recorded" in origins:
            raise ValueError("provenance: synthetic mode cannot claim recorded events")
        if self.mode == "recorded" and any(x != "recorded" for x in origins):
            raise ValueError("provenance: recorded mode requires recorded market events")
        return self


class ReplayMetadata(FrozenModel):
    fixture_id: str
    mode: Mode
    start_ns: PositiveInt
    end_ns: PositiveInt
    event_count: NonnegativeInt
    events_sha256: str


class FixtureValidationError(ValueError):
    """Includes the event's one-based line and offending logical field."""


def validate_events(manifest: Manifest, events: Iterable[MarketEvent]) -> Tuple[MarketEvent, ...]:
    """Validate stream order and book transitions without reordering or repairing data."""
    result = []
    last_time = last_sequence = 0
    seen_symbols = set()
    books = {}
    for line, event in enumerate(events, 1):
        def fail(field, reason):
            raise FixtureValidationError(f"events.ndjson:{line}: {field}: {reason}")
        if event.symbol not in manifest.symbols:
            fail("symbol", f"{event.symbol} is absent from manifest.symbols")
        if not manifest.start_ns <= event.timestamp_ns <= manifest.end_ns:
            fail("timestamp_ns", "outside manifest session bounds")
        if event.timestamp_ns < last_time:
            fail("timestamp_ns", "timestamps must be nondecreasing")
        if event.sequence <= last_sequence:
            fail("sequence", "duplicate or reversed sequence ID")
        field = {"trade": "trades", "quote": "quotes", "depth_snapshot": "depth",
                 "depth_update": "depth", "trading_status": "status"}[event.type]
        if event.origin != getattr(manifest.provenance, field):
            fail("origin", f"does not match manifest.provenance.{field}")
        if isinstance(event, DepthSnapshotEvent):
            books[event.symbol] = ({x.price_nanos: x.size for x in event.bids},
                                   {x.price_nanos: x.size for x in event.asks})
        elif isinstance(event, DepthUpdateEvent):
            if event.symbol not in books:
                fail("changes", "depth update requires an earlier snapshot")
            bids, asks = books[event.symbol]
            for change in event.changes:
                side = bids if change.side == "bid" else asks
                if change.size:
                    side[change.price_nanos] = change.size
                else:
                    side.pop(change.price_nanos, None)
            if len(bids) > 10 or len(asks) > 10:
                fail("changes", "result exceeds ten levels per side")
            if bids and asks and max(bids) >= min(asks):
                fail("changes", "result is a locked or crossed book")
        last_time, last_sequence = event.timestamp_ns, event.sequence
        seen_symbols.add(event.symbol)
        result.append(event)
    missing = set(manifest.symbols) - seen_symbols
    if missing:
        raise FixtureValidationError(f"manifest.symbols: no events for {', '.join(sorted(missing))}")
    return tuple(result)


def canonical_json(model: BaseModel) -> bytes:
    return (json.dumps(model.model_dump(mode="json"), sort_keys=True,
                       separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def serialize_events(events: Iterable[MarketEvent]) -> bytes:
    return b"".join(canonical_json(event) for event in events)


def parse_events(data: bytes) -> Tuple[MarketEvent, ...]:
    events = []
    for line, raw in enumerate(data.splitlines(), 1):
        try:
            events.append(EVENT_ADAPTER.validate_json(raw))
        except ValueError as exc:
            raise FixtureValidationError(f"events.ndjson:{line}: {exc}") from exc
    return tuple(events)


def checksum(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
