import asyncio
import unittest
from pathlib import Path
from app.replay import ReplayEngine, TICKS_PER_BAR
from app import main


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.engine = ReplayEngine(fixture_path=Path('/does-not-exist'), seed=7)

    def test_snapshot_is_read_only_including_rng(self):
        old = main.engine
        main.engine = self.engine
        try:
            before = (self.engine.states['AAPL'].bar_index, self.engine.states['AAPL'].tick_index, self.engine.rng.getstate())
            first = asyncio.run(main.snapshot('AAPL'))
            second = asyncio.run(main.snapshot('AAPL'))
            self.assertEqual(first, second)
            self.assertEqual(before, (self.engine.states['AAPL'].bar_index, self.engine.states['AAPL'].tick_index, self.engine.rng.getstate()))
        finally:
            main.engine = old

    def test_history_is_sorted_and_contains_no_future_bars(self):
        candles = self.engine.candlesticks('AAPL')
        self.assertTrue(all(a.time < b.time for a, b in zip(candles, candles[1:])))
        self.assertEqual(candles[-1].open, candles[-1].close)
        self.assertLessEqual(candles[-1].time, self.engine.event_time('AAPL'))

    def test_candle_rollover_retains_extremes_and_completed_volume(self):
        for _ in range(TICKS_PER_BAR - 1):
            self.engine.advance('AAPL')
        completed = self.engine.current_candle('AAPL')
        self.assertGreater(completed.volume, 0)
        self.engine.advance('AAPL')
        candles = self.engine.candlesticks('AAPL')
        self.assertEqual(candles[-2], completed)
        self.assertGreater(candles[-1].time, completed.time)

    def test_book_quotes_and_totals_agree_across_many_deltas(self):
        for _ in range(150):
            self.engine.advance('AAPL')
            self.engine.next_book_delta('AAPL')
            q = self.engine.market_data('AAPL')
            book = self.engine.order_book('AAPL')
            bids = sorted((x for x in book if x.side == 'bid'), key=lambda x: -x.price)
            asks = sorted((x for x in book if x.side == 'ask'), key=lambda x: x.price)
            self.assertEqual(q.bid, bids[0].price)
            self.assertEqual(q.ask, asks[0].price)
            self.assertLess(q.bid, q.ask)
            for side in (bids, asks):
                total = 0
                for level in side:
                    total += level.size
                    self.assertEqual(level.total, total)

    def test_session_wrap_preserves_monotonic_event_time(self):
        state = self.engine.states['AAPL']
        state.bar_index = len(state.bars) - 1
        state.tick_index = len(state.path) - 1
        before = self.engine.event_time('AAPL')
        self.engine.advance('AAPL')
        self.assertGreater(self.engine.event_time('AAPL'), before)

if __name__ == '__main__':
    unittest.main()
