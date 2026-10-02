import contextlib
import io
import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from app import import_pipeline as pipeline
from app.providers.base import Estimate, ImportRequest
from app.replay_models import EVENT_ADAPTER, Provenance
from scripts.fetch_session import main


class FakeProvider:
    mode = 'synthetic'
    venue = 'SIMULATED'
    source_format = 'jsonl'
    provenance = Provenance(trades='simulated', quotes='simulated', depth='simulated', status='simulated')

    def __init__(self, cost='0'):
        self.cost = Decimal(cost)
        self.fetches = 0
        self.records = [dict(type='trade', sequence=1, timestamp_ns=100, symbol='AAPL',
                             origin='simulated', price_nanos=100_000_000_000, size=10)]

    def estimate(self, request):
        return Estimate(self.cost, len(self.records), 200)

    def fetch(self, request):
        self.fetches += 1
        return self.records

    def normalize(self, records, request):
        for row in records:
            yield EVENT_ADAPTER.validate_python(row)


class ImportPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name) / 'fixture'
        self.provider = FakeProvider()
        self.request = ImportRequest('fake', 'example', 'test', ('AAPL',), 100, 200)

    def run_fetch(self, **kwargs):
        return pipeline.fetch(self.provider, self.request, self.output, license_note='Authored test', **kwargs)

    def test_full_pipeline_and_summary(self):
        summary = self.run_fetch()
        meta, events, data = pipeline.read_fixture(self.output)
        self.assertEqual(self.provider.fetches, 1)
        self.assertEqual(meta.events_sha256, pipeline.checksum(data))
        self.assertEqual(summary, pipeline.summarize(meta, events, data))
        self.assertEqual(summary['counts_by_type'], {'trade': 1})
        self.assertEqual(summary['counts_by_symbol'], {'AAPL': 1})
        self.assertEqual(summary['invalid_records'], 0)
        self.assertEqual(summary['sequence_gaps'], 0)
        self.assertEqual(json.loads((self.output / 'summary.json').read_text()), summary)

    def test_estimate_and_cost_refusal_never_fetch(self):
        self.provider.cost = Decimal('3.25')
        with self.assertRaisesRegex(pipeline.CostLimitError, 'max-cost-usd'):
            self.run_fetch()
        self.assertEqual(self.provider.fetches, 0)
        self.assertFalse(self.output.exists())
        self.run_fetch(max_cost_usd=Decimal('3.25'))
        self.assertEqual(self.provider.fetches, 1)

    def test_no_overwrite_without_flag_and_explicit_replacement(self):
        self.run_fetch()
        before = (self.output / 'events.ndjson').read_bytes()
        self.provider.records[0]['size'] = 20
        with self.assertRaises(FileExistsError):
            self.run_fetch()
        self.assertEqual(self.provider.fetches, 1)
        self.assertEqual((self.output / 'events.ndjson').read_bytes(), before)
        self.run_fetch(overwrite=True)
        self.assertEqual(pipeline.read_fixture(self.output)[1][0].size, 20)

    def test_validation_failure_publishes_nothing_and_preserves_existing(self):
        self.provider.records[0]['size'] = -1
        with self.assertRaises(ValueError):
            self.run_fetch()
        self.assertFalse(self.output.exists())
        self.provider.records[0]['size'] = 10
        self.run_fetch()
        before = (self.output / 'events.ndjson').read_bytes()
        self.provider.records.append({**self.provider.records[0]})
        with self.assertRaisesRegex(ValueError, 'sequence'):
            self.run_fetch(overwrite=True)
        self.assertEqual((self.output / 'events.ndjson').read_bytes(), before)

    def test_io_failure_rolls_back_old_fixture_and_cleans_staging(self):
        self.run_fetch()
        original = (self.output / 'events.ndjson').read_bytes()
        self.provider.records[0]['size'] = 40
        real_rename = Path.rename
        def fail_publication(path, target):
            if '.stage-' in path.name:
                raise OSError('injected rename failure')
            return real_rename(path, target)
        with patch.object(Path, 'rename', fail_publication), self.assertRaisesRegex(OSError, 'injected'):
            self.run_fetch(overwrite=True)
        self.assertEqual((self.output / 'events.ndjson').read_bytes(), original)
        self.assertEqual(sorted(p.name for p in self.output.parent.iterdir()), ['fixture'])

    def test_checksum_and_sequence_gaps(self):
        self.provider.records.append({**self.provider.records[0], 'sequence': 4})
        self.assertEqual(self.run_fetch()['sequence_gaps'], 2)
        with (self.output / 'events.ndjson').open('ab') as stream:
            stream.write(b'\n')
        with self.assertRaisesRegex(ValueError, 'checksum|sha256'):
            pipeline.read_fixture(self.output)

    def test_cli_commands_with_injected_provider(self):
        common = ['--provider', 'fake', '--dataset', 'example', '--schema', 'test', '--symbols', 'AAPL',
                  '--start', '100', '--end', '200']
        factory = lambda name: self.provider
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(main(['estimate', *common], factory), 0)
            self.assertEqual(self.provider.fetches, 0)
            self.assertEqual(main(['fetch', *common, '--output', str(self.output), '--license-note', 'Authored'], factory), 0)
            self.assertEqual(main(['validate', '--input', str(self.output)]), 0)
            self.assertEqual(main(['summarize', '--input', str(self.output.parent)]), 0)
            source = self.output.parent / 'source.jsonl'
            source.write_text(json.dumps(self.provider.records[0]) + '\n')
            self.assertEqual(main(['normalize', *common, '--output', str(self.output), '--overwrite',
                                   '--input', str(source), '--license-note', 'Authored'], factory), 0)
            self.assertEqual(self.provider.fetches, 1)
        self.assertIsNotNone(pipeline.read_fixture(self.output)[0].source_sha256)

    def test_empty_input_and_concurrent_writer_fail_closed(self):
        self.provider.records = []
        with self.assertRaisesRegex(ValueError, 'no events'):
            self.run_fetch()
        lock = self.output.with_name('.fixture.import-lock')
        lock.mkdir()
        self.provider.records = FakeProvider().records
        with self.assertRaises(FileExistsError):
            self.run_fetch()
        self.assertFalse(self.output.exists())
