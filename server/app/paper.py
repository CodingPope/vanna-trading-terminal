"""Isolated, in-memory paper accounts. No broker connection or real orders.

The ledger uses Decimal USD, integral shares and average cost. Matching is a
deliberately simple 25-share slice at the synthetic touch, at most once per
750ms. A market order has a 1% collar; IOC cancels its remainder after one
matching attempt. Every mutation returns a complete versioned account image.
"""
from __future__ import annotations

from copy import deepcopy
import time
import uuid
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

ACTIVE = {"working", "partially_filled"}
INITIAL_CASH = Decimal("100000")
MAX_ORDER = Decimal("50000")
MAX_GROSS = Decimal("250000")


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


class OrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    clientOrderId: str = Field(min_length=8, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    symbol: str = Field(min_length=1, max_length=10)
    side: Literal["buy", "sell"]
    orderType: Literal["limit", "market"] = "limit"
    quantity: int = Field(gt=0, le=10000, strict=True)
    limitPrice: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)
    timeInForce: Literal["GTC", "IOC"] = "GTC"

    @field_validator("limitPrice")
    @classmethod
    def tick_size(cls, value):
        if value is not None and Decimal(str(value)) != money(value):
            raise ValueError("Price must be a multiple of $0.01")
        return value


class AmendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=1)
    quantity: int = Field(gt=0, le=10000, strict=True)
    limitPrice: float = Field(gt=0, allow_inf_nan=False)

    @field_validator("limitPrice")
    @classmethod
    def tick_size(cls, value):
        return OrderRequest.tick_size(value)


class PaperError(Exception):
    def __init__(self, message: str, status: int = 409):
        self.message, self.status = message, status


class PaperAccount:
    def __init__(self):
        self.epoch = uuid.uuid4().hex
        self.revision = 0
        self.orders: Dict[str, dict] = {}
        self.requests: Dict[str, dict] = {}
        self.holdings: Dict[str, dict] = {}
        self.executions = []
        self.cash = INITIAL_CASH
        self.realized = Decimal(0)
        self.fees = Decimal(0)
        self.paused = False
        self.last_match = 0.0
        self.last_seen = time.monotonic()

    def _risk(self, symbol, quantity, price, quotes, exclude=None):
        if quantity * price > MAX_ORDER:
            return "Order notional exceeds the $50,000 paper limit"
        gross = sum(abs(p["quantity"]) * money(quotes[s].price) for s, p in self.holdings.items())
        reserved = sum((o["quantity"] - o["filledQuantity"]) * money(o["riskPrice"])
                       for o in self.orders.values() if o["status"] in ACTIVE and o["id"] != exclude)
        if gross + reserved + quantity * price > MAX_GROSS:
            return "Gross exposure including working orders exceeds $250,000"
        return None

    def submit(self, request: OrderRequest, quotes, now=None):
        body = request.model_dump()
        if request.clientOrderId in self.requests:
            if self.requests[request.clientOrderId] != body:
                raise PaperError("This client order ID already belongs to a different request")
            return  # Retry acknowledges the original order; never executes twice.
        if len(self.orders) >= 200:
            raise PaperError("This demo account has reached 200 orders; reset it to continue", 429)
        if request.symbol not in quotes or request.symbol == "VIX":
            raise PaperError("Select a supported equity or ETF; VIX is an index", 422)
        if request.orderType == "limit" and request.limitPrice is None:
            raise PaperError("Limit orders require a limit price", 422)
        quote = quotes[request.symbol]
        touch = money(quote.ask if request.side == "buy" else quote.bid)
        collar = money(touch * (Decimal("1.01") if request.side == "buy" else Decimal("0.99")))
        price = money(request.limitPrice) if request.orderType == "limit" else collar
        reason = self._risk(request.symbol, request.quantity, max(price, touch), quotes)
        stamp = int(time.time() * 1000) if now is None else now
        order_id = uuid.uuid4().hex
        self.orders[order_id] = {
            **body, "id": order_id, "status": "rejected" if reason else "working",
            "filledQuantity": 0, "averageFillPrice": 0.0, "createdAt": stamp,
            "updatedAt": stamp, "version": 1, "reason": reason,
            "riskPrice": float(max(price, touch)), "collar": float(collar),
        }
        self.requests[request.clientOrderId] = body
        self.revision += 1

    def cancel(self, order_id):
        order = self.orders.get(order_id)
        if order is None:
            raise PaperError("Order no longer exists", 404)
        if order["status"] not in ACTIVE:
            return
        order.update(status="canceled", reason="Canceled by user", updatedAt=int(time.time() * 1000), version=order["version"] + 1)
        self.revision += 1

    def cancel_all(self):
        for order_id in self.orders:
            self.cancel(order_id)

    def amend(self, order_id, request: AmendRequest, quotes):
        order = self.orders.get(order_id)
        if order is None:
            raise PaperError("Order no longer exists", 404)
        if order["status"] not in ACTIVE or order["version"] != request.version:
            raise PaperError("Order changed while editing. Review its latest state and try again")
        if order["orderType"] != "limit":
            raise PaperError("Only working limit orders can be amended")
        remaining = request.quantity - order["filledQuantity"]
        if remaining <= 0:
            raise PaperError("Total quantity must exceed the quantity already filled", 422)
        price = max(money(request.limitPrice), money(quotes[order["symbol"]].price))
        reason = self._risk(order["symbol"], remaining, price, quotes, exclude=order_id)
        if reason:
            raise PaperError(reason, 422)
        order.update(quantity=request.quantity, limitPrice=request.limitPrice, riskPrice=float(price),
                     version=order["version"] + 1, updatedAt=int(time.time() * 1000))
        self.revision += 1

    def match(self, quotes, now=None):
        clock = time.monotonic() if now is None else now
        if self.paused or clock - self.last_match < 0.75:
            return False
        self.last_match = clock
        before = self.revision
        for order in self.orders.values():
            if order["status"] not in ACTIVE:
                continue
            q = quotes[order["symbol"]]
            price = money(q.ask if order["side"] == "buy" else q.bid)
            limit = money(order["limitPrice"] if order["orderType"] == "limit" else order["collar"])
            eligible = price <= limit if order["side"] == "buy" else price >= limit
            if eligible:
                self._fill(order, min(25, order["quantity"] - order["filledQuantity"]), price)
            if order["status"] in ACTIVE and (order["timeInForce"] == "IOC" or (order["orderType"] == "market" and not eligible)):
                order.update(status="canceled", reason="IOC remainder" if order["timeInForce"] == "IOC" else "Market price moved outside the 1% collar",
                             version=order["version"] + 1, updatedAt=int(time.time() * 1000))
                self.revision += 1
        return self.revision != before

    def _fill(self, order, quantity, price):
        signed = quantity if order["side"] == "buy" else -quantity
        position = self.holdings.setdefault(order["symbol"], {"quantity": 0, "averageCost": Decimal(0)})
        old, cost = position["quantity"], position["averageCost"]
        if old == 0 or old * signed > 0:
            cost = (abs(old) * cost + quantity * price) / abs(old + signed)
        else:
            closing = min(abs(old), quantity)
            self.realized += closing * (price - cost) * (1 if old > 0 else -1)
            if quantity > abs(old):
                cost = price
        position.update(quantity=old + signed, averageCost=cost if old + signed else Decimal(0))
        fee = money(Decimal(quantity) * Decimal("0.005"))
        self.cash -= signed * price + fee
        self.fees += fee
        filled = order["filledQuantity"]
        average = (Decimal(str(order["averageFillPrice"])) * filled + price * quantity) / (filled + quantity)
        stamp = int(time.time() * 1000)
        order.update(filledQuantity=filled + quantity, averageFillPrice=float(average),
                     status="filled" if filled + quantity == order["quantity"] else "partially_filled",
                     version=order["version"] + 1, updatedAt=stamp)
        self.executions.insert(0, {"id": uuid.uuid4().hex, "orderId": order["id"], "symbol": order["symbol"],
                                   "side": order["side"], "quantity": quantity, "price": float(price),
                                   "fee": float(fee), "timestamp": stamp})
        self.executions = self.executions[:500]
        self.revision += 1

    def snapshot(self):
        return deepcopy({"epoch": self.epoch, "revision": self.revision, "initialCash": float(INITIAL_CASH),
                "cash": float(money(self.cash)), "realizedPnl": float(money(self.realized)), "fees": float(self.fees),
                "paused": self.paused, "orders": list(reversed(list(self.orders.values()))),
                "executions": self.executions,
                "positions": [{"symbol": s, "quantity": p["quantity"], "averageCost": float(p["averageCost"])}
                              for s, p in self.holdings.items() if p["quantity"]]})
