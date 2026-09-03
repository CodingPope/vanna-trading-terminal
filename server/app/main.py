"""
VANNA market data server.

Serves the two halves of snapshot-then-delta:

  GET  /api/snapshot   full state plus the sequence each symbol is at
  WS   /ws             the delta stream that continues from those sequences

The sequence handoff is the whole contract. A client that applies deltas
without knowing where the snapshot left off cannot tell a gap from a fresh
start, and a book that has silently missed an update is worse than no book —
it looks right and prices wrong.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Dict, List, Set

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .models import (
    ClientMessage,
    MarketDataMessage,
    OrderBookDeltaMessage,
    OrderBookSnapshotMessage,
    PongMessage,
    SnapshotResponse,
)
from .replay import ReplayEngine

log = logging.getLogger("vanna")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = FastAPI(title="VANNA market data", version="0.1.0")

# The browser bundle is served by nginx on a different origin in the compose
# setup, and from the Vite dev server locally.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = ReplayEngine()

#: Wall-clock gap between emitted ticks at 1x. The client batches to an
#: animation frame anyway, so pushing faster than this buys nothing until the
#: speed multiplier is turned up deliberately.
BASE_TICK_INTERVAL = 0.1


@app.get("/api/health")
async def health() -> Dict[str, object]:
    return {
        "status": "ok",
        "mode": "replay" if engine.is_replay else "synthetic",
        "sessionDate": engine.session_date,
        "symbols": len(engine.symbols),
    }


@app.get("/api/snapshot", response_model=SnapshotResponse)
async def snapshot(symbols: str = Query(default="")) -> SnapshotResponse:
    """
    Full state for the requested symbols, or everything if unspecified.

    Returned before the socket starts applying deltas — an order book cannot be
    rebuilt from an update stream alone, because deltas describe change against
    a state you are assumed to already hold.
    """
    requested = [s for s in symbols.split(",") if s] or engine.symbols
    known = [s for s in requested if s in engine.states]

    return SnapshotResponse(
        marketData={s: engine.market_data(s) for s in known},
        orderBooks={s: engine.order_book(s) for s in known},
        candlesticks={s: engine.candlesticks(s) for s in known},
        sequences={s: engine.sequence(s) for s in known},
    )


class Connection:
    """One browser tab, and what it has asked to hear about."""

    def __init__(self, ws: WebSocket) -> None:
        self.ws = ws
        self.symbols: Set[str] = set(engine.symbols)
        self.speed: float = 1.0

    async def send(self, payload: object) -> None:
        await self.ws.send_text(json.dumps(payload))


async def _stream(conn: Connection) -> None:
    """Advance the session and push ticks until the socket goes away."""
    while True:
        await asyncio.sleep(BASE_TICK_INTERVAL / max(conn.speed, 0.01))

        for symbol in list(conn.symbols):
            if symbol not in engine.states:
                continue
            engine.advance(symbol)

            await conn.send(
                MarketDataMessage(data=engine.market_data(symbol)).model_dump()
            )

            # Book updates are far less frequent than prints in a real feed.
            if engine.rng.random() < 0.25:
                changed = engine.next_book_delta(symbol)
                await conn.send(
                    OrderBookDeltaMessage(
                        symbol=symbol,
                        sequence=engine.sequence(symbol),
                        data=changed,
                    ).model_dump()
                )


async def _send_snapshot(conn: Connection, symbol: str) -> None:
    await conn.send(
        OrderBookSnapshotMessage(
            symbol=symbol,
            sequence=engine.sequence(symbol),
            data=engine.resnapshot(symbol),
        ).model_dump()
    )


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    conn = Connection(ws)
    log.info("client connected")

    # Lead with a snapshot per symbol so the client has a base to apply
    # deltas against, then start streaming.
    for symbol in conn.symbols:
        await _send_snapshot(conn, symbol)

    pump = asyncio.create_task(_stream(conn))

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = ClientMessage.model_validate_json(raw)
            except ValueError:
                log.warning("unparseable client frame")
                continue

            if msg.type == "ping":
                await conn.send(PongMessage().model_dump())

            elif msg.type == "subscribe":
                # The client asks for this after detecting a sequence gap. It
                # is the recovery path: rather than trying to patch a book with
                # a hole in it, it throws the book away and asks for a new one.
                if msg.symbol and msg.symbol in engine.states:
                    if msg.requestSnapshot:
                        log.info("re-snapshot requested for %s", msg.symbol)
                        await _send_snapshot(conn, msg.symbol)
                    conn.symbols.add(msg.symbol)

    except WebSocketDisconnect:
        log.info("client disconnected")
    finally:
        pump.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await pump
