"""The failure modes that matter for a front-office interface, end to end."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import main
from app.models import ReplayCommand
from app.session import Checkpoints, EventMarket, ReplaySession
from tests.test_session_isolation import START_NS, limit_order, recorded_store

#: A fixed script: controls interleaved with fixed slices of elapsed time.
SCRIPT = [('advance', 2.0), ('speed', 2.0), ('advance', 1.0), ('step', None),
          ('advance', 1.0), ('seek', START_NS + 3_000_000_000), ('advance', 2.0),
          ('pause', None), ('advance', 5.0), ('play', None), ('advance', 1.0)]


def run_script(session, script=SCRIPT):
    """Replay a command script, returning every frame it produced, in order."""
    log = []
    for index, (action, argument) in enumerate(script):
        if action == 'advance':
            log.extend(session.advance(argument))
            continue
        options = {}
        if action == 'speed':
            options['speed'] = argument
        if action == 'seek':
            options['timestampNs'] = argument
        ack, frames = session.apply(ReplayCommand(commandId=f'script-{index:04d}', action=action, **options))
        log.append(dict(ack=ack.model_dump(exclude={'status'}), status=ack.status.model_dump()))
        log.extend(frames)
    return log


class DeterminismTests(unittest.TestCase):
    def test_one_fixture_and_one_script_produce_one_outcome(self):
        store = recorded_store(40)
        first, second = ReplaySession(store), ReplaySession(store)
        self.assertEqual(run_script(first), run_script(second))
        self.assertEqual(first.digest(), second.digest())
        self.assertEqual(first.status().model_dump(), second.status().model_dump())

    def test_the_same_script_over_a_shared_checkpoint_index_agrees_too(self):
        store = recorded_store(600)
        shared = Checkpoints(store)
        alone = ReplaySession(store)
        pooled = ReplaySession(store, checkpoints=shared)
        self.assertEqual(run_script(alone), run_script(pooled))
        self.assertEqual(alone.digest(), pooled.digest())

    def test_a_script_that_ends_the_session_still_ends_the_same_way(self):
        store = recorded_store(8)
        script = SCRIPT + [('advance', 60.0), ('play', None), ('reset', None), ('advance', 1.0)]
        first, second = ReplaySession(store), ReplaySession(store)
        self.assertEqual(run_script(first, script), run_script(second, script))
        self.assertFalse(first.ended)
        self.assertEqual(first.digest(), second.digest())


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.store = recorded_store(600)
        main.registry.sessions.clear()
        self.patches = [patch.object(main, 'fixture_store', self.store),
                        patch.object(main.registry, 'store', self.store),
                        patch.object(main.registry, 'checkpoints', Checkpoints(self.store))]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()
        main.registry.sessions.clear()

    def command(self, ws, action, **fields):
        ws.send_json({'type': 'replay', 'data': {'commandId': f'{action}-{id(ws) % 10 ** 6:06d}',
                                                 'action': action, **fields}})

    def drain(self, ws, wanted, where=None, limit=800):
        for _ in range(limit):
            message = ws.receive_json()
            if message['type'] == wanted and (where is None or where(message['data'])):
                return message
        self.fail(f'No {wanted} frame')

    def test_two_sessions_at_different_speeds_do_not_disturb_each_other(self):
        with TestClient(main.app) as client:
            with client.websocket_connect('/ws?session=session-speed-slowaa') as slow, \
                    client.websocket_connect('/ws?session=session-speed-fastaa') as fast:
                self.command(slow, 'pause')
                self.drain(slow, 'replay_ack')
                self.command(fast, 'speed', speed=5.0)
                self.drain(fast, 'replay_ack')
                held = main.registry.sessions['session-speed-slowaa'].time_ns
                moving = self.drain(fast, 'replay_status', lambda d: int(d['eventTimeNs']) > START_NS)
                self.assertEqual(main.registry.sessions['session-speed-slowaa'].time_ns, held)
                self.assertGreater(int(moving['data']['eventTimeNs']), held)
                self.assertFalse(main.registry.sessions['session-speed-slowaa'].playing)
                self.assertEqual(main.registry.sessions['session-speed-fastaa'].speed, 5.0)

    def test_a_reconnecting_client_is_made_whole_before_its_next_command(self):
        session = 'session-reconnect-aa'
        with TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={session}') as ws:
                self.command(ws, 'seek', timestampNs=str(START_NS + 30_000_000_000))
                self.drain(ws, 'replay_ack')
                self.command(ws, 'pause')
                self.drain(ws, 'replay_ack')
            with client.websocket_connect(f'/ws?session={session}') as ws:
                self.command(ws, 'step')
                seen = []
                for _ in range(800):
                    message = ws.receive_json()
                    seen.append(message['type'])
                    if message['type'] == 'replay_ack':
                        break
                # Authoritative state lands before the command is answered, so a
                # client never acts on a book it has not been re-handed.
                self.assertLess(seen.index('replay_status'), seen.index('replay_ack'))
                self.assertLess(seen.index('order_book_snapshot'), seen.index('replay_ack'))
                self.assertLess(seen.index('account_snapshot'), seen.index('replay_ack'))
                self.assertEqual(seen.count('replay_ack'), 1)

    def test_a_disconnect_during_a_rebuild_leaves_no_partial_state(self):
        session = 'session-rebuild-drop'
        target = START_NS + 40_000_000_000
        with TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={session}') as ws:
                self.command(ws, 'pause')
                self.drain(ws, 'replay_ack')
                state = main.registry.sessions[session]
                state.account.submit(limit_order(), state.quotes())
                original, dropped = EventMarket.step, []

                def drop_midway(market):
                    # What a vanished client looks like from the server's side,
                    # in the middle of folding the replacement market.
                    if not dropped:
                        for conn in list(main.hub.clients):
                            if conn.session == session:
                                main.hub.remove(conn)
                                dropped.append(conn)
                    return original(market)

                with patch.object(EventMarket, 'step', drop_midway):
                    self.command(ws, 'seek', timestampNs=str(target))
                    self.drain(ws, 'replay_ack')
                self.assertTrue(dropped)

            clean = ReplaySession(self.store, checkpoints=main.registry.checkpoints)
            clean.playing = False
            clean.seek(target)
            survivor = main.registry.sessions[session]
            self.assertEqual(survivor.time_ns, target)
            self.assertEqual(survivor.digest(), clean.digest())
            self.assertEqual(survivor.account.orders, {})  # The rebuild completed, orders and all.
            self.assertFalse(survivor.rebuilding)

    def test_the_end_of_a_session_is_announced_and_recoverable(self):
        session = 'session-endstate-aa'
        # A short fixture, so reaching the end is a handful of turns rather than
        # thousands of frames this test would have to read past.
        brief = recorded_store(30)
        with patch.object(main.registry, 'store', brief), \
                patch.object(main.registry, 'checkpoints', Checkpoints(brief)), \
                TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={session}') as ws:
                self.command(ws, 'speed', speed='max')
                self.drain(ws, 'replay_ack')
                ended = self.drain(ws, 'replay_status', lambda d: d['ended'])
                self.assertFalse(ended['data']['playing'])
                self.assertEqual(ended['data']['eventTimeNs'], ended['data']['endNs'])

                ws.send_json({'type': 'replay', 'data': {'commandId': 'end-play-01', 'action': 'play'}})
                refused = self.drain(ws, 'replay_ack', lambda d: d['commandId'] == 'end-play-01')
                self.assertFalse(refused['data']['accepted'])
                self.assertEqual(refused['data']['code'], 'at_end')

                ws.send_json({'type': 'replay', 'data': {'commandId': 'end-reset-1', 'action': 'reset'}})
                recovered = self.drain(ws, 'replay_ack', lambda d: d['commandId'] == 'end-reset-1')
                self.assertTrue(recovered['data']['accepted'])
                self.assertFalse(recovered['data']['status']['ended'])
                self.assertTrue(recovered['data']['status']['playing'])
                self.assertEqual(recovered['data']['status']['eventTimeNs'], recovered['data']['status']['startNs'])


if __name__ == '__main__':
    unittest.main()
