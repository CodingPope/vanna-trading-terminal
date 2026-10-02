import unittest
from pathlib import Path

from pydantic import ValidationError

from app.replay_models import (EVENT_ADAPTER, DepthSnapshotEvent, FixtureValidationError,
                               Manifest, canonical_json, checksum, parse_events,
                               serialize_events, validate_events)

EXAMPLES = Path(__file__).resolve().parents[1] / 'fixtures' / 'examples'


def event(**changes):
    return EVENT_ADAPTER.validate_python(dict(type='trade', sequence=1, timestamp_ns=100,
                                             symbol='AAPL', origin='simulated',
                                             price_nanos=100_000_000_000, size=10, **changes))


def manifest(events, **changes):
    values = dict(fixture_id='test', mode='synthetic', provider='vanna', dataset='test',
                  schema='normalized', symbols=['AAPL'], venue='SIMULATED', timezone='UTC',
                  start_ns=100, end_ns=200, source_format='generated',
                  events_sha256=checksum(serialize_events(events)), license_note='Authored test data',
                  redistribution='approved', imported_at_ns=200,
                  provenance=dict(trades='simulated', quotes='simulated', depth='simulated', status='simulated'))
    values.update(changes)
    return Manifest.model_validate(values)


class ReplayModelTests(unittest.TestCase):
    def test_all_event_types_round_trip_canonically(self):
        data = (EXAMPLES / 'valid' / 'events.ndjson').read_bytes()
        meta = Manifest.model_validate_json((EXAMPLES / 'valid' / 'manifest.json').read_bytes())
        events = validate_events(meta, parse_events(data))
        self.assertEqual({e.type for e in events}, {'trade', 'quote', 'depth_snapshot', 'depth_update', 'trading_status'})
        self.assertEqual(data, serialize_events(events))
        self.assertEqual(meta.events_sha256, checksum(data))
        self.assertEqual(meta, Manifest.model_validate_json(canonical_json(meta)))

    def test_invalid_example_has_line_and_field(self):
        with self.assertRaisesRegex(FixtureValidationError, 'events.ndjson:1:.*', ):
            parse_events((EXAMPLES / 'invalid.ndjson').read_bytes())

    def test_field_errors_reject_bad_values_and_unknown_fields(self):
        raw = event().model_dump()
        for field, value in [('size', -1), ('size', 0), ('size', True), ('size', '10'),
                             ('price_nanos', 0), ('price_nanos', float('nan')),
                             ('timestamp_ns', 0), ('sequence', 0), ('schema_version', 2),
                             ('symbol', ''), ('vendor_extra', 'leak')]:
            with self.subTest(field=field, value=value), self.assertRaises(ValidationError) as caught:
                EVENT_ADAPTER.validate_python({**raw, field: value})
            self.assertIn(field, str(caught.exception))

    def test_depth_rejects_unordered_duplicate_crossed_and_zero_levels(self):
        raw = dict(type='depth_snapshot', sequence=1, timestamp_ns=100, symbol='AAPL', origin='simulated')
        for bids, asks in [([(100, 1), (101, 1)], [(102, 1)]),
                           ([(100, 1), (100, 2)], [(102, 1)]),
                           ([(102, 1)], [(102, 1)]), ([(100, 0)], [(102, 1)]),
                           ([(100, 1)], [(103, 1), (102, 1)])]:
            with self.subTest(bids=bids, asks=asks), self.assertRaises(ValidationError):
                DepthSnapshotEvent(**raw, bids=[dict(price_nanos=p, size=s) for p, s in bids],
                                   asks=[dict(price_nanos=p, size=s) for p, s in asks])

    def test_stream_rejects_order_and_symbol_errors(self):
        first = event()
        for changes, message in [({'sequence': 1}, 'sequence'),
                                 ({'timestamp_ns': 99}, 'timestamp_ns'),
                                 ({'timestamp_ns': 201}, 'timestamp_ns'),
                                 ({'symbol': 'MSFT'}, 'symbol'), ({'origin': 'recorded'}, 'origin')]:
            second = EVENT_ADAPTER.validate_python({**first.model_dump(), 'sequence': 2, **changes})
            with self.subTest(changes=changes), self.assertRaisesRegex(FixtureValidationError, message):
                validate_events(manifest([first]), [first, second])
        later = EVENT_ADAPTER.validate_python({**first.model_dump(), 'timestamp_ns': 110})
        earlier = EVENT_ADAPTER.validate_python({**first.model_dump(), 'sequence': 2, 'timestamp_ns': 105})
        with self.assertRaisesRegex(FixtureValidationError, 'nondecreasing'):
            validate_events(manifest([later, earlier]), [later, earlier])
        with self.assertRaisesRegex(FixtureValidationError, 'no events for MSFT'):
            validate_events(manifest([first], symbols=['AAPL', 'MSFT']), [first])

    def test_equal_timestamps_preserve_sequence_order(self):
        first = event()
        second = EVENT_ADAPTER.validate_python({**first.model_dump(), 'sequence': 2})
        self.assertEqual(validate_events(manifest([first, second]), [first, second]), (first, second))

    def test_updates_require_snapshot_and_validate_result_atomically(self):
        base = dict(sequence=1, timestamp_ns=100, symbol='AAPL', origin='simulated')
        snapshot = DepthSnapshotEvent(**base, bids=[dict(price_nanos=100, size=10)],
                                      asks=[dict(price_nanos=101, size=10)])
        def update(changes):
            return EVENT_ADAPTER.validate_python({**base, 'sequence': 2, 'type': 'depth_update', 'changes': changes})
        crossed = update([dict(side='bid', price_nanos=102, size=10)])
        with self.assertRaisesRegex(FixtureValidationError, 'earlier snapshot'):
            validate_events(manifest([crossed]), [crossed])
        with self.assertRaisesRegex(FixtureValidationError, 'crossed'):
            validate_events(manifest([snapshot, crossed]), [snapshot, crossed])
        # Applying the full transaction removes the old ask before checking crossing.
        atomic = update([dict(side='bid', price_nanos=102, size=10),
                         dict(side='ask', price_nanos=101, size=0),
                         dict(side='ask', price_nanos=103, size=10)])
        self.assertEqual(len(validate_events(manifest([snapshot, atomic]), [snapshot, atomic])), 2)

    def test_manifests_support_all_modes_without_provider_event_fields(self):
        sample = event()
        for mode in ['synthetic', 'replay', 'recorded']:
            raw = manifest([sample]).model_dump()
            raw['mode'] = mode
            if mode == 'recorded':
                raw['provenance'].update(dict(trades='recorded', quotes='recorded', depth='recorded', status='recorded'))
            self.assertEqual(Manifest.model_validate(raw).mode, mode)
        for changes in [dict(schema_version=2), dict(normalization_version=2),
                        dict(symbols=['AAPL', 'AAPL']), dict(timezone='not/a/zone'),
                        dict(end_ns=99), dict(events_sha256='invalid'), dict(mode='recorded')]:
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                manifest([sample], **changes)

    def test_models_and_nested_collections_are_immutable(self):
        events = parse_events((EXAMPLES / 'valid' / 'events.ndjson').read_bytes())
        with self.assertRaises(ValidationError):
            events[0].sequence = 10
        book = next(e for e in events if e.type == 'depth_snapshot')
        self.assertIsInstance(book.bids, tuple)
        with self.assertRaises(ValidationError):
            book.bids[0].size = 99
