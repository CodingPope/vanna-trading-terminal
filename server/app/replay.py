"""
Session replay.

Drives the feed from a recorded trading session rather than inventing prices.
The advantages over live market data are all about control: it works at 3am on
a Sunday, it is deterministic so a demo is reproducible, and — most importantly
— we still own the stream, which is what makes chaos injection possible. You
cannot force a disconnect or skip a sequence number on someone else's feed.

What is real and what is not, stated plainly:

* Bar anchors (open/high/low/close/volume per minute) come from a recorded
  session when a fixture is present.
* The tick path *within* each bar is interpolated. Minute bars do not contain
  the intra-minute path, so it is reconstructed to touch the real high and low.
* Order book depth is synthesised around the real mid. Historical L2 is not
  freely available at any sane cost, and the sequence numbering has to be ours
  regardless — injecting gaps is the point.

Without a fixture the engine falls back to seeded synthesis so the server runs
out of the box.
"""
from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from .models import CandlestickData, MarketData, OrderBookEntry, Side

FIXTURE_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "session.json"

BOOK_DEPTH = 10
TICKS_PER_BAR = 60  # one bar ≈ one minute, so roughly a tick a second at 1x


@dataclass(frozen=True)
class SymbolSeed:
    price: float
    volatility: float


# Fallback anchors for when no fixture is loaded. Approximate, hardcoded, and
# stale by design — the fixture is the real answer. Mirrors the client's
# src/store/mockData.ts, which serves the same role when there is no backend.
SEEDS: Dict[str, SymbolSeed] = {
    "AAPL": SymbolSeed(232, 0.8),
    "MSFT": SymbolSeed(438, 0.7),
    "GOOGL": SymbolSeed(178, 0.9),
    "AMZN": SymbolSeed(205, 0.9),
    "TSLA": SymbolSeed(342, 2.2),
    "NVDA": SymbolSeed(141, 1.8),
    "META": SymbolSeed(604, 1.1),
    "NFLX": SymbolSeed(890, 1.2),
    "AMD": SymbolSeed(152, 1.6),
    "CRM": SymbolSeed(276, 1.0),
    "UBER": SymbolSeed(74, 1.2),
    "COIN": SymbolSeed(248, 2.6),
    "PLTR": SymbolSeed(82, 2.4),
    "ARKK": SymbolSeed(63, 1.7),
    "SPY": SymbolSeed(598, 0.4),
    "QQQ": SymbolSeed(522, 0.5),
    "IWM": SymbolSeed(228, 0.7),
    "VIX": SymbolSeed(15.4, 3.0),
    "GLD": SymbolSeed(251, 0.4),
    "TLT": SymbolSeed(89, 0.5),
}

SYMBOLS: List[str] = list(SEEDS)


def spread_for(price: float) -> float:
    """A penny on liquid names, widening as price scales."""
    return max(0.01, round(price * 0.00005, 2))


def _ladder_step(price: float) -> float:
    return max(0.01, round(price * 0.00005, 2))


@dataclass
class Bar:
    time: float  # epoch ms
    open: float
    high: float
    low: float
    close: float
    volume: float


def _synthesise_bars(symbol: str, count: int, end_ms: float) -> List[Bar]:
    """Random-walk bars anchored on the seed, for when no fixture exists."""
    seed = SEEDS.get(symbol, SymbolSeed(100, 1.0))
    rng = random.Random(f"{symbol}-bars")
    price = seed.price * (1 - (rng.random() - 0.5) * 0.02 * seed.volatility)
    bars: List[Bar] = []
    for i in range(count):
        o = price
        c = o * (1 + (rng.random() - 0.5) * 0.004 * seed.volatility)
        h = max(o, c) * (1 + rng.random() * 0.002 * seed.volatility)
        low = min(o, c) * (1 - rng.random() * 0.002 * seed.volatility)
        bars.append(Bar(end_ms - (count - i) * 60_000, o, h, low, c, rng.randint(20_000, 200_000)))
        price = c
    return bars


def _tick_path(bar: Bar, steps: int, rng: random.Random) -> List[float]:
    """
    Reconstruct an intra-bar price path.

    A minute bar records where price started, ended, and how far it travelled —
    but not the route. This walks open to close and perturbs by the bar's own
    range, then plants the real high and low at two points so the extremes in
    the replay are the extremes that actually happened.
    """
    span = max(bar.high - bar.low, 1e-9)
    path: List[float] = []
    for i in range(steps):
        t = i / max(steps - 1, 1)
        drift = bar.open + (bar.close - bar.open) * t
        noise = (rng.random() - 0.5) * span * 0.6
        path.append(min(bar.high, max(bar.low, drift + noise)))

    if steps >= 4:
        hi_at = rng.randrange(1, steps - 1)
        lo_at = rng.randrange(1, steps - 1)
        while lo_at == hi_at and steps > 4:
            lo_at = rng.randrange(1, steps - 1)
        path[hi_at] = bar.high
        path[lo_at] = bar.low

    path[0] = bar.open
    path[-1] = bar.close
    return path


@dataclass
class SymbolState:
    symbol: str
    bars: List[Bar]
    bar_index: int = 0
    tick_index: int = 0
    path: List[float] = field(default_factory=list)
    sequence: int = 0
    book: List[OrderBookEntry] = field(default_factory=list)
    session_open: float = 0.0
    day_high: float = 0.0
    day_low: float = 0.0
    cumulative_volume: float = 0.0

    @property
    def price(self) -> float:
        return self.path[self.tick_index] if self.path else self.bars[0].open


class ReplayEngine:
    """
    Holds session state for every symbol and advances it on demand.

    Deliberately has no timer of its own: `advance()` is called by whoever owns
    the clock. That keeps playback speed a caller decision — 1x for realistic
    pacing, 100x to compress a session, unbounded to stress the client — and
    keeps the engine testable without waiting for wall time.
    """

    def __init__(self, fixture_path: Path = FIXTURE_PATH, seed: int = 7) -> None:
        self.rng = random.Random(seed)
        self.session_date: Optional[str] = None
        self.is_replay = False
        self.states: Dict[str, SymbolState] = {}
        self._load(fixture_path)

    # ── setup ────────────────────────────────────────────────────────────────

    def _load(self, fixture_path: Path) -> None:
        raw: Optional[dict] = None
        if fixture_path.exists():
            try:
                raw = json.loads(fixture_path.read_text())
            except (json.JSONDecodeError, OSError):
                raw = None

        now_ms = 1_700_000_000_000  # fixed epoch keeps replays reproducible

        if raw and raw.get("bars"):
            self.is_replay = True
            self.session_date = raw.get("sessionDate")
            for symbol, bars in raw["bars"].items():
                parsed = [
                    Bar(b["t"], b["o"], b["h"], b["l"], b["c"], b.get("v", 0))
                    for b in bars
                ]
                if parsed:
                    self.states[symbol] = self._make_state(symbol, parsed)
        else:
            for symbol in SYMBOLS:
                self.states[symbol] = self._make_state(
                    symbol, _synthesise_bars(symbol, 390, now_ms)
                )

    def _make_state(self, symbol: str, bars: List[Bar]) -> SymbolState:
        state = SymbolState(symbol=symbol, bars=bars)
        state.path = _tick_path(bars[0], TICKS_PER_BAR, self.rng)
        state.session_open = bars[0].open
        state.day_high = bars[0].high
        state.day_low = bars[0].low
        state.book = self._build_book(state.price)
        state.sequence = 1
        return state

    # ── order book ───────────────────────────────────────────────────────────

    def _build_book(self, price: float) -> List[OrderBookEntry]:
        step = _ladder_step(price)
        bids: List[OrderBookEntry] = []
        asks: List[OrderBookEntry] = []
        bid_total = 0.0
        ask_total = 0.0
        for i in range(BOOK_DEPTH):
            bid_size = float(self.rng.randrange(100, 5000))
            ask_size = float(self.rng.randrange(100, 5000))
            bid_total += bid_size
            ask_total += ask_size
            bids.append(OrderBookEntry(
                price=round(price - (i + 1) * step, 4), size=bid_size,
                total=bid_total, side=Side.BID,
            ))
            asks.append(OrderBookEntry(
                price=round(price + (i + 1) * step, 4), size=ask_size,
                total=ask_total, side=Side.ASK,
            ))
        return sorted(bids + asks, key=lambda e: e.price, reverse=True)

    # ── advancing ────────────────────────────────────────────────────────────

    def advance(self, symbol: str) -> None:
        """Move one symbol forward a single tick, wrapping at end of session."""
        state = self.states[symbol]
        state.tick_index += 1

        if state.tick_index >= len(state.path):
            state.tick_index = 0
            state.bar_index = (state.bar_index + 1) % len(state.bars)
            bar = state.bars[state.bar_index]
            state.path = _tick_path(bar, TICKS_PER_BAR, self.rng)
            state.cumulative_volume += bar.volume

        price = state.price
        state.day_high = max(state.day_high, price)
        state.day_low = min(state.day_low, price)

    def market_data(self, symbol: str) -> MarketData:
        state = self.states[symbol]
        price = state.price
        spread = spread_for(price)
        change = price - state.session_open
        return MarketData(
            symbol=symbol,
            price=round(price, 4),
            change=round(change, 4),
            changePercent=round((change / state.session_open) * 100, 4),
            volume=state.cumulative_volume,
            high=round(state.day_high, 4),
            low=round(state.day_low, 4),
            open=round(state.session_open, 4),
            close=round(price, 4),
            timestamp=state.bars[state.bar_index].time,
            bid=round(price - spread / 2, 4),
            ask=round(price + spread / 2, 4),
            bidSize=float(self.rng.randrange(100, 1200)),
            askSize=float(self.rng.randrange(100, 1200)),
        )

    def order_book(self, symbol: str) -> List[OrderBookEntry]:
        return self.states[symbol].book

    def next_book_delta(self, symbol: str) -> List[OrderBookEntry]:
        """
        Re-price the ladder around the current mid and return the changed levels.

        Bumps the symbol's sequence, which is what the client validates against.
        """
        state = self.states[symbol]
        state.book = self._build_book(state.price)
        state.sequence += 1
        changed = self.rng.sample(state.book, k=min(4, len(state.book)))
        return changed

    def sequence(self, symbol: str) -> int:
        return self.states[symbol].sequence

    def resnapshot(self, symbol: str) -> List[OrderBookEntry]:
        """Rebuild the book and hand back a fresh snapshot at the current sequence."""
        state = self.states[symbol]
        state.book = self._build_book(state.price)
        return state.book

    def candlesticks(self, symbol: str, count: int = 100) -> List[CandlestickData]:
        """
        The `count` bars leading up to the current position.

        Wraps around the session start rather than returning a short window:
        at bar 0 there is no history behind us, and a chart with one candle in
        it is worse than one showing the tail of the loop we are about to
        re-enter.
        """
        state = self.states[symbol]
        total = len(state.bars)
        end = state.bar_index + 1
        take = min(count, total)
        window = [state.bars[(end - take + i) % total] for i in range(take)]
        return [
            CandlestickData(
                time=b.time, open=round(b.open, 4), high=round(b.high, 4),
                low=round(b.low, 4), close=round(b.close, 4), volume=b.volume,
            )
            for b in window
        ]

    @property
    def symbols(self) -> List[str]:
        return list(self.states)
