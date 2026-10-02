"""Frame stamps: what the server can honestly say about its own sends."""
import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import main


class FrameStampTests(unittest.TestCase):
    def setUp(self):
        main.registry.sessions.clear()
        self.session = 'session-telemetry-aa'

    def tearDown(self):
        main.registry.sessions.clear()

    def frames(self, count=12, telemetry=True):
        with patch.object(main, 'TELEMETRY', telemetry), TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={self.session}') as ws:
                return [ws.receive_json() for _ in range(count)]

    def test_every_frame_carries_a_gapless_sequence_and_a_send_time(self):
        frames = self.frames()
        stamps = [frame['t'] for frame in frames]
        self.assertEqual([s['seq'] for s in stamps], list(range(1, len(frames) + 1)))
        times = [int(s['emittedNs']) for s in stamps]
        self.assertEqual(times, sorted(times))  # A monotonic clock never goes back.
        self.assertTrue(all(s['emittedNs'].isdigit() for s in stamps))

    def test_the_stamp_is_a_string_because_a_json_number_would_round_it(self):
        stamp = self.frames(1)[0]['t']
        self.assertIsInstance(stamp['emittedNs'], str)
        self.assertIsInstance(stamp['seq'], int)

    def test_two_sockets_count_their_own_frames(self):
        with TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={self.session}') as first:
                for _ in range(5):
                    first.receive_json()
                with client.websocket_connect(f'/ws?session={self.session}') as second:
                    self.assertEqual(second.receive_json()['t']['seq'], 1)
                    self.assertGreater(first.receive_json()['t']['seq'], 1)

    def test_measurement_can_be_switched_off_so_its_cost_can_be_measured(self):
        for frame in self.frames(6, telemetry=False):
            self.assertNotIn('t', frame)

    def test_stamping_never_mutates_a_frame_shared_with_another_client(self):
        published = {'type': 'error', 'data': {'message': 'shared'}}
        with TestClient(main.app) as client:
            with client.websocket_connect(f'/ws?session={self.session}') as first, \
                    client.websocket_connect(f'/ws?session={self.session}') as second:
                main.hub.publish(self.session, published)
                found = []
                for ws in (first, second):
                    for _ in range(400):
                        message = ws.receive_json()
                        if message['type'] == 'error':
                            found.append(message)
                            break
                self.assertEqual(len(found), 2)
                # Each socket stamped its own copy, from its own frame count.
                self.assertTrue(all('t' in frame for frame in found))
                self.assertEqual({frame['data']['message'] for frame in found}, {'shared'})
                # The payload the hub handed out is untouched and reusable.
                self.assertNotIn('t', published)
                self.assertEqual(published, {'type': 'error', 'data': {'message': 'shared'}})
                self.assertEqual(json.loads(json.dumps(published)), published)


if __name__ == '__main__':
    unittest.main()
