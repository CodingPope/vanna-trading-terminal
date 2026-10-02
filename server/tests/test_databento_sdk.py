"""Optional SDK compatibility test, entirely offline with authored DBN bytes."""
import datetime
import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from app.import_pipeline import fetch
from app.providers.base import ImportRequest
from app.providers.databento import DatabentoProvider
from app.event_store import EventStore


@unittest.skipUnless(importlib.util.find_spec('databento'), 'optional import SDK is not installed')
class DatabentoSdkTests(unittest.TestCase):
    def test_real_sdk_export_normalizes_without_network(self):
        import databento as db
        import databento_dbn as dbn

        timestamp = 1_700_000_000_000_000_000
        mapping = SimpleNamespace(raw_symbol='AAPL', intervals=[SimpleNamespace(
            start_date=datetime.date(2023, 11, 14), end_date=datetime.date(2023, 11, 15), symbol='42')])
        metadata = dbn.Metadata(dataset='XNAS.ITCH', start=timestamp, end=timestamp+1000,
                                stype_in=dbn.SType.RAW_SYMBOL, stype_out=dbn.SType.INSTRUMENT_ID,
                                schema=dbn.Schema.MBP_10, symbols=['AAPL'], mappings=[mapping])
        levels = [dbn.BidAskPair(bid_px=100_000_000_000, ask_px=100_010_000_000, bid_sz=100, ask_sz=120)]
        levels += [dbn.BidAskPair() for _ in range(9)]
        record = dbn.MBP10Msg(publisher_id=2, instrument_id=42, ts_event=timestamp,
                              price=100_010_000_000, size=25, action=dbn.Action.TRADE,
                              side=dbn.Side.BID, depth=0, ts_recv=timestamp+1, levels=levels)
        source = db.DBNStore.from_bytes(bytes(metadata)+bytes(record))
        client = Mock()
        client.metadata.list_schemas.return_value = ['mbp-10']
        client.metadata.get_cost.return_value = 0
        client.metadata.get_record_count.return_value = 1
        client.metadata.get_billable_size.return_value = len(bytes(record))
        client.timeseries.get_range.return_value = source
        request = ImportRequest('databento', 'XNAS.ITCH', 'mbp-10', ('AAPL',), timestamp, timestamp+1000)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)/'fixture'
            fetch(DatabentoProvider(client), request, output, license_note='Authored SDK test, no vendor data')
            store = EventStore.load(output)
            self.assertEqual([e.type for e in store.events], ['trade', 'depth_snapshot', 'quote'])
            self.assertEqual(store.events[0].aggressor, 'buy')
            self.assertEqual(store.events[0].timestamp_ns, timestamp)
            self.assertEqual(store.events[1].bids[0].price_nanos, 100_000_000_000)
            self.assertEqual(len(store.events[1].bids), 1)
            self.assertTrue(all(e.symbol == 'AAPL' for e in store.events))
