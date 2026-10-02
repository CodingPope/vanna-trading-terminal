import contextlib
import io
import json
import os
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app import import_pipeline
from app.providers.base import ImportRequest
from app.providers.databento import DatabentoProvider, ProviderError, UNDEF_PRICE
from scripts.fetch_session import main


def record(symbol='AAPL', timestamp=100, action='A', side='N'):
    levels = [dict(bid_px=100_000_000_000, ask_px=100_010_000_000, bid_sz=100, ask_sz=120)]
    levels += [dict(bid_px=UNDEF_PRICE, ask_px=UNDEF_PRICE, bid_sz=0, ask_sz=0) for _ in range(9)]
    return dict(hd=dict(rtype=10, instrument_id=42, ts_event=str(timestamp)), symbol=symbol,
                action=action, side=side, price='100010000000', size=25, sequence=88, levels=levels)


class DatabentoProviderTests(unittest.TestCase):
    def setUp(self):
        self.request = ImportRequest('databento', 'XNAS.ITCH', 'mbp-10', ('AAPL',), 100, 200)
        self.client = Mock()
        self.client.metadata.list_schemas.return_value = ['mbp-10']
        self.client.metadata.get_cost.return_value = 1.25
        self.client.metadata.get_record_count.return_value = 2
        self.client.metadata.get_billable_size.return_value = 736
        self.provider = DatabentoProvider(self.client)

    def test_estimate_uses_metadata_without_fetch(self):
        result = self.provider.estimate(self.request)
        self.assertEqual(result.cost_usd, Decimal('1.25'))
        self.assertEqual(result.records, 2)
        self.client.timeseries.get_range.assert_not_called()
        self.assertEqual(self.client.metadata.get_cost.call_args.kwargs['symbols'], ['AAPL'])

    def test_fetch_exports_raw_units_and_resolved_symbols(self):
        def export(path, **kwargs):
            self.assertEqual(kwargs, dict(pretty_px=False, pretty_ts=False, map_symbols=True))
            Path(path).write_text(json.dumps(record()) + '\n')
        self.client.timeseries.get_range.return_value.to_json.side_effect = export
        rows = list(self.provider.fetch(self.request))
        self.assertEqual(rows, [record()])
        self.client.timeseries.get_range.assert_called_once_with(dataset='XNAS.ITCH', schema='mbp-10',
                         symbols=['AAPL'], start=100, end=200, stype_in='raw_symbol')

    def test_maps_trades_depth_timestamps_and_unknown_aggressor(self):
        rows = [record(action='T', side=side) for side in ['A', 'B', 'N']]
        events = list(self.provider.normalize(rows, self.request))
        self.assertEqual([e.aggressor for e in events if e.type == 'trade'], ['sell', 'buy', 'unknown'])
        self.assertEqual([e.sequence for e in events], list(range(1, 10)))
        self.assertTrue(all(e.timestamp_ns == 100 for e in events))
        self.assertEqual(events[1].bids[0].price_nanos, 100_000_000_000)
        self.assertEqual(len(events[1].bids), 1)
        self.assertEqual(events[2].ask.size, 120)

    def test_source_order_and_multiple_symbols(self):
        request = ImportRequest('databento', 'XNAS.ITCH', 'mbp-10', ('AAPL', 'NVDA', 'QQQ'), 100, 200)
        rows = [record(symbol=s, timestamp=100+i) for i, s in enumerate(request.symbols)]
        events = list(self.provider.normalize(rows, request))
        self.assertEqual([e.symbol for e in events[::2]], list(request.symbols))
        with self.assertRaisesRegex(ProviderError, 'reversed'):
            list(self.provider.normalize(rows[::-1], request))

    def test_missing_credentials_and_schema_fail_clearly(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(ProviderError, 'DATABENTO_API_KEY'):
            DatabentoProvider().estimate(self.request)
        self.client.metadata.list_schemas.return_value = ['trades']
        with self.assertRaisesRegex(ProviderError, 'unavailable'):
            self.provider.estimate(self.request)
        bad = ImportRequest('databento', 'XNAS.ITCH', 'trades', ('AAPL',), 100, 200)
        with self.assertRaisesRegex(ProviderError, 'Supported'):
            self.provider.estimate(bad)

    def test_entitlement_error_does_not_expose_vendor_message(self):
        error = RuntimeError('SECRET_IN_VENDOR_MESSAGE')
        error.response = SimpleNamespace(status_code=403)
        self.client.metadata.list_schemas.side_effect = error
        with self.assertRaisesRegex(ProviderError, 'entitlements') as caught:
            self.provider.estimate(self.request)
        self.assertNotIn('SECRET', str(caught.exception))

    def test_invalid_rows_fail_without_repair(self):
        rows = []
        wrong = record(); wrong['symbol'] = 'MSFT'; rows.append(wrong)
        wrong = record(); wrong['levels'][0]['bid_px'] = 100_020_000_000; rows.append(wrong)
        wrong = record(); wrong['hd']['ts_event'] = 100.5; rows.append(wrong)
        wrong = record(); wrong['levels'][0]['bid_sz'] = -1; rows.append(wrong)
        wrong = record(); wrong['levels'][1]['bid_px'] = 100; wrong['levels'][1]['bid_sz'] = 1
        wrong['levels'][0]['bid_px'] = UNDEF_PRICE; wrong['levels'][0]['bid_sz'] = 0; rows.append(wrong)
        for row in rows:
            with self.subTest(row=row), self.assertRaises(ProviderError):
                list(self.provider.normalize([row], self.request))

    def test_cost_limit_refuses_download_and_cli_prints_estimate(self):
        with tempfile.TemporaryDirectory() as directory:
            args = ['fetch', '--provider', 'databento', '--dataset', 'XNAS.ITCH', '--schema', 'mbp-10',
                    '--symbols', 'AAPL', '--start', '100', '--end', '200', '--output', directory+'/out',
                    '--license-note', 'Private only']
            output, errors = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                self.assertEqual(main(args, lambda name: self.provider), 1)
            self.assertIn('estimate', output.getvalue())
            self.assertIn('max-cost-usd', errors.getvalue())
            self.client.timeseries.get_range.assert_not_called()

    def test_local_normalization_needs_neither_key_nor_sdk(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            summary = import_pipeline.normalize(DatabentoProvider(), self.request, [record()], Path(directory)/'out',
                                                license_note='Authored mock provider shape', redistribution='private')
            self.assertEqual(summary['event_count'], 2)
