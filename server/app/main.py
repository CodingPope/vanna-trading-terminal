"""Isolated replay sessions, shared immutable fixtures, same-origin API."""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Literal, Optional, Set

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError

from .models import ClientMessage, ReplayCommand, SnapshotResponse
from .event_store import SourceConfig
from .paper import AmendRequest, OrderRequest, PaperAccount, PaperError
from .session import ReplaySession, SessionRegistry, SessionCapacityError

# Resolved from this file's location, not the process cwd, so `.env` at the
# project root loads the same way whether uvicorn is started from there or
# from server/. Existing process environment variables always win -- this
# never overrides an explicit `export`.
load_dotenv(Path(__file__).resolve().parents[2] / '.env')

fixture_store = SourceConfig.from_environment().load()
registry = SessionRegistry.from_environment(fixture_store)
BASE_TICK_INTERVAL = 0.1
#: How often a running session refreshes its clock on screen.
STATUS_INTERVAL = 1.0
#: Frame telemetry. Off by a single switch so its cost can be measured, not
#: assumed. See docs/PERFORMANCE.md.
TELEMETRY = os.getenv("VANNA_TELEMETRY", "true") != "false"
SESSION_PATTERN = r"^[a-zA-Z0-9_-]{16,80}$"


def session_for(session: str) -> ReplaySession:
    try:
        return registry.get(session)
    except SessionCapacityError as exc:
        raise HTTPException(503, str(exc)) from exc


def account_for(session: str) -> PaperAccount:
    return session_for(session).account


class Connection:
    def __init__(self, ws: WebSocket, session: Optional[str]):
        self.ws, self.session = ws, session
        self.state = session_for(session)
        self.symbols = set(self.state.market.symbols)
        #: Frames sent on this socket. A gap tells the client it lost frames,
        #: which no per-symbol book sequence can say on its own.
        self.frames = 0
        self.outbox: asyncio.Queue = asyncio.Queue(maxsize=2000)
        self.skip_symbol = None
        self.silent_until = 0.0
        self.overloaded = False

    def offer(self, payload):
        try:
            self.outbox.put_nowait(payload)
        except asyncio.QueueFull:
            # Never silently lose account events. Disconnect and recover complete
            # market/account snapshots on reconnect, rather than growing memory.
            self.overloaded = True


class Hub:
    def __init__(self):
        self.clients: Set[Connection] = set()
        self.control_state: Dict[str, tuple] = {}
        self._task: Optional[asyncio.Task] = None

    def add(self, conn):
        self.clients.add(conn)
        conn.state.connections += 1
        conn.state.last_pump = time.monotonic()
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    def remove(self, conn):
        if conn in self.clients:
            conn.state.connections -= 1
            conn.state.last_seen = time.monotonic()
        self.clients.discard(conn)

    def publish(self, session, payload, *, subscribed_only=False):
        """Account and control traffic reaches every connection; it is never shed."""
        for conn in self.clients:
            if conn.session != session:
                continue
            symbol = payload.get("symbol")
            if subscribed_only and symbol and symbol not in conn.symbols:
                continue
            conn.offer(payload)

    def publish_account(self, session):
        self.publish(session, {"type": "account_snapshot", "data": account_for(session).snapshot()})

    def publish_snapshot(self, session, state):
        """One coherent image per client after a rebuild. A client replaces its
        state with this; it never reconciles it against pre-rebuild deltas."""
        for conn in self.clients:
            if conn.session == session:
                conn.offer({"type": "snapshot",
                            "data": state.snapshot(sorted(conn.symbols)).model_dump()})

    def _broadcast(self, payload, session):
        for conn in self.clients:
            if conn.session != session:
                continue
            data = payload.get('data')
            symbol = payload.get('symbol') or (data.get('symbol') if isinstance(data, dict) else None)
            if symbol and symbol not in conn.symbols:
                continue
            if payload['type'] != 'account_snapshot' and time.monotonic() < conn.silent_until:
                continue
            if payload['type'] == 'order_book_delta' and conn.skip_symbol == symbol:
                conn.skip_symbol = None
                continue
            conn.offer(payload)

    @staticmethod
    def signature(status):
        # The unit counter moves every tick; only these fields are worth a frame.
        return (status.playing, status.ended, status.speed, status.generation,
                status.mode, status.fixtureId, status.canSeek)

    def publish_status(self, key, status, now=None):
        """A client that has to infer "playback stopped" from silence cannot
        follow server-authoritative state, so every control change is announced.
        The clock also ticks on screen, so a running session refreshes at
        STATUS_INTERVAL rather than on every replay unit, which would be a frame
        per event."""
        now = time.monotonic() if now is None else now
        previous, sent_at = self.control_state.get(key, (None, 0.0))
        if previous == self.signature(status) and now - sent_at < STATUS_INTERVAL:
            return
        self.control_state[key] = (self.signature(status), now)
        self.publish(key, {"type": "replay_status", "data": status.model_dump()})

    async def _run(self):
        while True:
            await asyncio.sleep(BASE_TICK_INTERVAL)
            registry.cleanup()
            self.control_state = {k: v for k, v in self.control_state.items() if k in registry.sessions}
            now = time.monotonic()
            for key in {conn.session for conn in self.clients}:
                state = registry.sessions[key]
                elapsed = now - state.last_pump
                state.last_pump = now
                for payload in state.advance(elapsed):
                    self._broadcast(payload, key)
                self.publish_status(key, state.status(), now)
            for conn in list(self.clients):
                if conn.overloaded:
                    await conn.ws.close(code=1013, reason="Client backlog; reconnect to resynchronize")
                    self.remove(conn)


hub = Hub()


@asynccontextmanager
async def lifespan(app):
    hub._task = asyncio.create_task(hub._run())
    yield
    if hub._task:
        hub._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await hub._task


app = FastAPI(title="VANNA paper execution workstation", version="0.2.0", lifespan=lifespan)


@app.get("/api/health")
async def health():
    return {"status": "ok", "mode": fixture_store.manifest.mode if fixture_store else "synthetic",
            "symbols": len(fixture_store.manifest.symbols) if fixture_store else 20, "paperOnly": True}


@app.get("/api/fixtures")
async def fixtures():
    """Available validated normalized sources, not a claim of active playback."""
    return {"fixtures": [fixture_store.metadata.model_dump()] if fixture_store else []}


@app.get("/api/snapshot", response_model=SnapshotResponse)
async def snapshot(symbols: str = Query(default=""),
                   x_paper_session: Optional[str] = Header(default=None, pattern=SESSION_PATTERN)):
    # Anonymous requests get a temporary read-only preview, never a shared cursor.
    state = session_for(x_paper_session) if x_paper_session else ReplaySession(fixture_store, anchor_ms=registry.anchor_ms)
    return state.snapshot(symbols.split(',') if symbols else None)


@app.get("/api/paper")
async def paper_snapshot(x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    return account_for(x_paper_session).snapshot()


def mutate(session, operation):
    state = session_for(session)
    if state.rebuilding:
        # Unreachable while rebuilds stay synchronous; enforced so it stays true.
        raise HTTPException(409, "Replay state is rebuilding; retry after the next snapshot")
    account = state.account
    try:
        operation(account)
    except PaperError as exc:
        raise HTTPException(exc.status, exc.message) from exc
    hub.publish_account(session)
    return account.snapshot()


@app.post("/api/paper/orders")
async def submit_order(request: OrderRequest, x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    return mutate(x_paper_session, lambda a: a.submit(request, session_for(x_paper_session).quotes()))


@app.delete("/api/paper/orders/{order_id}")
async def cancel_order(order_id: str, x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    return mutate(x_paper_session, lambda a: a.cancel(order_id))


@app.patch("/api/paper/orders/{order_id}")
async def amend_order(order_id: str, request: AmendRequest, x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    return mutate(x_paper_session, lambda a: a.amend(order_id, request, session_for(x_paper_session).quotes()))


@app.post("/api/paper/cancel-all")
async def cancel_all(x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    return mutate(x_paper_session, lambda a: a.cancel_all())


class PaperControl(BaseModel):
    action: Literal["pause", "resume", "reset"]


@app.post("/api/paper/control")
async def paper_control(request: PaperControl, x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    def change(account):
        if request.action == "reset":
            account.reset()
        else:
            account.paused = request.action == "pause"
            account.revision += 1
    return mutate(x_paper_session, change)


def prime(conn):
    engine = conn.state.market
    # Playback state first: a reconnecting client should never render controls
    # from a guess, not even for the second until the next status refresh.
    conn.offer({"type": "replay_status", "data": conn.state.status().model_dump()})
    for symbol in conn.symbols:
        conn.offer({"type": "order_book_snapshot", "symbol": symbol,
                    "sequence": engine.sequence(symbol), "data": [e.model_dump() for e in engine.order_book(symbol)]})
        conn.offer({"type": "candle_snapshot", "symbol": symbol,
                    "data": [c.model_dump() for c in engine.candlesticks(symbol, 500)]})
    if conn.session:
        conn.offer({"type": "account_snapshot", "data": account_for(conn.session).snapshot()})


async def drain(conn):
    while True:
        payload = await conn.outbox.get()
        if TELEMETRY:
            conn.frames += 1
            # Stamped here, at the moment of the send, not when the frame was
            # queued. `emittedNs` is this process's monotonic clock: it is a
            # server-side interval reference, never a wall clock to subtract a
            # browser timestamp from. See docs/PERFORMANCE.md.
            payload = {**payload, "t": {"seq": conn.frames, "emittedNs": str(time.monotonic_ns())}}
        await conn.ws.send_text(json.dumps(payload))


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, session: Optional[str] = Query(default=None, pattern=SESSION_PATTERN)):
    # Same-origin or listed browsers only. Local scripts may omit Origin.
    origin = ws.headers.get("origin")
    # VANNA_ORIGIN lists the cross-origin UIs allowed in, comma-separated: the
    # deployed UI is on a different host from this API.
    allowed = {o.strip() for o in os.getenv("VANNA_ORIGIN", "").split(",") if o.strip()}
    if origin and origin not in allowed | {f"http://{ws.headers.get('host')}", f"https://{ws.headers.get('host')}"}:
        await ws.close(code=1008)
        return
    session = session or uuid.uuid4().hex
    try:
        conn = Connection(ws, session)
    except HTTPException:
        await ws.close(code=1013)
        return
    engine = conn.state.market
    await ws.accept()
    prime(conn)
    hub.add(conn)
    pump = asyncio.create_task(drain(conn))
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = ClientMessage.model_validate_json(raw)
            except ValueError:
                conn.offer({"type": "error", "data": {"message": "Invalid client message"}})
                continue
            if session:
                account_for(session)
            if msg.type == "ping":
                conn.offer({"type": "pong", "data": None})
            elif msg.type == "subscribe" and msg.symbol in engine.symbols:
                symbol = msg.symbol
                conn.symbols.add(symbol)
                if msg.requestSnapshot:
                    conn.offer({"type": "order_book_snapshot", "symbol": symbol,
                                "sequence": engine.sequence(symbol), "data": [e.model_dump() for e in engine.order_book(symbol)]})
            elif msg.type == "replay":
                payload = msg.data if isinstance(msg.data, dict) else {}
                try:
                    command = ReplayCommand.model_validate(payload)
                except ValidationError:
                    # A command we cannot even name gets a structured error, not a closed socket.
                    conn.offer({"type": "error", "data": {"code": "invalid_command",
                                "commandId": str(payload.get("commandId", ""))[:80],
                                "message": "Unsupported replay command"}})
                    continue
                generation = conn.state.generation
                ack, frames = conn.state.apply(command)
                for frame in frames:
                    hub.publish(session, frame, subscribed_only=True)
                if conn.state.generation != generation:
                    hub.publish_snapshot(session, conn.state)
                if ack.accepted:
                    # A rejection changed nothing, so it needs no session-wide frame.
                    hub.publish(session, {"type": "replay_status", "data": ack.status.model_dump()})
                    hub.control_state[session] = (hub.signature(ack.status), time.monotonic())
                conn.offer({"type": "replay_ack", "data": ack.model_dump()})
            elif msg.type == "demo" and isinstance(msg.data, dict):
                action = msg.data.get("action")
                if action == "disconnect":
                    await ws.close(code=1012, reason="Demo disconnect")
                    break
                if action == "gap":
                    conn.skip_symbol = msg.symbol if msg.symbol in engine.symbols else "AAPL"
                elif action == "stale":
                    conn.silent_until = time.monotonic() + 6
                elif action == "invalid":
                    conn.offer({"type": "market_data", "data": {"price": "invalid"}})
                elif action == "burst":
                    quote = next(iter(conn.state.quotes().values()), None)
                    if quote is None:
                        continue
                    quote = quote.model_dump()
                    # Bounded per-client burst. No shared market clock mutation.
                    conn.offer({"type": "burst", "data": [quote] * 1000})
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove(conn)
        pump.cancel()
        with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
            await pump
