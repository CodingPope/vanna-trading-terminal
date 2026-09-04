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
from typing import Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field


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
    side: Literal["buy", "sell"]
    timestamp: float = Field(gt=0)


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
    sequences: Dict[str, int]
