"""Seek is one transaction: bounded, repeatable, and never observable half-done."""
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main
from app.models import ReplayCommand
from app.paper import OrderRequest
from app.session import Checkpoints, EventMarket, ReplaySession, SessionRegistry
from tests.test_session_isolation import START_NS, limit_order, recorded_store


def at(second):
    return START_NS + second * 1_000_000_000


def seek(session, timestamp_ns, command_id='cmd-seek001'):
    return session.apply(ReplayCommand(commandId=command_id, action='seek', timestampNs=timestamp_ns))


class CountingSteps:
    """Counts folded events so a cost bound can be asserted instead of timed."""

    def __init__(self):
        self.count = 0
        self.original = EventMarket.step

    def __enter__(self):
        def counted(market):
            self.count += 1
            return self.original(market)
        self.patch = patch.object(EventMarket, 'step', counted)
        self.patch.start()
        return self

    def __exit__(self, *exc):
        self.patch.stop()


class SeekDeterminismTests(unittest.TestCase):
    def setUp(self):
        self.store = recorded_store(16)
        self.session = ReplaySession(self.store)

    def test_every_path_to_an_instant_produces_the_same_logical_state(self):
        played = ReplaySession(self.store)
        played.advance(6.0)
        expected = played.digest()

        forward = ReplaySession(self.store)
        seek(forward, at(6))
        self.assertEqual(forward.digest(), expected)

        backward = ReplaySession(self.store)
        backward.advance(12.0)
        seek(backward, at(6))
        self.assertEqual(backward.digest(), expected)

        repeated = seek(self.session, at(6), 'cmd-seek00a') and self.session.digest()
        seek(self.session, at(6), 'cmd-seek00b')
        self.assertEqual(self.session.digest(), repeated)
        self.assertEqual(self.session.digest(), expected)

    def test_an_instant_between_events_holds_the_state_of_the_last_one(self):
        between = at(6) + 500_000_000
        seek(self.session, between)
        self.assertEqual(self.session.time_ns, between)
        on_event = ReplaySession(self.store)
        seek(on_event, at(6))
        self.assertEqual(self.session.market.cursor, on_event.market.cursor)
        self.assertEqual(self.session.market.tapes['AAPL'], on_event.market.tapes['AAPL'])

    def test_the_exact_bounds_are_reachable_and_anything_outside_is_refused(self):
        for index, target in enumerate((self.session.start_ns, self.session.end_ns)):
            ack, _ = seek(self.session, target, f'cmd-bound{index:03d}')
            self.assertTrue(ack.accepted, ack.message)
            self.assertEqual(self.session.time_ns, target)
        ack, _ = seek(self.session, self.session.end_ns + 1, 'cmd-bound999')
        self.assertFalse(ack.accepted)
        self.assertEqual(ack.code, 'out_of_bounds')
        self.assertEqual(self.session.time_ns, self.session.end_ns)

    def test_seek_discards_orders_positions_and_cash(self):
        self.session.account.submit(limit_order(), self.session.quotes())
        self.session.account.match(self.session.quotes(), now=0.0)
        self.assertTrue(self.session.account.orders)
        epoch = self.session.account.epoch
        seek(self.session, at(3))
        self.assertEqual(self.session.account.orders, {})
        self.assertEqual(self.session.account.snapshot()['positions'], [])
        self.assertEqual(self.session.account.snapshot()['cash'], 100000.0)
        self.assertNotEqual(self.session.account.epoch, epoch)

    def test_seek_keeps_speed_and_play_state_but_bumps_the_generation(self):
        self.session.speed = 2.0
        self.session.playing = False
        generation, units = self.session.generation, self.session.units
        seek(self.session, at(4))
        self.assertEqual(self.session.speed, 2.0)
        self.assertFalse(self.session.playing)
        self.assertEqual(self.session.generation, generation + 1)
        self.assertEqual(self.session.units, 0)
        self.assertNotEqual(self.session.units, units + 1)
        seek(self.session, self.session.end_ns, 'cmd-seekend1')
        self.assertFalse(self.session.playing)  # Landing on the end stops playback.


class SeekCostTests(unittest.TestCase):
    def test_seek_cost_is_bounded_by_the_checkpoint_stride_not_the_fixture(self):
        store = recorded_store(600)
        stride = 64
        session = ReplaySession(store, checkpoints=Checkpoints(store, stride=stride, limit=10_000))
        session.checkpoints.build()
        with CountingSteps() as counted:
            seek(session, store.events[-1].timestamp_ns)
        self.assertLessEqual(counted.count, stride)
        self.assertEqual(session.market.cursor, len(store.events))

        unindexed = ReplaySession(store, checkpoints=Checkpoints(store, stride=len(store.events) * 2))
        unindexed.checkpoints.build()
        with CountingSteps() as whole_fixture:
            seek(unindexed, store.events[-1].timestamp_ns)
        self.assertGreater(whole_fixture.count, stride * 4)
        self.assertEqual(unindexed.digest(), session.digest())

    def test_a_short_hop_forward_resumes_from_where_it_already_is(self):
        store = recorded_store(600)
        session = ReplaySession(store, checkpoints=Checkpoints(store, stride=64, limit=10_000))
        session.checkpoints.build()
        seek(session, at(500), 'cmd-hop00001')
        with CountingSteps() as counted:
            seek(session, at(502), 'cmd-hop00002')
        self.assertLessEqual(counted.count, 2)

    def test_the_checkpoint_index_is_built_once_and_shared_by_every_session(self):
        store = recorded_store(600)
        registry = SessionRegistry(store, max_sessions=4, idle_seconds=10)
        first, second = registry.get('first'), registry.get('second')
        self.assertIs(first.checkpoints, second.checkpoints)
        self.assertIs(first.checkpoints, registry.checkpoints)
        with CountingSteps() as counted:
            seek(first, at(300), 'cmd-shared01')
            built = counted.count
            seek(second, at(300), 'cmd-shared02')
        self.assertLess(counted.count - built, built)  # The index cost is paid once.
        self.assertEqual(first.digest(), second.digest())


class SeekAtomicityTests(unittest.TestCase):
    def setUp(self):
        self.store = recorded_store(16)
        self.session = ReplaySession(self.store)
        self.session.advance(2.0)

    def test_no_client_can_observe_half_rebuilt_state(self):
        before = (self.session.digest(), self.session.time_ns, self.session.generation)
        observed = []
        original = EventMarket.step

        def observe(market):
            observed.append((self.session.digest(), self.session.time_ns, self.session.generation))
            return original(market)

        with patch.object(EventMarket, 'step', observe):
            seek(self.session, at(10))
        self.assertTrue(observed)
        self.assertEqual(set(observed), {before})  # Every intermediate read is the old state.
        self.assertNotEqual(self.session.digest(), before[0])

    def test_a_failed_rebuild_leaves_the_session_exactly_as_it_was(self):
        before = (self.session.digest(), self.session.time_ns, self.session.generation)
        with patch.object(ReplaySession, '_market_at', side_effect=RuntimeError('fixture read failed')):
            with self.assertRaises(RuntimeError):
                self.session.seek(at(10))
        self.assertEqual((self.session.digest(), self.session.time_ns, self.session.generation), before)
        self.assertFalse(self.session.rebuilding)
        self.assertTrue(seek(self.session, at(10), 'cmd-after001')[0].accepted)

    def test_execution_cannot_race_a_rebuild(self):
        main.registry.sessions.clear()
        key = 'session-seek-racing'
        with patch.object(main.registry, 'store', self.store), \
                patch.object(main.registry, 'checkpoints', Checkpoints(self.store)):
            session = main.registry.get(key)
            refused, original = [], EventMarket.step

            def submit_midway(market):
                if not refused:
                    try:
                        main.mutate(key, lambda account: account.submit(limit_order(), session.quotes()))
                    except HTTPException as exc:
                        refused.append(exc.status_code)
                return original(market)

            with patch.object(EventMarket, 'step', submit_midway):
                seek(session, at(10))
            self.assertEqual(refused, [409])
            self.assertEqual(session.account.orders, {})
        main.registry.sessions.clear()


class SeekTransportTests(unittest.TestCase):
    def setUp(self):
        self.store = recorded_store(16)
        self.session = 'session-seek-socket'
        main.registry.sessions.clear()

    def tearDown(self):
        main.registry.sessions.clear()

    def test_one_authoritative_snapshot_reaches_each_client_after_a_rebuild(self):
        with patch.object(main, 'fixture_store', self.store), \
                patch.object(main.registry, 'store', self.store), \
                patch.object(main.registry, 'checkpoints', Checkpoints(self.store)), \
                TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={self.session}') as ws:
                ws.send_json({'type': 'replay', 'data': {'commandId': 'cmd-seeksock', 'action': 'seek',
                                                         'timestampNs': str(at(5))}})
                snapshots, ack = [], None
                for _ in range(600):
                    message = ws.receive_json()
                    if message['type'] == 'snapshot':
                        snapshots.append(message)
                    if message['type'] == 'replay_ack':
                        ack = message
                        break
                self.assertIsNotNone(ack)
                self.assertTrue(ack['data']['accepted'], ack)
                self.assertEqual(len(snapshots), 1)
                status = snapshots[0]['data']['replay']
                # The snapshot is the rebuilt state, not the state it replaced.
                self.assertEqual(status['eventTimeNs'], str(at(5)))
                self.assertEqual(status['generation'], ack['data']['status']['generation'])
                self.assertEqual(snapshots[0]['data']['positions'], [])
                self.assertIn('AAPL', snapshots[0]['data']['orderBooks'])


if __name__ == '__main__':
    unittest.main()
