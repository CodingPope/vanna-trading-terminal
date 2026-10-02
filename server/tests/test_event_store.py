import json
import shutil
import tempfile
import unittest
from unittest.mock import patch
from dataclasses import FrozenInstanceError
from pathlib import Path

from app.event_store import EventStore, SourceConfig, discover_fixtures
from app.replay_models import EVENT_ADAPTER, checksum
from tests.test_replay_models import EXAMPLES, manifest


class EventStoreTests(unittest.TestCase):
    def setUp(self):
        self.path = EXAMPLES / 'valid'
        self.store = EventStore.load(self.path)

    def test_two_readers_share_immutable_source(self):
        left, right = self.store.range(), self.store.range()
        self.assertIs(left[0], right[0])
        with self.assertRaises(FrozenInstanceError):
            self.store.events = ()
        with self.assertRaises(TypeError):
            self.store._symbols['AAPL'] = ()
        with self.assertRaises(ValueError):
            left[1].bids[0].size = 9
        self.assertEqual(self.store.events[1].bids[0].size, 100)

    def test_lookup_boundaries_equal_times_empty_and_filters(self):
        timestamp = self.store.events[0].timestamp_ns
        self.assertEqual(self.store.index_at(timestamp), 0)
        self.assertEqual(self.store.index_at(timestamp, after=True), 5)
        self.assertEqual(self.store.range(start_ns=timestamp, end_ns=timestamp), ())
        self.assertEqual(len(self.store.range(start_ns=timestamp, end_ns=timestamp+1)), 5)
        self.assertEqual(self.store.range(start_ns=timestamp+1), ())
        self.assertEqual(self.store.range(end_ns=timestamp-1), ())
        self.assertEqual(self.store.range(symbol='MSFT'), ())
        self.assertEqual(self.store.range(event_type='missing'), ())
        self.assertEqual(len(self.store.range(symbol='AAPL', event_type='trade')), 1)
        self.assertEqual(self.store.by_sequence(4).type, 'trade')
        self.assertIsNone(self.store.by_sequence(0))
        self.assertIsNone(self.store.by_sequence(6))

    def test_interleaved_indices_and_sequence_gaps(self):
        events = tuple(EVENT_ADAPTER.validate_python(dict(type='trade', sequence=i*2+1,
                           timestamp_ns=100+i, symbol=['AAPL','NVDA'][i%2], origin='simulated',
                           price_nanos=100, size=10)) for i in range(10))
        store = EventStore(manifest(events, symbols=['AAPL','NVDA']), events)
        self.assertEqual([e.timestamp_ns for e in store.range(start_ns=102, end_ns=107, symbol='NVDA')], [103,105])
        self.assertIsNone(store.by_sequence(2))
        self.assertEqual(store.by_sequence(3).symbol, 'NVDA')

    def test_loading_is_stable_and_identity_includes_checksum(self):
        again = EventStore.load(self.path)
        self.assertEqual(again.events, self.store.events)
        self.assertEqual(again.metadata, self.store.metadata)
        self.assertIn(self.store.manifest.events_sha256, self.store.identity)
        self.assertEqual(self.store.metadata.event_count, 5)

    def test_api_exposes_validated_identity_without_claiming_active_playback(self):
        from fastapi.testclient import TestClient
        from app import main
        with patch.object(main, 'fixture_store', self.store), TestClient(main.app) as client:
            response = client.get('/api/fixtures')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['fixtures'], [self.store.metadata.model_dump()])
            self.assertEqual(client.get('/api/health').json()['mode'], 'synthetic')
        with patch.object(main, 'fixture_store', None), TestClient(main.app) as client:
            self.assertEqual(client.get('/api/fixtures').json(), {'fixtures': []})

    def test_missing_unknown_version_damaged_and_mismatched_fixture_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'fixture'
            shutil.copytree(self.path, target)
            data = json.loads((target/'manifest.json').read_text())
            data['schema_version'] = 9
            (target/'manifest.json').write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'schema_version'):
                EventStore.load(target)
            shutil.copy(self.path/'manifest.json', target/'manifest.json')
            (target/'events.ndjson').write_text('corrupt')
            with self.assertRaisesRegex(ValueError, 'sha256'):
                EventStore.load(target)
            with self.assertRaisesRegex(ValueError, 'Invalid fixture'):
                EventStore.load(target/'missing')
            with self.assertRaisesRegex(ValueError, 'sha256'):
                SourceConfig('synthetic', target, True).load()
        with self.assertRaisesRegex(ValueError, 'does not match'):
            SourceConfig('recorded', self.path).load()

    def test_noncanonical_bytes_and_forged_constructor_are_rejected(self):
        altered = self.store.events[0].model_copy(update={'reason': 'changed'})
        with self.assertRaisesRegex(ValueError, 'sha256'):
            EventStore(self.store.manifest, (altered, *self.store.events[1:]))
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'fixture'
            shutil.copytree(self.path, target)
            data = (target/'events.ndjson').read_bytes().replace(b':', b': ')
            meta = json.loads((target/'manifest.json').read_text())
            meta['events_sha256'] = checksum(data)
            (target/'manifest.json').write_text(json.dumps(meta))
            (target/'events.ndjson').write_bytes(data)
            with self.assertRaisesRegex(ValueError, 'canonical'):
                EventStore.load(target)

    def test_discovery_and_explicit_fallback(self):
        self.assertEqual(discover_fixtures(self.path), (self.path,))
        self.assertEqual(discover_fixtures(EXAMPLES), (self.path,))
        self.assertIsNone(SourceConfig.from_environment({}).load())
        with self.assertRaisesRegex(ValueError, 'required'):
            SourceConfig.from_environment({'VANNA_DATA_MODE':'recorded'}).load()
        self.assertIsNone(SourceConfig('recorded', Path('/missing-vanna-fixture'), True).load())
        with self.assertRaisesRegex(ValueError, 'must be true or false'):
            SourceConfig.from_environment({'VANNA_ALLOW_MISSING_FIXTURE':'maybe'})
        with self.assertRaisesRegex(ValueError, 'VANNA_DATA_MODE'):
            SourceConfig('surprise').load()
