"""Session-owned clocks and market state over immutable normalized source events."""
from __future__ import annotations

import hashlib
import json
import os
import time
from bisect import bisect_right
from collections import OrderedDict, deque
from datetime import datetime, timezone
from pathlib import Path

from .event_store import EventStore
from .models import (REPLAY_SPEEDS, CandlestickData, MarketData, OrderBookEntry, ReplayAck,
                     ReplayCommand, ReplayStatus, SnapshotResponse, Trade)
from .paper import PaperAccount
from .replay import ReplayEngine

#: One scheduler turn drains at most this many replay units. It is also the
#: precise meaning of the "max" speed: no event-time pacing, this budget only.
UNITS_PER_TURN = 256
#: Acks retained per session for retry-safe controls across a reconnect.
COMMAND_HISTORY = 256
#: Seek replays from the nearest checkpoint, so its cost is the stride below
#: rather than the length of the fixture. The cap bounds memory instead: a
#: longer fixture gets a longer stride, never more checkpoints.
CHECKPOINT_STRIDE = 512
CHECKPOINT_LIMIT = 64


class EventMarket:
    """A pure fold over an event prefix: the same prefix always yields the same state,
    whether it was reached by playing forward or restored from a checkpoint."""

    def __init__(self, store: EventStore, checkpoint=None):
        self.store = store
        if checkpoint is not None:
            self.restore(checkpoint)
            return
        self.cursor = 0
        self.time_ns = store.manifest.start_ns
        self.books = {s: {'bid': {}, 'ask': {}} for s in store.manifest.symbols}
        self.tapes = {s: deque(maxlen=200) for s in store.manifest.symbols}
        self.candles = {s: [] for s in store.manifest.symbols}
        self.quotes = {}
        self.last = {}
        self.opens = {}
        self.highs = {}
        self.lows = {}
        self.volumes = {s: 0 for s in store.manifest.symbols}
        self.sequences = {s: 0 for s in store.manifest.symbols}
        self.statuses = {s: 'unknown' for s in store.manifest.symbols}
        # Initial image contains all events exactly at the declared start.
        while self.cursor < len(store.events) and store.events[self.cursor].timestamp_ns <= self.time_ns:
            self.step()

    #: Per-symbol maps of plain values. Source events are immutable and shared,
    #: so copying these containers is copying the whole state.
    TABLES = ('quotes', 'last', 'opens', 'highs', 'lows', 'volumes', 'sequences', 'statuses')

    def checkpoint(self):
        """A copy detached enough that a restored market cannot alias this one."""
        return dict(cursor=self.cursor, time_ns=self.time_ns,
                    books={s: {side: dict(levels) for side, levels in book.items()}
                           for s, book in self.books.items()},
                    tapes={s: list(tape) for s, tape in self.tapes.items()},
                    candles={s: list(bars) for s, bars in self.candles.items()},
                    **{name: dict(getattr(self, name)) for name in self.TABLES})

    def restore(self, checkpoint):
        self.cursor, self.time_ns = checkpoint['cursor'], checkpoint['time_ns']
        self.books = {s: {side: dict(levels) for side, levels in book.items()}
                      for s, book in checkpoint['books'].items()}
        self.tapes = {s: deque(tape, maxlen=200) for s, tape in checkpoint['tapes'].items()}
        self.candles = {s: list(bars) for s, bars in checkpoint['candles'].items()}
        for name in self.TABLES:
            setattr(self, name, dict(checkpoint[name]))

    @property
    def symbols(self):
        return self.store.manifest.symbols

    def step(self):
        event = self.store.events[self.cursor]
        self.cursor += 1
        self.time_ns = event.timestamp_ns
        symbol = event.symbol
        if event.type == 'depth_snapshot':
            self.books[symbol] = {'bid': {x.price_nanos: x.size for x in event.bids},
                                  'ask': {x.price_nanos: x.size for x in event.asks}}
            self.sequences[symbol] += 1
            self._quote_from_book(symbol)
        elif event.type == 'depth_update':
            for change in event.changes:
                side = self.books[symbol][change.side]
                if change.size:
                    side[change.price_nanos] = change.size
                else:
                    side.pop(change.price_nanos, None)
            self.sequences[symbol] += 1
            self._quote_from_book(symbol)
        elif event.type == 'quote':
            self.quotes[symbol] = (event.bid, event.ask)
        elif event.type == 'trade':
            price = event.price_nanos / 1e9
            self.last[symbol] = price
            self.opens.setdefault(symbol, price)
            self.highs[symbol] = max(self.highs.get(symbol, price), price)
            self.lows[symbol] = min(self.lows.get(symbol, price), price)
            self.volumes[symbol] += event.size
            self.tapes[symbol].append(Trade(id=f'{symbol}-{event.sequence}', symbol=symbol,
                price=price, size=event.size, side=event.aggressor, timestamp=event.timestamp_ns / 1e6))
            minute = (event.timestamp_ns // 60_000_000_000) * 60_000
            candles = self.candles[symbol]
            if not candles or candles[-1].time != minute:
                candles.append(CandlestickData(time=minute, open=price, high=price, low=price,
                                                close=price, volume=event.size))
                del candles[:-500]
            else:
                bar = candles[-1]
                candles[-1] = bar.model_copy(update=dict(high=max(bar.high, price), low=min(bar.low, price),
                                                        close=price, volume=bar.volume + event.size))
        elif event.type == 'trading_status':
            self.statuses[symbol] = event.status
        return event

    def _quote_from_book(self, symbol):
        from .replay_models import Level
        book = self.books[symbol]
        bid, ask = max(book['bid'], default=None), min(book['ask'], default=None)
        self.quotes[symbol] = (Level(price_nanos=bid, size=book['bid'][bid]) if bid else None,
                               Level(price_nanos=ask, size=book['ask'][ask]) if ask else None)

    def market_data(self, symbol):
        bid, ask = self.quotes.get(symbol, (None, None))
        if bid is None or ask is None:
            return None  # Never invent a missing side or a price to satisfy the UI.
        price = self.last.get(symbol, (bid.price_nanos + ask.price_nanos) / 2e9)
        opened = self.opens.get(symbol, price)
        return MarketData(symbol=symbol, price=price, change=price-opened,
            changePercent=(price-opened)/opened*100, volume=self.volumes[symbol],
            high=self.highs.get(symbol, price), low=self.lows.get(symbol, price), open=opened,
            close=price, timestamp=self.time_ns / 1e6, bid=bid.price_nanos/1e9, ask=ask.price_nanos/1e9,
            bidSize=bid.size, askSize=ask.size)

    def order_book(self, symbol):
        rows = []
        for side in ('bid', 'ask'):
            total = 0
            for price, size in sorted(self.books[symbol][side].items(), reverse=side == 'bid'):
                total += size
                rows.append(OrderBookEntry(price=price/1e9, size=size, total=total, side=side))
        return sorted(rows, key=lambda r: -r.price)

    def sequence(self, symbol):
        return self.sequences[symbol]

    def candlesticks(self, symbol, count=500):
        return self.candles[symbol][-count:]

    def recent_trades(self, symbol, count=200):
        return list(reversed(self.tapes[symbol]))[:count]


class Checkpoints:
    """Sparse market images so a seek costs a stride, not a fixture.

    The index is a pure function of an immutable store, so every session over
    that store shares one copy and pays the build cost at most once.
    """

    def __init__(self, store: EventStore, *, stride=CHECKPOINT_STRIDE, limit=CHECKPOINT_LIMIT):
        self.store = store
        self.stride = max(stride, -(-len(store.events) // limit))
        self.marks = None

    def build(self):
        if self.marks is not None:
            return self.marks
        market, marks = EventMarket(self.store), []
        while market.cursor < len(self.store.events):
            market.step()
            if market.cursor % self.stride == 0:
                marks.append((market.time_ns, market.checkpoint()))
        self.marks = tuple(marks)
        return self.marks

    def at(self, timestamp_ns):
        """The latest checkpoint at or before `timestamp_ns`, or None for the start.

        A checkpoint can land mid-timestamp when many events share one instant.
        That is safe: the fold resumes from its exact cursor, so the events still
        pending at that instant are applied like any others.
        """
        marks = self.build()
        index = bisect_right([time_ns for time_ns, _ in marks], timestamp_ns)
        return marks[index - 1][1] if index else None


class ReplaySession:
    """Timers only schedule work. Market evolution is driven by event time."""
    def __init__(self, store=None, *, anchor_ms=None, legacy_fixture=None, checkpoints=None):
        self.store = store
        self.anchor_ms = int(time.time()*1000) if anchor_ms is None else anchor_ms
        self.legacy_fixture = legacy_fixture or Path('/no-vanna-legacy-fixture')
        self.last_seen = time.monotonic()
        self.last_pump = self.last_seen
        self.connections = 0
        self.generation = 0
        # True only inside a rebuild. No await happens there, so no client can
        # observe it; commands that would race a rebuild are refused regardless.
        self.rebuilding = False
        self._checkpoints = checkpoints
        # Outlives reset: a retried reset must be answered, never applied twice.
        self.commands = OrderedDict()
        self.reset()

    @property
    def checkpoints(self):
        if self._checkpoints is None:
            self._checkpoints = Checkpoints(self.store)
        return self._checkpoints

    def reset(self):
        """Return to the documented initial state as one step, never in stages."""
        self.rebuilding = True
        try:
            market = EventMarket(self.store) if self.store else ReplayEngine(
                fixture_path=self.legacy_fixture, anchor_ms=self.anchor_ms)
            self.mode = self.store.manifest.mode if self.store else ('replay' if market.is_replay else 'synthetic')
            time_ns = market.time_ns if self.store else int(market.event_time(market.symbols[0])*1e6)
            self.start_ns = self.store.manifest.start_ns if self.store else time_ns
            self.end_ns = self.store.manifest.end_ns if self.store else self.start_ns + 3_600_000_000_000
            self.market, self.time_ns, self.target_ns = market, time_ns, time_ns
            self.speed = 1.0
            self.units = 0
            self.playing = not self.ended
            self.account = PaperAccount(clock_ms=lambda: self.time_ns // 1_000_000, deterministic=True)
            self.last_pump = time.monotonic()
            self.generation += 1
        finally:
            self.rebuilding = False

    @property
    def ended(self):
        return self.market.cursor >= len(self.store.events) if self.store else self.time_ns >= self.end_ns

    @property
    def fixture_id(self):
        return self.store.identity if self.store else f'{self.mode}-seed-7-{self.anchor_ms}'

    @property
    def unit(self):
        """What one step advances. Synthetic ticks have no source events to count."""
        return 'event' if self.store else 'tick'

    @property
    def can_seek(self):
        # Only an indexed event store can be rewound. The synthetic engine walks
        # a random path forward and cannot reproduce a past instant.
        return self.store is not None

    def status(self):
        return ReplayStatus(fixtureId=self.fixture_id, mode=self.mode, unit=self.unit,
                            eventTimeNs=self.time_ns, startNs=self.start_ns, endNs=self.end_ns,
                            speed=self.speed, speeds=list(REPLAY_SPEEDS), playing=self.playing,
                            ended=self.ended, sequence=self.units, generation=self.generation,
                            canSeek=self.can_seek, canStep=True)

    def quotes(self):
        return {s: q for s in self.market.symbols if (q := self.market.market_data(s)) is not None}

    def snapshot(self, symbols=None):
        known = [s for s in (symbols or self.market.symbols) if s in self.market.symbols]
        quotes = self.quotes()
        return SnapshotResponse(marketData={s: quotes[s] for s in known if s in quotes},
            orderBooks={s: self.market.order_book(s) for s in known},
            candlesticks={s: self.market.candlesticks(s, 500) for s in known},
            trades={s: self.market.recent_trades(s) for s in known}, positions=[],
            sequences={s: self.market.sequence(s) for s in known}, source=self.mode,
            sessionDate=datetime.fromtimestamp(self.time_ns / 1e9, timezone.utc).date().isoformat(),
            replay=self.status(), account=self.account.snapshot())

    def step(self):
        if self.ended:
            self.playing = False
            return []
        frames = []
        self.units += 1
        if self.store:
            event = self.market.step()
            self.time_ns = event.timestamp_ns
            symbol = event.symbol
            if event.type.startswith('depth_'):
                frames.append(dict(type='order_book_snapshot', symbol=symbol,
                    sequence=self.market.sequence(symbol), data=[x.model_dump() for x in self.market.order_book(symbol)]))
            if event.type == 'trade':
                frames.append(dict(type='trade', symbol=symbol, data=[self.market.tapes[symbol][-1].model_dump()]))
                frames.append(dict(type='candle', symbol=symbol, data=self.market.candlesticks(symbol)[-1].model_dump()))
            quote = self.market.market_data(symbol)
            if quote:
                frames.append(dict(type='market_data', data=quote.model_dump()))
        else:
            for symbol in self.market.symbols:
                self.market.advance(symbol)
                delta = self.market.next_book_delta(symbol)
                frames.extend([
                    dict(type='order_book_delta', symbol=symbol, sequence=self.market.sequence(symbol),
                         data=[x.model_dump() for x in delta]),
                    dict(type='market_data', data=self.market.market_data(symbol).model_dump()),
                    dict(type='candle', symbol=symbol, data=self.market.current_candle(symbol).model_dump()),
                ])
                prints = self.market.next_trades(symbol)
                if prints:
                    frames.append(dict(type='trade', symbol=symbol, data=[x.model_dump() for x in prints]))
            self.time_ns = int(self.market.event_time(self.market.symbols[0])*1e6)
        if self.account.match(self.quotes(), now=self.time_ns / 1e9):
            frames.append(dict(type='account_snapshot', data=self.account.snapshot()))
        if self.ended:
            self.playing = False
        return frames

    def advance(self, elapsed_seconds):
        if not self.playing:
            return []
        if self.speed != 'max':
            self.target_ns = min(self.end_ns, self.target_ns + int(max(0, elapsed_seconds)*self.speed*1e9))
        frames = []
        # max = at most UNITS_PER_TURN normalized events (or synthetic ticks) per
        # scheduler turn. Pending events stay queued in the store; nothing is shed.
        for _ in range(UNITS_PER_TURN):
            if self.ended:
                self.playing = False
                break
            next_ns = self.store.events[self.market.cursor].timestamp_ns if self.store else self.time_ns + 1_000_000_000
            if self.speed != 'max' and next_ns > self.target_ns:
                break
            frames.extend(self.step())
        return frames

    # ── Controls. The wire contract is docs/PROTOCOL.md. ─────────────────────

    def seek(self, timestamp_ns):
        """Rebuild market and paper state at an instant, as one indivisible step.

        Seek discards user orders, positions, and cash: a paper fill that happened
        after the target instant cannot honestly survive a rewind past its own
        trade. The new state is assembled in full before anything is swapped in,
        so a failed rebuild leaves the session exactly as it was.
        """
        self.rebuilding = True
        try:
            market = self._market_at(timestamp_ns)
            market.time_ns = timestamp_ns
            self.market = market
            self.account = PaperAccount(clock_ms=lambda: self.time_ns // 1_000_000, deterministic=True)
            self.time_ns = self.target_ns = timestamp_ns
            self.units = 0
            self.generation += 1
            self.playing = self.playing and not self.ended
        finally:
            self.rebuilding = False

    def _market_at(self, timestamp_ns):
        """Fold events up to `timestamp_ns`, resuming from whichever start is nearest."""
        resume = self.checkpoints.at(timestamp_ns)
        if self.market.time_ns <= timestamp_ns and (resume is None or self.market.cursor > resume['cursor']):
            # Already short of the target: carrying on beats rewinding to a mark.
            resume = self.market.checkpoint()
        market = EventMarket(self.store, resume)
        events = self.store.events
        while market.cursor < len(events) and events[market.cursor].timestamp_ns <= timestamp_ns:
            market.step()
        return market

    def digest(self):
        """A stable fingerprint of logical state, for proving two paths agree."""
        payload = self.snapshot().model_dump()
        payload.pop('replay')  # Generation and unit counters are bookkeeping, not state.
        payload['account'].pop('epoch')  # A fresh account identity is not market state.
        payload['eventTimeNs'] = str(self.time_ns)
        return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()

    def apply(self, command: ReplayCommand):
        """Answer one control with (ack, frames). A retried ID is answered, not reapplied."""
        if command.commandId in self.commands:
            action, code, message = self.commands[command.commandId]
            return ReplayAck(commandId=command.commandId, action=action, accepted=code is None,
                             code=code, message=message, duplicate=True, status=self.status()), []
        code, message, frames = self._apply(command)
        self.commands[command.commandId] = (command.action, code, message)
        while len(self.commands) > COMMAND_HISTORY:
            self.commands.popitem(last=False)
        return ReplayAck(commandId=command.commandId, action=command.action, accepted=code is None,
                         code=code, message=message, status=self.status()), frames

    def _apply(self, command):
        at_end = ('at_end', 'Replay is at the end of the session; reset or seek before playing on.', [])
        if command.action == 'play':
            if self.ended:
                return at_end
            self.playing, self.target_ns = True, self.time_ns
        elif command.action == 'pause':
            self.playing = False
        elif command.action == 'speed':
            if command.speed is None or command.speed not in REPLAY_SPEEDS:
                return 'unsupported_speed', f'Supported speeds: {REPLAY_SPEEDS}.', []
            self.speed, self.target_ns = command.speed, self.time_ns
        elif command.action == 'step':
            if self.ended:
                return at_end
            self.playing = False
            frames = self.step()
            self.target_ns = self.time_ns
            return None, None, frames
        elif command.action == 'seek':
            if not self.can_seek:
                return 'seek_unavailable', 'A synthetic session walks forward only; load a fixture to seek.', []
            if command.timestampNs is None:
                return 'invalid_command', 'seek requires timestampNs.', []
            if not self.start_ns <= command.timestampNs <= self.end_ns:
                return 'out_of_bounds', f'Seek target must fall within {self.start_ns}..{self.end_ns}.', []
            self.seek(command.timestampNs)
        elif command.action == 'reset':
            self.reset()
        return None, None, []


class SessionCapacityError(ValueError):
    pass


class SessionRegistry:
    def __init__(self, store=None, *, max_sessions=32, idle_seconds=1800, clock=time.monotonic, anchor_ms=None):
        if not 1 <= max_sessions <= 256 or not 1 <= idle_seconds <= 86400:
            raise ValueError('Session limits: max_sessions 1..256; idle_seconds 1..86400')
        self.store, self.max_sessions, self.idle_seconds = store, max_sessions, idle_seconds
        self.clock, self.anchor_ms = clock, int(time.time()*1000) if anchor_ms is None else anchor_ms
        # One index over one immutable store, shared by every session it serves.
        self.checkpoints = Checkpoints(store) if store else None
        self.sessions = {}

    @classmethod
    def from_environment(cls, store=None):
        return cls(store, max_sessions=int(os.getenv('VANNA_MAX_SESSIONS', '32')),
                   idle_seconds=int(os.getenv('VANNA_SESSION_IDLE_SECONDS', '1800')))

    def cleanup(self):
        now = self.clock()
        for key, session in list(self.sessions.items()):
            if not session.connections and now-session.last_seen >= self.idle_seconds:
                del self.sessions[key]

    def get(self, key):
        self.cleanup()
        if key not in self.sessions:
            if len(self.sessions) >= self.max_sessions:
                raise SessionCapacityError('Demo session capacity reached; retry after an idle session expires')
            self.sessions[key] = ReplaySession(self.store, anchor_ms=self.anchor_ms,
                                               checkpoints=self.checkpoints)
        session = self.sessions[key]
        session.last_seen = self.clock()
        return session
