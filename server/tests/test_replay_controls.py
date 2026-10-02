"""The replay control protocol: typed commands, one ack each, authoritative state."""
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main
from app.models import REPLAY_SPEEDS, ReplayCommand, ReplayStatus
from app.session import UNITS_PER_TURN, ReplaySession
from tests.test_session_isolation import START_NS, recorded_store


def command(command_id, action, **fields):
    return ReplayCommand(commandId=command_id, action=action, **fields)


class ReplayCommandModelTests(unittest.TestCase):
    def test_a_command_must_name_itself_and_a_known_action(self):
        for payload in [dict(action='play'), dict(commandId='cmd-0001'),
                        dict(commandId='cmd-0001', action='fly'),
                        dict(commandId='short', action='play'),
                        dict(commandId='cmd-0001', action='play', speed=True),
                        dict(commandId='cmd-0001', action='play', speed='fast'),
                        dict(commandId='cmd-0001', action='seek', timestampNs='1e9'),
                        dict(commandId='cmd-0001', action='seek', timestampNs=-1),
                        dict(commandId='cmd-0001', action='play', extra=1)]:
            with self.subTest(**payload), self.assertRaises(ValidationError):
                ReplayCommand.model_validate(payload)

    def test_nanoseconds_cross_the_wire_as_exact_decimal_strings(self):
        exact = 1_789_678_816_585_999_872  # 61 bits: a JSON number would round it.
        parsed = command('cmd-0001', 'seek', timestampNs=str(exact))
        self.assertEqual(parsed.timestampNs, exact)
        self.assertEqual(parsed.model_dump()['timestampNs'], str(exact))
        status = ReplaySession(recorded_store()).status()
        self.assertEqual(status.model_dump()['startNs'], str(START_NS))
        self.assertEqual(ReplayStatus.model_validate(status.model_dump()), status)


class ReplayControlTests(unittest.TestCase):
    def setUp(self):
        self.store = recorded_store(12)
        self.session = ReplaySession(self.store)

    def apply(self, command_id, action, **fields):
        return self.session.apply(command(command_id, action, **fields))

    def test_play_and_pause_move_only_the_play_flag(self):
        ack, frames = self.apply('cmd-pause1', 'pause')
        self.assertTrue(ack.accepted)
        self.assertFalse(ack.status.playing)
        self.assertEqual(frames, [])
        self.assertEqual(self.session.advance(5.0), [])
        self.assertEqual(self.session.time_ns, START_NS)
        self.assertTrue(self.apply('cmd-play01', 'play')[0].status.playing)
        self.assertNotEqual(self.session.advance(1.0), [])

    def test_step_advances_exactly_one_replay_unit_and_pauses(self):
        self.apply('cmd-play01', 'play')
        before = (self.session.market.cursor, self.session.time_ns)
        ack, frames = self.apply('cmd-step01', 'step')
        self.assertTrue(ack.accepted)
        self.assertFalse(ack.status.playing)
        self.assertEqual(self.session.market.cursor, before[0] + 1)
        self.assertEqual(self.session.time_ns, before[1] + 1_000_000_000)
        self.assertEqual(ack.status.eventTimeNs, self.session.time_ns)
        self.assertEqual(ack.status.sequence, 1)
        self.assertTrue(any(f['type'] == 'trade' for f in frames))
        self.apply('cmd-step02', 'step')
        self.assertEqual(self.session.market.cursor, before[0] + 2)

    def test_every_documented_speed_is_accepted_and_nothing_else_is(self):
        for index, speed in enumerate(REPLAY_SPEEDS):
            ack, _ = self.apply(f'cmd-speed{index}', 'speed', speed=speed)
            self.assertTrue(ack.accepted, speed)
            self.assertEqual(ack.status.speed, speed)
        for index, speed in enumerate([0.1, 3.0, 100.0, 0.0]):
            ack, _ = self.apply(f'cmd-bad{index:04d}', 'speed', speed=speed)
            self.assertFalse(ack.accepted)
            self.assertEqual(ack.code, 'unsupported_speed')
        self.assertEqual(self.apply('cmd-nospeed', 'speed')[0].code, 'unsupported_speed')

    def test_speed_paces_event_time_and_max_drains_the_turn_budget(self):
        self.apply('cmd-speed05', 'speed', speed=0.5)
        self.session.advance(4.0)
        self.assertEqual(self.session.time_ns, START_NS + 2_000_000_000)
        self.apply('cmd-speed20', 'speed', speed=2.0)
        self.session.advance(2.0)
        self.assertEqual(self.session.time_ns, START_NS + 6_000_000_000)
        drained = ReplaySession(recorded_store(UNITS_PER_TURN + 50))
        drained.apply(command('cmd-maxspd1', 'speed', speed='max'))
        self.assertEqual(len(drained.advance(0.0)) > 0, True)
        self.assertEqual(drained.units, UNITS_PER_TURN)  # A turn is bounded even at max.

    def test_reset_restores_the_documented_initial_state(self):
        self.apply('cmd-speed50', 'speed', speed=5.0)
        self.session.advance(3.0)
        self.session.account.paused = True
        generation = self.session.generation
        ack, frames = self.apply('cmd-reset01', 'reset')
        self.assertTrue(ack.accepted)
        status = ack.status
        self.assertEqual((status.eventTimeNs, status.sequence, status.speed, status.playing),
                         (START_NS, 0, 1.0, True))
        self.assertEqual(status.generation, generation + 1)
        self.assertFalse(self.session.account.paused)
        # A rebuild publishes one coherent snapshot per client, not a frame stream.
        self.assertEqual(frames, [])

    def test_a_retried_command_id_is_answered_but_never_applied_twice(self):
        first, _ = self.apply('cmd-step777', 'step')
        cursor = self.session.market.cursor
        again, frames = self.apply('cmd-step777', 'step')
        self.assertTrue(again.accepted)
        self.assertTrue(again.duplicate)
        self.assertFalse(first.duplicate)
        self.assertEqual(frames, [])
        self.assertEqual(self.session.market.cursor, cursor)
        self.assertEqual(again.status.sequence, first.status.sequence)
        rejected, _ = self.apply('cmd-badspd1', 'speed', speed=9.0)
        repeat, _ = self.apply('cmd-badspd1', 'speed', speed=2.0)
        self.assertEqual((repeat.accepted, repeat.code, repeat.action), (False, rejected.code, 'speed'))
        self.assertEqual(self.session.speed, 1.0)

    def test_playing_past_the_end_is_refused_with_a_recoverable_state(self):
        self.session.advance(60.0)
        self.assertTrue(self.session.ended)
        for index, action in enumerate(('play', 'step')):
            ack, _ = self.apply(f'cmd-end{index:05d}', action)
            self.assertFalse(ack.accepted)
            self.assertEqual(ack.code, 'at_end')
            self.assertTrue(ack.status.ended)
        self.assertTrue(self.apply('cmd-reset02', 'reset')[0].status.playing)


class ReplaySeekTests(unittest.TestCase):
    def setUp(self):
        self.store = recorded_store(12)
        self.session = ReplaySession(self.store)

    def test_seek_rebuilds_state_at_the_requested_instant(self):
        target = START_NS + 5_000_000_000
        ack, frames = self.session.apply(command('cmd-seek001', 'seek', timestampNs=target))
        self.assertTrue(ack.accepted)
        self.assertEqual(ack.status.eventTimeNs, target)
        self.assertEqual(self.session.market.cursor, 6)
        self.assertEqual(frames, [])
        forward = ReplaySession(self.store)
        forward.advance(5.0)
        self.assertEqual(forward.market.tapes['AAPL'], self.session.market.tapes['AAPL'])
        self.assertEqual(forward.snapshot().model_dump()['orderBooks'],
                         self.session.snapshot().model_dump()['orderBooks'])

    def test_seek_bounds_are_rejected_not_silently_clamped(self):
        for target in (START_NS - 1, self.session.end_ns + 1):
            ack, frames = self.session.apply(command(f'cmd-oob{target}', 'seek', timestampNs=max(target, 0)))
            self.assertFalse(ack.accepted)
            self.assertEqual(ack.code, 'out_of_bounds')
            self.assertEqual(frames, [])
        self.assertEqual(self.session.time_ns, START_NS)
        self.assertEqual(self.session.apply(command('cmd-noarg01', 'seek'))[0].code, 'invalid_command')

    def test_a_synthetic_session_reports_and_refuses_seek(self):
        synthetic = ReplaySession(None, anchor_ms=1_700_000_000_000)
        self.assertFalse(synthetic.status().canSeek)
        ack, _ = synthetic.apply(command('cmd-noseek1', 'seek', timestampNs=synthetic.start_ns))
        self.assertFalse(ack.accepted)
        self.assertEqual(ack.code, 'seek_unavailable')


class ReplayTransportTests(unittest.TestCase):
    """The same protocol, over the socket a browser actually uses."""

    def setUp(self):
        main.registry.sessions.clear()
        self.session = 'session-controls-aaa'

    def tearDown(self):
        main.registry.sessions.clear()

    def collect(self, ws, wanted, where=None, limit=600):
        for _ in range(limit):
            message = ws.receive_json()
            if message['type'] == wanted and (where is None or where(message['data'])):
                return message
        self.fail(f'No {wanted} frame')

    def test_commands_are_acknowledged_and_status_reaches_the_whole_session(self):
        with TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={self.session}') as first, \
                    client.websocket_connect(f'/ws?session={self.session}') as second:
                first.send_json({'type': 'replay', 'data': {'commandId': 'cmd-pause01', 'action': 'pause'}})
                ack = self.collect(first, 'replay_ack')
                self.assertEqual(ack['data']['commandId'], 'cmd-pause01')
                self.assertTrue(ack['data']['accepted'])
                self.assertFalse(ack['data']['status']['playing'])
                # A second tab watching the same session learns without asking.
                # Its own connect primed it with the pre-pause state, so this
                # waits for the frame the command actually produced.
                self.assertFalse(self.collect(second, 'replay_status', lambda d: not d['playing'])['data']['playing'])

    def test_a_reconnecting_client_is_told_the_playback_state_immediately(self):
        with TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={self.session}') as ws:
                ws.send_json({'type': 'replay', 'data': {'commandId': 'cmd-pause03', 'action': 'pause'}})
                self.assertFalse(self.collect(ws, 'replay_ack')['data']['status']['playing'])
            with client.websocket_connect(f'/ws?session={self.session}') as ws:
                first = ws.receive_json()
                self.assertEqual(first['type'], 'replay_status')
                # The session it rejoins is the one it left, still paused.
                self.assertFalse(first['data']['playing'])

    def test_an_unreadable_command_is_an_error_frame_not_a_closed_socket(self):
        with TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={self.session}') as ws:
                ws.send_json({'type': 'replay', 'data': {'commandId': 'cmd-junk01', 'action': 'teleport'}})
                error = self.collect(ws, 'error')
                self.assertEqual(error['data']['code'], 'invalid_command')
                self.assertEqual(error['data']['commandId'], 'cmd-junk01')
                ws.send_json({'type': 'replay', 'data': {'commandId': 'cmd-pause02', 'action': 'pause'}})
                self.assertTrue(self.collect(ws, 'replay_ack')['data']['accepted'])

    def test_reaching_the_end_of_a_fixture_is_announced_without_being_asked(self):
        store = recorded_store(4)
        with patch.object(main, 'fixture_store', store), \
                patch.object(main.registry, 'store', store), TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={self.session}') as ws:
                ws.send_json({'type': 'replay', 'data': {'commandId': 'cmd-maxdrain', 'action': 'speed', 'speed': 'max'}})
                self.collect(ws, 'replay_ack')
                for _ in range(600):
                    message = ws.receive_json()
                    if message['type'] == 'replay_status' and message['data']['ended']:
                        self.assertFalse(message['data']['playing'])
                        return
                self.fail('End of session never announced')

    def test_a_running_clock_refreshes_without_a_frame_per_event(self):
        session = ReplaySession(recorded_store(600))
        hub, sent = main.Hub(), []
        with patch.object(hub, 'publish', lambda key, payload: sent.append(payload)):
            hub.publish_status('key', session.status(), now=100.0)
            session.advance(1.0)
            hub.publish_status('key', session.status(), now=100.5)
            self.assertEqual(len(sent), 1)  # Same controls, and the interval has not passed.
            hub.publish_status('key', session.status(), now=101.0)
            self.assertEqual(len(sent), 2)
            self.assertNotEqual(sent[0]['data']['eventTimeNs'], sent[1]['data']['eventTimeNs'])
            session.playing = False
            hub.publish_status('key', session.status(), now=101.1)
            self.assertEqual(len(sent), 3)  # A control change never waits for the interval.
            self.assertFalse(sent[2]['data']['playing'])

    def test_the_rest_snapshot_hydrates_playback_state(self):
        with TestClient(main.app) as client:
            body = client.get('/api/snapshot?symbols=AAPL',
                              headers={'X-Paper-Session': self.session}).json()
            status = ReplayStatus.model_validate(body['replay'])
            self.assertEqual(body['source'], status.mode)
            self.assertEqual(status.protocolVersion, 1)
            self.assertIn(status.speed, REPLAY_SPEEDS)

    def test_a_recorded_session_advertises_seek_over_the_socket(self):
        store = recorded_store(12)
        with patch.object(main, 'fixture_store', store), \
                patch.object(main.registry, 'store', store), TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={self.session}') as ws:
                ws.send_json({'type': 'replay', 'data': {'commandId': 'cmd-seek002', 'action': 'seek',
                                                         'timestampNs': str(START_NS + 3_000_000_000)}})
                ack = self.collect(ws, 'replay_ack')['data']
                self.assertTrue(ack['accepted'], ack)
                self.assertTrue(ack['status']['canSeek'])
                self.assertEqual(ack['status']['eventTimeNs'], str(START_NS + 3_000_000_000))


if __name__ == '__main__':
    unittest.main()
