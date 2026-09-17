import unittest
from fastapi.testclient import TestClient
from app import main


class ApiTests(unittest.TestCase):
    def setUp(self):
        main.accounts.clear()
        self.client = TestClient(main.app)
        self.headers = {'X-Paper-Session': 'session-aaaaaaaaaaaa'}

    def test_http_account_isolation_retry_cancel_and_reset(self):
        self.assertEqual(self.client.get('/api/paper').status_code, 422)
        request = {'clientOrderId': 'order-aaaa', 'symbol': 'AAPL', 'side': 'buy',
                   'quantity': 10, 'orderType': 'limit', 'limitPrice': 1, 'timeInForce': 'GTC'}
        first = self.client.post('/api/paper/orders', headers=self.headers, json=request)
        self.assertEqual(first.status_code, 200)
        again = self.client.post('/api/paper/orders', headers=self.headers, json=request).json()
        self.assertEqual(len(again['orders']), 1)
        other = self.client.get('/api/paper', headers={'X-Paper-Session': 'session-bbbbbbbbbbbb'}).json()
        self.assertEqual(other['orders'], [])
        item = again['orders'][0]
        canceled = self.client.delete('/api/paper/orders/' + item['id'], headers=self.headers).json()
        self.assertEqual(canceled['orders'][0]['status'], 'canceled')
        reset = self.client.post('/api/paper/control', headers=self.headers, json={'action': 'reset'}).json()
        self.assertEqual(reset['orders'], [])
        self.assertGreater(reset['revision'], canceled['revision'])

    def test_two_connections_share_sequences_and_reconnect_recovers_account(self):
        with TestClient(main.app) as client:
            with client.websocket_connect('/ws?session=session-aaaaaaaaaaaa') as a:
                with client.websocket_connect('/ws?session=session-bbbbbbbbbbbb') as b:
                    def next_delta(ws):
                        for _ in range(1000):
                            message = ws.receive_json()
                            if message['type'] == 'order_book_delta' and message['symbol'] == 'AAPL':
                                return message['sequence']
                        self.fail('No AAPL delta')
                    seq_a, seq_b = next_delta(a), next_delta(b)
                    self.assertLessEqual(abs(seq_a - seq_b), 2)
                    for _ in range(3):
                        next_a, next_b = next_delta(a), next_delta(b)
                        self.assertEqual(next_a, seq_a + 1)
                        self.assertEqual(next_b, seq_b + 1)
                        seq_a, seq_b = next_a, next_b
            with client.websocket_connect('/ws?session=session-aaaaaaaaaaaa') as ws:
                for _ in range(100):
                    msg = ws.receive_json()
                    if msg['type'] == 'account_snapshot':
                        self.assertEqual(msg['data']['orders'], [])
                        break
                else:
                    self.fail('No authoritative account on reconnect')

    def test_foreign_browser_origin_is_rejected(self):
        from starlette.websockets import WebSocketDisconnect
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect('/ws', headers={'origin': 'https://foreign.example'}):
                pass

if __name__ == '__main__':
    unittest.main()
