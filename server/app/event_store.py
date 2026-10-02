"""Immutable validated fixtures and indexed views shared by replay sessions."""
from __future__ import annotations

import os
from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Mapping, Optional, Tuple

from app.replay_models import (Manifest, MarketEvent, ReplayMetadata, checksum,
                               parse_events, serialize_events, validate_events)


def read_fixture(path: Path):
    """Version dispatch and checksum checks fail closed before exposing any event."""
    try:
        manifest = Manifest.model_validate_json((path / 'manifest.json').read_bytes())
        data = (path / manifest.events_file).read_bytes()
        if checksum(data) != manifest.events_sha256:
            raise ValueError('events_sha256 mismatch; fixture is damaged')
        events = validate_events(manifest, parse_events(data))
        if serialize_events(events) != data:
            raise ValueError('events.ndjson must use canonical serialization')
        return manifest, events, data
    except (ValueError, OSError) as exc:
        raise ValueError(f'Invalid fixture {path}: {exc}') from exc


def discover_fixtures(root: Path) -> Tuple[Path, ...]:
    """Discover explicit manifests; never treat an arbitrary NDJSON file as a fixture."""
    if not root.is_dir():
        raise ValueError(f'Fixture directory does not exist: {root}')
    if (root / 'manifest.json').is_file():
        return (root,)
    return tuple(sorted(p.parent for p in root.glob('*/manifest.json') if p.is_file()
                        and not p.parent.name.startswith('.')))


@dataclass(frozen=True)
class EventStore:
    manifest: Manifest
    events: Tuple[MarketEvent, ...]
    _timestamps: Tuple[int, ...] = field(init=False, repr=False)
    _sequences: Tuple[int, ...] = field(init=False, repr=False)
    _symbols: Mapping[str, Tuple[int, ...]] = field(init=False, repr=False)
    _types: Mapping[str, Tuple[int, ...]] = field(init=False, repr=False)

    def __post_init__(self):
        events = validate_events(self.manifest, self.events)
        if checksum(serialize_events(events)) != self.manifest.events_sha256:
            raise ValueError('events_sha256 mismatch or noncanonical event serialization')
        object.__setattr__(self, 'events', events)
        object.__setattr__(self, '_timestamps', tuple(e.timestamp_ns for e in events))
        object.__setattr__(self, '_sequences', tuple(e.sequence for e in events))
        symbols, types = {}, {}
        for index, event in enumerate(events):
            symbols.setdefault(event.symbol, []).append(index)
            types.setdefault(event.type, []).append(index)
        object.__setattr__(self, '_symbols', MappingProxyType({k: tuple(v) for k, v in symbols.items()}))
        object.__setattr__(self, '_types', MappingProxyType({k: tuple(v) for k, v in types.items()}))

    @classmethod
    def load(cls, path: Path):
        manifest, events, _ = read_fixture(path)
        return cls(manifest, events)

    @property
    def identity(self):
        # A friendly fixture name alone cannot identify altered event bytes.
        return f'{self.manifest.fixture_id}:{self.manifest.events_sha256}'

    @property
    def metadata(self):
        return ReplayMetadata(fixture_id=self.identity, mode=self.manifest.mode,
                              start_ns=self.manifest.start_ns, end_ns=self.manifest.end_ns,
                              event_count=len(self.events), events_sha256=self.manifest.events_sha256)

    def index_at(self, timestamp_ns: int, *, after=False):
        """Lower bound by default; after=True includes all events at the timestamp."""
        return (bisect_right if after else bisect_left)(self._timestamps, timestamp_ns)

    def by_sequence(self, sequence: int):
        index = bisect_left(self._sequences, sequence)
        return self.events[index] if index < len(self.events) and self._sequences[index] == sequence else None

    def range(self, *, start_ns=None, end_ns=None, symbol=None, event_type=None):
        """Return a read-only half-open [start, end) view, preserving source order."""
        low = 0 if start_ns is None else self.index_at(start_ns)
        high = len(self.events) if end_ns is None else self.index_at(end_ns)
        if low >= high:
            return ()
        candidates = []
        if symbol is not None:
            candidates.append(self._symbols.get(symbol, ()))
        if event_type is not None:
            candidates.append(self._types.get(event_type, ()))
        if not candidates:
            return self.events[low:high]
        indices = min(candidates, key=len)
        selected = indices[bisect_left(indices, low):bisect_left(indices, high)]
        return tuple(self.events[i] for i in selected
                     if (symbol is None or self.events[i].symbol == symbol)
                     and (event_type is None or self.events[i].type == event_type))


@dataclass(frozen=True)
class SourceConfig:
    mode: str = 'synthetic'
    fixture: Optional[Path] = None
    allow_missing_fallback: bool = False

    @classmethod
    def from_environment(cls, environ=None):
        env = os.environ if environ is None else environ
        flag = env.get('VANNA_ALLOW_MISSING_FIXTURE', 'false')
        if flag not in ('true', 'false'):
            raise ValueError('VANNA_ALLOW_MISSING_FIXTURE must be true or false')
        return cls(mode=env.get('VANNA_DATA_MODE', 'synthetic'),
                   fixture=Path(env['VANNA_FIXTURE']) if env.get('VANNA_FIXTURE') else None,
                   allow_missing_fallback=flag == 'true')

    def load(self):
        if self.mode not in ('synthetic', 'replay', 'recorded'):
            raise ValueError('VANNA_DATA_MODE must be synthetic, replay, or recorded')
        if self.fixture is None:
            if self.mode == 'synthetic' or self.allow_missing_fallback:
                return None
            raise ValueError('VANNA_FIXTURE is required for replay/recorded mode')
        if not self.fixture.exists() and self.allow_missing_fallback:
            return None
        store = EventStore.load(self.fixture)
        if store.manifest.mode != self.mode:
            raise ValueError('VANNA_DATA_MODE does not match manifest.mode')
        return store
