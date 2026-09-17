"""One shared market clock, isolated paper accounts, same-origin HTTP/WebSocket API."""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import time
from contextlib import asynccontextmanager
from typing import Dict, List, Literal, Optional, Set

from fastapi import FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from .models import ClientMessage, SnapshotResponse
from .paper import AmendRequest, OrderRequest, PaperAccount, PaperError
from .replay import ReplayEngine

engine = ReplayEngine()
accounts: Dict[str, PaperAccount] = {}
BASE_TICK_INTERVAL = 0.1  # accelerated replay: one simulated second per 100ms


def account_for(session: str) -> PaperAccount:
    now = time.monotonic()
    for key, account in list(accounts.items()):
        if now - account.last_seen > 21600 and not any(c.session == key for c in hub.clients):
            del accounts[key]
    if session not in accounts:
        if len(accounts) >= 1000:
            raise HTTPException(503, "Demo capacity reached; retry later")
        accounts[session] = PaperAccount()
    accounts[session].last_seen = now
    return accounts[session]


def quotes():
    return {s: engine.market_data(s) for s in engine.symbols}


class Connection:
    def __init__(self, ws: WebSocket, session: Optional[str]):
        self.ws, self.session = ws, session
        self.symbols = set(engine.symbols)
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
        self._task: Optional[asyncio.Task] = None

    def add(self, conn):
        self.clients.add(conn)
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    def remove(self, conn):
        self.clients.discard(conn)

    def publish_account(self, session):
        payload = {"type": "account_snapshot", "data": account_for(session).snapshot()}
        for conn in self.clients:
            if conn.session == session:
                conn.offer(payload)

    def _broadcast(self, payload, symbol):
        for conn in self.clients:
            if symbol not in conn.symbols or time.monotonic() < conn.silent_until:
                continue
            if payload["type"] == "order_book_delta" and conn.skip_symbol == symbol:
                conn.skip_symbol = None
                continue
            conn.offer(payload)

    async def _run(self):
        while True:
            await asyncio.sleep(BASE_TICK_INTERVAL)
            if not self.clients:
                continue
            for symbol in engine.symbols:
                engine.advance(symbol)
                delta = engine.next_book_delta(symbol)
                self._broadcast({"type": "order_book_delta", "symbol": symbol,
                                 "sequence": engine.sequence(symbol), "data": [x.model_dump() for x in delta]}, symbol)
                self._broadcast({"type": "market_data", "data": engine.market_data(symbol).model_dump()}, symbol)
                self._broadcast({"type": "candle", "symbol": symbol,
                                 "data": engine.current_candle(symbol).model_dump()}, symbol)
                prints = engine.next_trades(symbol)
                if prints:
                    self._broadcast({"type": "trade", "symbol": symbol, "data": [t.model_dump() for t in prints]}, symbol)
            current_quotes = quotes()
            for session, account in list(accounts.items()):
                if account.match(current_quotes):
                    self.publish_account(session)
            for conn in list(self.clients):
                if conn.overloaded:
                    await conn.ws.close(code=1013, reason="Client backlog; reconnect to resynchronize")
                    self.remove(conn)


hub = Hub()


@asynccontextmanager
async def lifespan(app):
    yield
    if hub._task:
        hub._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await hub._task


app = FastAPI(title="VANNA paper execution workstation", version="0.2.0", lifespan=lifespan)


@app.get("/api/health")
async def health():
    return {"status": "ok", "mode": "replay" if engine.is_replay else "synthetic",
            "sessionDate": engine.session_date, "symbols": len(engine.symbols), "paperOnly": True}


@app.get("/api/snapshot", response_model=SnapshotResponse)
async def snapshot(symbols: str = Query(default="")):
    known = [s for s in (symbols.split(",") if symbols else engine.symbols) if s in engine.states]
    # No awaits or random draws between fields: one coherent, read-only image.
    return SnapshotResponse(marketData={s: engine.market_data(s) for s in known},
                            orderBooks={s: engine.order_book(s) for s in known},
                            candlesticks={s: engine.candlesticks(s, 500) for s in known},
                            trades={s: engine.recent_trades(s) for s in known}, positions=[],
                            sequences={s: engine.sequence(s) for s in known},
                            source="replay" if engine.is_replay else "synthetic", sessionDate=engine.session_date)


SESSION_PATTERN = r"^[a-zA-Z0-9_-]{16,80}$"


@app.get("/api/paper")
async def paper_snapshot(x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    return account_for(x_paper_session).snapshot()


def mutate(session, operation):
    account = account_for(session)
    try:
        operation(account)
    except PaperError as exc:
        raise HTTPException(exc.status, exc.message) from exc
    hub.publish_account(session)
    return account.snapshot()


@app.post("/api/paper/orders")
async def submit_order(request: OrderRequest, x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    return mutate(x_paper_session, lambda a: a.submit(request, quotes()))


@app.delete("/api/paper/orders/{order_id}")
async def cancel_order(order_id: str, x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    return mutate(x_paper_session, lambda a: a.cancel(order_id))


@app.patch("/api/paper/orders/{order_id}")
async def amend_order(order_id: str, request: AmendRequest, x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    return mutate(x_paper_session, lambda a: a.amend(order_id, request, quotes()))


@app.post("/api/paper/cancel-all")
async def cancel_all(x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    return mutate(x_paper_session, lambda a: a.cancel_all())


class PaperControl(BaseModel):
    action: Literal["pause", "resume", "reset"]


@app.post("/api/paper/control")
async def paper_control(request: PaperControl, x_paper_session: str = Header(pattern=SESSION_PATTERN)):
    def change(account):
        if request.action == "reset":
            epoch, revision = account.epoch, account.revision
            account.__init__()
            account.epoch, account.revision = epoch, revision + 1
        else:
            account.paused = request.action == "pause"
            account.revision += 1
    return mutate(x_paper_session, change)


def prime(conn):
    for symbol in conn.symbols:
        conn.offer({"type": "order_book_snapshot", "symbol": symbol,
                    "sequence": engine.sequence(symbol), "data": [e.model_dump() for e in engine.order_book(symbol)]})
        conn.offer({"type": "candle_snapshot", "symbol": symbol,
                    "data": [c.model_dump() for c in engine.candlesticks(symbol, 500)]})
    if conn.session:
        conn.offer({"type": "account_snapshot", "data": account_for(conn.session).snapshot()})


async def drain(conn):
    while True:
        await conn.ws.send_text(json.dumps(await conn.outbox.get()))


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, session: Optional[str] = Query(default=None, pattern=SESSION_PATTERN)):
    # Same-origin browsers only. Local scripts may omit Origin.
    origin = ws.headers.get("origin")
    allowed = os.getenv("VANNA_ORIGIN")
    if origin and origin not in {allowed, f"http://{ws.headers.get('host')}", f"https://{ws.headers.get('host')}"}:
        await ws.close(code=1008)
        return
    await ws.accept()
    conn = Connection(ws, session)
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
            elif msg.type == "subscribe" and msg.symbol in engine.states:
                symbol = msg.symbol
                conn.symbols.add(symbol)
                if msg.requestSnapshot:
                    conn.offer({"type": "order_book_snapshot", "symbol": symbol,
                                "sequence": engine.sequence(symbol), "data": [e.model_dump() for e in engine.order_book(symbol)]})
            elif msg.type == "demo" and isinstance(msg.data, dict):
                action = msg.data.get("action")
                if action == "disconnect":
                    await ws.close(code=1012, reason="Demo disconnect")
                    break
                if action == "gap":
                    conn.skip_symbol = msg.symbol if msg.symbol in engine.states else "AAPL"
                elif action == "stale":
                    conn.silent_until = time.monotonic() + 6
                elif action == "invalid":
                    conn.offer({"type": "market_data", "data": {"price": "invalid"}})
                elif action == "burst":
                    quote = engine.market_data("AAPL").model_dump()
                    # Bounded per-client burst. No shared market clock mutation.
                    conn.offer({"type": "burst", "data": [quote] * 1000})
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove(conn)
        pump.cancel()
        with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
            await pump
