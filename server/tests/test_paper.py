import unittest
from decimal import Decimal
from types import SimpleNamespace
from pydantic import ValidationError
from app.paper import PaperAccount, OrderRequest, AmendRequest, PaperError


def quote(price=100):
    return {"AAPL": SimpleNamespace(price=price, bid=price, ask=price)}


def order(key="request-1", **kwargs):
    return OrderRequest(clientOrderId=key, symbol="AAPL", side="buy", quantity=100, limitPrice=101, **kwargs)


class PaperTests(unittest.TestCase):
    def test_retry_is_idempotent_and_payload_cannot_change(self):
        account = PaperAccount()
        account.submit(order(), quote())
        account.submit(order(), quote())
        self.assertEqual(len(account.orders), 1)
        with self.assertRaises(PaperError):
            account.submit(order().model_copy(update={"quantity": 101}), quote())

    def test_partial_fill_cancel_and_no_late_execution(self):
        account = PaperAccount()
        account.submit(order(), quote())
        account.match(quote(), now=1)
        item = next(iter(account.orders.values()))
        self.assertEqual((item['status'], item['filledQuantity']), ('partially_filled', 25))
        account.cancel(item['id'])
        account.match(quote(), now=2)
        self.assertEqual(account.holdings['AAPL']['quantity'], 25)
        self.assertEqual(item['status'], 'canceled')

    def test_average_cost_realized_fees_and_cash_reconcile(self):
        account = PaperAccount()
        account.submit(order().model_copy(update={"quantity": 25}), quote())
        account.match(quote(), now=1)
        account.submit(order("request-2").model_copy(update={"side": "sell", "quantity": 50, "limitPrice": 109}), quote(110))
        account.match(quote(110), now=2)
        self.assertEqual(account.realized, Decimal('250'))
        account.match(quote(110), now=3)
        self.assertEqual(account.holdings['AAPL']['quantity'], -25)
        self.assertEqual(account.holdings['AAPL']['averageCost'], Decimal('110'))
        self.assertEqual(account.cash + Decimal('-2750'), Decimal('100250') - account.fees)

    def test_ioc_attempt_cancels_remainder(self):
        account = PaperAccount()
        account.submit(order(timeInForce='IOC'), quote())
        account.match(quote(), now=1)
        item = next(iter(account.orders.values()))
        self.assertEqual((item['status'], item['filledQuantity']), ('canceled', 25))

    def test_nonmarketable_ioc_has_no_fill(self):
        account = PaperAccount()
        account.submit(order(timeInForce='IOC').model_copy(update={'limitPrice': 90}), quote())
        account.match(quote(), now=1)
        self.assertEqual(len(account.executions), 0)
        self.assertEqual(next(iter(account.orders.values()))['status'], 'canceled')

    def test_market_collar_prevents_runaway_fill(self):
        account = PaperAccount()
        account.submit(order().model_copy(update={'orderType': 'market', 'limitPrice': None}), quote())
        account.match(quote(110), now=1)
        self.assertEqual(len(account.executions), 0)
        self.assertEqual(next(iter(account.orders.values()))['status'], 'canceled')

    def test_amend_version_detects_a_fill_race(self):
        account = PaperAccount()
        account.submit(order(), quote())
        item = next(iter(account.orders.values()))
        version = item['version']
        account.match(quote(), now=1)
        with self.assertRaises(PaperError):
            account.amend(item['id'], AmendRequest(version=version, quantity=50, limitPrice=100), quote())
        account.amend(item['id'], AmendRequest(version=item['version'], quantity=50, limitPrice=100), quote())
        self.assertEqual(item['quantity'], 50)

    def test_tick_and_integral_share_validation(self):
        for change in ({'limitPrice': 100.001}, {'quantity': 1.5}, {'limitPrice': float('nan')}):
            with self.assertRaises(ValidationError):
                OrderRequest(**{**order().model_dump(), **change})

    def test_notional_rejection_is_visible_and_idempotent(self):
        account = PaperAccount()
        request = order().model_copy(update={'quantity': 1000})
        account.submit(request, quote())
        account.submit(request, quote())
        self.assertEqual(len(account.orders), 1)
        self.assertEqual(next(iter(account.orders.values()))['status'], 'rejected')

    def test_pending_orders_reserve_gross_exposure(self):
        account = PaperAccount()
        for i in range(6):
            account.submit(order(f'request-{i}').model_copy(update={'quantity': 500, 'limitPrice': 99}), quote())
        self.assertEqual(sum(o['status'] == 'working' for o in account.orders.values()), 5)
        self.assertEqual(list(account.orders.values())[-1]['status'], 'rejected')

    def test_snapshot_is_immutable_and_sessions_are_isolated(self):
        a, b = PaperAccount(), PaperAccount()
        a.submit(order(), quote())
        before = a.snapshot()
        a.match(quote(), now=1)
        self.assertEqual(before['orders'][0]['filledQuantity'], 0)
        self.assertEqual(b.snapshot()['orders'], [])

    def test_pause_stops_fills_but_allows_cancel(self):
        a = PaperAccount()
        a.submit(order(), quote())
        a.paused = True
        self.assertFalse(a.match(quote(), now=1))
        a.cancel_all()
        self.assertEqual(next(iter(a.orders.values()))['status'], 'canceled')

if __name__ == '__main__':
    unittest.main()
