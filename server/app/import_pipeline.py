"""Validated, atomic offline imports with injectable provider clients."""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
from collections import Counter
from decimal import Decimal
from pathlib import Path
from typing import Iterable

from app.providers.base import ImportRequest, Provider
from app.event_store import read_fixture
from app.replay_models import (Manifest, canonical_json, checksum,
                               serialize_events, validate_events)


class CostLimitError(ValueError):
    pass


def summarize(manifest, events, data):
    return dict(fixture_id=manifest.fixture_id, mode=manifest.mode,
                start_ns=events[0].timestamp_ns, end_ns=events[-1].timestamp_ns,
                event_count=len(events), counts_by_type=dict(Counter(e.type for e in events)),
                counts_by_symbol=dict(Counter(e.symbol for e in events)),
                invalid_records=0, dropped_records=0, crossed_books=0,
                sequence_gaps=sum(b.sequence - a.sequence - 1 for a, b in zip(events, events[1:])),
                output_bytes=len(data), events_sha256=checksum(data))


def write_fixture(output: Path, manifest: Manifest, events, *, overwrite=False):
    """Publish a complete directory; rollback a failed replacement.

    A sibling lock serializes writers. Existing fixtures are renamed as a unit
    before replacement, so a reader may see an absent path but never mixed files.
    A process crash may leave a .previous directory for manual recovery.
    """
    validate_events(manifest, events)
    data = serialize_events(events)
    if checksum(data) != manifest.events_sha256:
        raise ValueError('events_sha256 does not match canonical output')
    output = output.absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    lock = output.with_name(f'.{output.name}.import-lock')
    backup = output.with_name(f'.{output.name}.previous')
    lock.mkdir()  # Exclusive; a concurrent import must not overwrite this one.
    stage = None
    moved = False
    try:
        if output.exists() and not overwrite:
            raise FileExistsError(f'{output} already exists; pass --overwrite explicitly')
        if backup.exists():
            raise FileExistsError(f'{backup} needs recovery before another overwrite')
        stage = Path(tempfile.mkdtemp(prefix=f'.{output.name}.stage-', dir=output.parent))
        report = summarize(manifest, events, data)
        for name, content in [('events.ndjson', data), ('manifest.json', canonical_json(manifest)),
                              ('summary.json', (json.dumps(report, indent=2) + '\n').encode())]:
            with (stage / name).open('wb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
        if output.exists():
            output.rename(backup)
            moved = True
        try:
            stage.rename(output)
        except BaseException:
            if moved:
                backup.rename(output)
                moved = False
            raise
        if moved:
            shutil.rmtree(backup)
        return report
    finally:
        if stage and stage.exists():
            shutil.rmtree(stage)
        lock.rmdir()


def normalize(provider: Provider, request: ImportRequest, records: Iterable[object],
              output: Path, *, license_note: str, redistribution='unknown', overwrite=False,
              imported_at_ns=None, source_sha256=None):
    if output.exists() and not overwrite:
        raise FileExistsError(f'{output} already exists; pass --overwrite explicitly')
    # No record is silently dropped. Any malformed input aborts before publication.
    events = tuple(provider.normalize(records, request))
    data = serialize_events(events)
    digest = checksum(data)
    manifest = Manifest(fixture_id=f'{request.provider}-{digest[:24]}', mode=provider.mode,
                        provider=request.provider, dataset=request.dataset, schema=request.schema,
                        symbols=request.symbols, venue=provider.venue, timezone='UTC',
                        start_ns=request.start_ns, end_ns=request.end_ns,
                        source_format=provider.source_format, events_sha256=digest,
                        source_sha256=source_sha256, license_note=license_note, redistribution=redistribution,
                        imported_at_ns=imported_at_ns or time.time_ns(), provenance=provider.provenance)
    return write_fixture(output, manifest, events, overwrite=overwrite)


def fetch(provider: Provider, request: ImportRequest, output: Path, *, max_cost_usd=Decimal('0'),
          on_estimate=None, **kwargs):
    if not max_cost_usd.is_finite() or max_cost_usd < 0:
        raise ValueError('max cost must be finite and nonnegative')
    if output.exists() and not kwargs.get('overwrite', False):
        raise FileExistsError(f'{output} already exists; pass --overwrite explicitly')
    estimate = provider.estimate(request)
    if on_estimate:
        on_estimate(estimate.to_dict())
    if estimate.cost_usd > max_cost_usd:
        raise CostLimitError(f'estimated ${estimate.cost_usd} exceeds --max-cost-usd {max_cost_usd}; '
                             'set an explicit approved ceiling to fetch')
    return normalize(provider, request, provider.fetch(request), output, **kwargs)
