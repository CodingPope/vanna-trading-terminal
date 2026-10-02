"""Import-only XNAS.ITCH MBP-10 adapter; no SDK import until a network command."""
from __future__ import annotations

import json
import os
import tempfile
from decimal import Decimal
from pathlib import Path

from app.providers.base import Estimate
from app.replay_models import DepthSnapshotEvent, Level, Provenance, QuoteEvent, TradeEvent

UNDEF_PRICE = 2**63 - 1


class ProviderError(ValueError):
    pass


def integer(value, field):
    # Raw DBN JSON uses integer strings for uint64/int64. Never round floats.
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ProviderError(f'{field}: expected an integer or integer string')
    try:
        return int(value)
    except ValueError:
        raise ProviderError(f'{field}: expected an integer') from None


class DatabentoProvider:
    mode = 'recorded'
    venue = 'XNAS'
    source_format = 'databento-dbn-json-raw'
    provenance = Provenance(trades='recorded', quotes='recorded', depth='recorded', status='recorded',
                            transformations=(
                                'DBN integers retained as nanoseconds/nanoprices; raw symbols resolved by SDK metadata.',
                                'Every MBP-10 record emits its full depth and top quote; action T also emits a trade first.',
                                'Absent depth sentinels removed; fixture-global sequence assigned in input order.',
                                'No trading status inferred from MBP-10; absent trade side stays unknown.',
                            ))

    def __init__(self, client=None):
        self._injected_client = client

    def _client(self):
        if self._injected_client is not None:
            return self._injected_client
        key = os.environ.get('DATABENTO_API_KEY')
        if not key:
            raise ProviderError('DATABENTO_API_KEY is missing; configure it in your local environment')
        try:
            import databento
        except ImportError:
            raise ProviderError('Install server/requirements-import.txt in a Python 3.12 import environment') from None
        try:
            self._injected_client = databento.Historical(key)
        except Exception:
            raise ProviderError('Could not initialize Databento; check the configured credential') from None
        return self._injected_client

    def _request(self, request):
        if request.provider != 'databento' or request.dataset != 'XNAS.ITCH' or request.schema != 'mbp-10':
            raise ProviderError('Supported provider/dataset/schema: databento / XNAS.ITCH / mbp-10')
        if any(symbol not in ('AAPL', 'NVDA', 'QQQ') for symbol in request.symbols):
            raise ProviderError('Supported symbols: AAPL, NVDA, QQQ')
        return dict(dataset=request.dataset, schema=request.schema, symbols=list(request.symbols),
                    start=request.start_ns, end=request.end_ns, stype_in='raw_symbol')

    def _call(self, operation, **kwargs):
        try:
            return operation(**kwargs)
        except Exception as exc:
            # Vendor exception text may contain URLs or authorization information.
            status = getattr(exc, 'status_code', None)
            if status is None:
                status = getattr(getattr(exc, 'response', None), 'status_code', None)
            if status in (401, 403):
                raise ProviderError('Databento access denied; check credentials and XNAS.ITCH entitlements') from None
            if status in (400, 422):
                raise ProviderError('Databento rejected the request; check schema, symbols, and session availability') from None
            raise ProviderError('Databento request failed; check service availability and account access') from None

    def estimate(self, request):
        args = self._request(request)
        client = self._client()
        schemas = self._call(client.metadata.list_schemas, dataset=request.dataset)
        if request.schema not in schemas:
            raise ProviderError('mbp-10 is unavailable for this dataset/account')
        return Estimate(Decimal(str(self._call(client.metadata.get_cost, **args))),
                        self._call(client.metadata.get_record_count, **args),
                        self._call(client.metadata.get_billable_size, **args))

    def fetch(self, request):
        args = self._request(request)
        store = self._call(self._client().timeseries.get_range, **args)
        with tempfile.TemporaryDirectory(prefix='vanna-databento-') as directory:
            source = Path(directory) / 'source.jsonl'
            self._call(store.to_json, path=source, pretty_px=False, pretty_ts=False, map_symbols=True)
            with source.open() as stream:
                for line in stream:
                    try:
                        yield json.loads(line)
                    except ValueError:
                        raise ProviderError('Databento returned malformed JSON') from None

    def normalize(self, records, request):
        self._request(request)
        sequence = 0
        last_timestamp = 0
        for index, record in enumerate(records, 1):
            try:
                header = record['hd']
                if integer(header['rtype'], 'hd.rtype') != 10:
                    raise ProviderError('expected MBP-10 record type 10')
                symbol = record['symbol']
                if symbol not in request.symbols:
                    raise ProviderError('symbol is unresolved or absent from request')
                timestamp = integer(header['ts_event'], 'hd.ts_event')
                if not request.start_ns <= timestamp < request.end_ns:
                    raise ProviderError('hd.ts_event is outside requested bounds')
                if timestamp < last_timestamp:
                    raise ProviderError('hd.ts_event reversed; source order will not be silently changed')
                last_timestamp = timestamp
                levels = record['levels']
                if len(levels) != 10:
                    raise ProviderError('MBP-10 requires exactly ten provider level slots')
                bids, asks = [], []
                for side, output in [('bid', bids), ('ask', asks)]:
                    absent = False
                    for row in levels:
                        price = integer(row[f'{side}_px'], f'{side}_px')
                        size = integer(row[f'{side}_sz'], f'{side}_sz')
                        if price == UNDEF_PRICE and size == 0:
                            absent = True
                            continue
                        if absent:
                            raise ProviderError(f'{side}: present level after absent sentinel')
                        if size <= 0:
                            raise ProviderError(f'{side}_sz: populated level must have positive size')
                        output.append(Level(price_nanos=price, size=size))
                action = record['action']
                if action not in ('A', 'C', 'M', 'R', 'T', 'F', 'N'):
                    raise ProviderError('unsupported MBP-10 action')
                base = dict(symbol=symbol, timestamp_ns=timestamp, origin='recorded')
                if action == 'T':
                    side = record['side']
                    if side not in ('A', 'B', 'N'):
                        raise ProviderError('unsupported trade side')
                    sequence += 1
                    yield TradeEvent(**base, sequence=sequence,
                                     price_nanos=integer(record['price'], 'price'),
                                     size=integer(record['size'], 'size'),
                                     aggressor={'A': 'sell', 'B': 'buy', 'N': 'unknown'}[side])
                sequence += 1
                yield DepthSnapshotEvent(**base, sequence=sequence, bids=bids, asks=asks)
                sequence += 1
                yield QuoteEvent(**base, sequence=sequence, bid=bids[0] if bids else None,
                                 ask=asks[0] if asks else None)
            except (KeyError, TypeError, ValueError) as exc:
                # Field errors contain source data, never client credential objects.
                raise ProviderError(f'provider record {index}: {exc}') from None
