"""One immutable fixture, many independent playback sessions."""
import unittest
from unittest.mock import patch

from app.event_store import EventStore
from app.paper import OrderRequest
from app.replay_models import EVENT_ADAPTER
from app.session import ReplaySession, SessionCapacityError, SessionRegistry
from tests.test_replay_models import manifest

START_NS = 1_700_000_000_000_000_000


def source_events(count=6):
    book = EVENT_ADAPTER.validate_python(dict(type='depth_snapshot', sequence=1, timestamp_ns=START_NS,
        symbol='AAPL', origin='simulated', bids=[dict(price_nanos=100_000_000_000, size=100)],
        asks=[dict(price_nanos=100_010_000_000, size=150)]))
    prints = tuple(EVENT_ADAPTER.validate_python(dict(type='trade', sequence=i + 1, symbol='AAPL',
        timestamp_ns=START_NS + i * 1_000_000_000, origin='simulated', aggressor='buy',
        price_nanos=100_010_000_000, size=10)) for i in range(1, count))
    return (book,) + prints


def recorded_store(count=6):
    events = source_events(count)
    return EventStore(manifest(events, start_ns=START_NS, end_ns=events[-1].timestamp_ns), events)


def limit_order(client_order_id='order-aaaa'):
    return OrderRequest(clientOrderId=client_order_id, symbol='AAPL', side='buy', quantity=10,
                        orderType='limit', limitPrice=1.0, timeInForce='GTC')


class SessionIsolationTests(unittest.TestCase):
    def setUp(self):
        self.store = recorded_store()
        self.registry = SessionRegistry(self.store, max_sessions=4, idle_seconds=10)

    def test_speed_pause_and_cursor_are_per_session(self):
        slow, fast = self.registry.get('slow'), self.registry.get('fast')
        fast.speed = 2.0
        slow.advance(2.0)
        fast.advance(2.0)
        self.assertEqual(slow.time_ns, START_NS + 2_000_000_000)
        self.assertEqual(fast.time_ns, START_NS + 4_000_000_000)
        paused = self.registry.get('paused')
        paused.playing = False
        self.assertEqual(paused.advance(5.0), [])
        self.assertEqual(paused.time_ns, START_NS)
        self.assertGreater(slow.market.cursor, paused.market.cursor)

    def test_orders_and_reset_never_reach_a_neighbouring_session(self):
        mine, theirs = self.registry.get('mine'), self.registry.get('theirs')
        mine.account.submit(limit_order(), mine.quotes())
        self.assertEqual(len(mine.account.orders), 1)
        self.assertEqual(theirs.account.orders, {})
        self.assertNotEqual(mine.account.epoch, theirs.account.epoch)
        mine.advance(2.0)
        generation, elsewhere = mine.generation, (theirs.time_ns, theirs.market.cursor)
        mine.reset()
        self.assertEqual(mine.generation, generation + 1)
        self.assertEqual(mine.account.orders, {})
        self.assertEqual(mine.time_ns, START_NS)
        self.assertEqual((theirs.time_ns, theirs.market.cursor), elsewhere)

    def test_sessions_read_the_same_source_events_without_mutating_them(self):
        left, right = self.registry.get('left'), self.registry.get('right')
        self.assertIs(left.market.store, right.market.store)
        self.assertIs(left.market.store.events[0], self.store.events[0])
        left.advance(3.0)
        right.advance(1.0)
        self.assertEqual(left.market.store.events, self.store.events)
        self.assertEqual(left.fixture_id, right.fixture_id)
        with self.assertRaises(ValueError):
            self.store.events[0].bids[0].size = 1

    def test_the_clock_follows_event_time_not_wall_clock(self):
        session = self.registry.get('clock')
        session.advance(0.5)
        self.assertEqual(session.time_ns, START_NS)  # No event is due yet; the clock cannot drift ahead.
        session.advance(0.5)
        self.assertEqual(session.time_ns, START_NS + 1_000_000_000)
        self.assertIn(session.time_ns, [e.timestamp_ns for e in self.store.events])
        replayed = ReplaySession(self.store)
        for _ in range(4):
            replayed.advance(1.0)
        self.assertEqual(replayed.time_ns, session.time_ns + 3_000_000_000)

    def test_the_same_script_replays_identically_in_a_fresh_session(self):
        first, second = ReplaySession(self.store), ReplaySession(self.store)
        script = [first.advance(elapsed) for elapsed in (1.0, 2.0, 1.0)]
        self.assertEqual(script, [second.advance(elapsed) for elapsed in (1.0, 2.0, 1.0)])
        # Account identity is a fresh random epoch per session; the state is not.
        self.assertEqual(first.digest(), second.digest())

    def test_the_end_of_the_fixture_stops_only_that_session(self):
        done, running = self.registry.get('done'), self.registry.get('running')
        done.advance(60.0)
        self.assertTrue(done.ended)
        self.assertFalse(done.playing)
        self.assertEqual(done.time_ns, done.end_ns)
        self.assertEqual(done.advance(60.0), [])
        self.assertTrue(running.playing)
        self.assertNotEqual(running.time_ns, running.end_ns)

    def test_capacity_refuses_new_sessions_without_disturbing_existing_ones(self):
        registry = SessionRegistry(self.store, max_sessions=2, idle_seconds=10)
        first, second = registry.get('first'), registry.get('second')
        first.advance(2.0)
        with self.assertRaises(SessionCapacityError):
            registry.get('third')
        self.assertIs(registry.get('first'), first)
        self.assertEqual(first.time_ns, START_NS + 2_000_000_000)
        self.assertIs(registry.get('second'), second)

    def test_idle_cleanup_releases_only_disconnected_expired_sessions(self):
        now = [0.0]
        registry = SessionRegistry(self.store, max_sessions=4, idle_seconds=10, clock=lambda: now[0])
        connected, idle = registry.get('connected'), registry.get('idle')
        connected.connections = 1
        idle.account.submit(limit_order(), idle.quotes())
        now[0] = 11.0
        registry.cleanup()
        self.assertEqual(sorted(registry.sessions), ['connected'])
        self.assertIs(registry.get('connected'), connected)
        self.assertEqual(registry.get('idle').account.orders, {})  # Expired state is released, not resumed.

    def test_limits_are_configurable_and_validated(self):
        for changes in [dict(max_sessions=0), dict(max_sessions=257), dict(idle_seconds=0), dict(idle_seconds=86401)]:
            with self.subTest(**changes), self.assertRaisesRegex(ValueError, 'Session limits'):
                SessionRegistry(self.store, **changes)
        with patch.dict('os.environ', {'VANNA_MAX_SESSIONS': '3', 'VANNA_SESSION_IDLE_SECONDS': '60'}):
            registry = SessionRegistry.from_environment(self.store)
        self.assertEqual((registry.max_sessions, registry.idle_seconds), (3, 60))


if __name__ == '__main__':
    unittest.main()
