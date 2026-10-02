"""
Wire models, mirroring src/schemas/index.ts.

The client Zod-validates everything at the boundary, so any drift between
these and the Zod schemas surfaces as a runtime rejection rather than a silent
mismatch. Field names are camelCase to match the TypeScript side exactly —
there is no serialisation alias layer to get out of step.

Typing stays Python 3.9-compatible (Optional[X] rather than X | None) so the
server runs on the system interpreter as well as the 3.12 container.
"""
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, PlainSerializer
from typing_extensions import Annotated


class Side(str, Enum):
    BID = "bid"
    ASK = "ask"


class MarketData(BaseModel):
    symbol: str = Field(min_length=1, max_length=10)
    price: float = Field(gt=0)
    change: float
    changePercent: float
    volume: float = Field(ge=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    open: float = Field(gt=0)
    close: float = Field(gt=0)
    timestamp: float = Field(gt=0)
    bid: float = Field(gt=0)
    ask: float = Field(gt=0)
    bidSize: float = Field(ge=0)
    askSize: float = Field(ge=0)


class OrderBookEntry(BaseModel):
    price: float = Field(gt=0)
    size: float = Field(ge=0)
    total: float = Field(ge=0)
    side: Side


class Trade(BaseModel):
    """
    A time & sales print.

    `side` is the aggressor — who crossed the spread — not the direction of
    the price. A print at the ask is a buy.
    """

    id: str
    symbol: str
    price: float = Field(gt=0)
    size: float = Field(gt=0)
    side: Literal["buy", "sell", "unknown"]
    timestamp: float = Field(gt=0)


class Position(BaseModel):
    """
    An open position.

    Only the durable facts live here: what you hold, how much, and what you
    paid. `currentPrice`, `pnl` and `pnlPercent` are marks — the client derives
    them from the live quote, because a mark sent over the wire is stale the
    moment the next tick lands, and a P&L that lags the price it is drawn next
    to is worse than no P&L.
    """

    symbol: str
    side: Literal["long", "short"]
    size: float = Field(gt=0)
    entryPrice: float = Field(gt=0)
    currentPrice: float = Field(gt=0)
    pnl: float
    pnlPercent: float


class CandlestickData(BaseModel):
    time: float
    open: float
    high: float
    low: float
    close: float
    volume: float


# ── WebSocket envelopes ──────────────────────────────────────────────────────
# The client discriminates on `type`. Order book frames always carry a symbol
# and a sequence; market data does not, because it is not cumulative.


class MarketDataMessage(BaseModel):
    type: Literal["market_data"] = "market_data"
    data: MarketData


class OrderBookSnapshotMessage(BaseModel):
    type: Literal["order_book_snapshot"] = "order_book_snapshot"
    symbol: str
    sequence: int
    data: List[OrderBookEntry]


class OrderBookDeltaMessage(BaseModel):
    type: Literal["order_book_delta"] = "order_book_delta"
    symbol: str
    sequence: int
    data: List[OrderBookEntry]


class TradeMessage(BaseModel):
    """
    Prints are batched per tick: a tape emits many more messages than a book,
    and one frame per print would be pure overhead.
    """

    type: Literal["trade"] = "trade"
    symbol: str
    data: List[Trade]


# ── Replay control protocol ──────────────────────────────────────────────────
# Documented in docs/PROTOCOL.md. The version is carried on every status frame
# so a client can refuse a server it does not understand instead of guessing.

REPLAY_PROTOCOL_VERSION = 1


def _nanoseconds(value):
    if isinstance(value, str):
        if not value.isdigit():
            raise ValueError("Nanosecond timestamps must be decimal digits")
        return int(value)
    return value


#: A nanosecond epoch does not survive JSON: it needs 61 bits and an IEEE-754
#: double carries 53, so 2026-09-17T00:00:00Z would arrive rounded to the
#: nearest ~256ns. Replay time therefore crosses the wire as a decimal string
#: and stays an exact integer on both sides.
NanoTimestamp = Annotated[int, BeforeValidator(_nanoseconds), PlainSerializer(str, return_type=str)]
#: "max" is not a rate. It means: ignore event-time pacing and drain up to the
#: server's per-turn budget of replay units. See docs/PROTOCOL.md.
REPLAY_SPEEDS: List[Union[float, Literal["max"]]] = [0.5, 1.0, 2.0, 5.0, "max"]

def _speed(value):
    # Pydantic would happily read `true` as 1.0. A boolean speed is a client bug.
    if isinstance(value, bool):
        raise ValueError('speed must be a number or "max"')
    return value


ReplayAction = Literal["play", "pause", "speed", "step", "seek", "reset"]
ReplaySpeed = Annotated[Union[float, Literal["max"]], BeforeValidator(_speed)]


class ReplayStatus(BaseModel):
    """Authoritative playback state. The client renders this; it never infers it."""

    protocolVersion: int = REPLAY_PROTOCOL_VERSION
    fixtureId: str
    mode: Literal["synthetic", "replay", "recorded"]
    #: What one step advances: a normalized source event, or one synthetic tick.
    unit: Literal["event", "tick"]
    eventTimeNs: NanoTimestamp = Field(ge=0)
    startNs: NanoTimestamp = Field(ge=0)
    endNs: NanoTimestamp = Field(ge=0)
    speed: ReplaySpeed
    speeds: List[ReplaySpeed] = Field(default_factory=lambda: list(REPLAY_SPEEDS))
    playing: bool
    ended: bool
    #: Replay units applied since this generation began. Not an event sequence.
    sequence: int = Field(ge=0)
    #: Increments on reset and seek so a client can discard pre-rebuild frames.
    generation: int = Field(ge=0)
    canSeek: bool
    canStep: bool


class ReplayCommand(BaseModel):
    """A control the browser sends. `commandId` makes every control retry-safe."""

    model_config = ConfigDict(extra="forbid")
    commandId: str = Field(min_length=8, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    action: ReplayAction
    speed: Optional[ReplaySpeed] = None
    timestampNs: Optional[NanoTimestamp] = Field(default=None, ge=0)


class ReplayAck(BaseModel):
    """Every command is answered exactly once, accepted or not, with fresh state."""

    commandId: str
    action: ReplayAction
    accepted: bool
    #: Stable machine-readable rejection code; null when accepted.
    code: Optional[str] = None
    message: Optional[str] = None
    #: True when this ack was replayed from the idempotency cache.
    duplicate: bool = False
    status: ReplayStatus


class ReplayStatusMessage(BaseModel):
    type: Literal["replay_status"] = "replay_status"
    data: ReplayStatus


class ReplayAckMessage(BaseModel):
    type: Literal["replay_ack"] = "replay_ack"
    data: ReplayAck


class PongMessage(BaseModel):
    type: Literal["pong"] = "pong"
    data: None = None


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    data: Dict[str, str]


ServerMessage = Union[
    MarketDataMessage,
    TradeMessage,
    OrderBookSnapshotMessage,
    OrderBookDeltaMessage,
    ReplayStatusMessage,
    ReplayAckMessage,
    PongMessage,
    ErrorMessage,
]


class ClientMessage(BaseModel):
    """Anything the browser sends us. Only `type` is reliably present."""

    type: str
    symbol: Optional[str] = None
    sequence: Optional[int] = None
    requestSnapshot: Optional[bool] = None
    data: Optional[object] = None


# ── REST ─────────────────────────────────────────────────────────────────────


class SnapshotResponse(BaseModel):
    """
    The state the client needs before deltas mean anything.

    `sequences` is the contract that makes snapshot-then-delta work: it tells
    the client which delta to expect next per symbol. Without it the client
    cannot tell a gap from a fresh start.
    """

    marketData: Dict[str, MarketData]
    orderBooks: Dict[str, List[OrderBookEntry]]
    candlesticks: Dict[str, List[CandlestickData]]
    #: Recent prints, so the tape has history the moment the panel mounts
    #: rather than filling in from empty over the next minute.
    trades: Dict[str, List[Trade]]
    #: Open positions. Not per-symbol: a book spans the account.
    positions: List[Position]
    sequences: Dict[str, int]
    source: Literal["synthetic", "replay", "recorded"] = "synthetic"
    sessionDate: Optional[str] = None
    #: Playback state at the instant this snapshot was taken, so a hydrating or
    #: reconnecting client never has to wait for the next status frame.
    replay: Optional[ReplayStatus] = None
    #: The session's paper account at the same instant, so one frame makes a
    #: rebuilt client whole. Its shape is owned by app/paper.py and enforced at
    #: the browser boundary by PaperAccountSchema rather than mirrored here.
    account: Optional[Dict[str, Any]] = None
