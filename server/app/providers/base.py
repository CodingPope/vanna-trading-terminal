"""Provider boundary used only by offline import commands."""
from dataclasses import dataclass
from decimal import Decimal
from typing import Iterable, Protocol, Tuple

from app.replay_models import MarketEvent, Provenance


@dataclass(frozen=True)
class ImportRequest:
    provider: str
    dataset: str
    schema: str
    symbols: Tuple[str, ...]
    start_ns: int
    end_ns: int

    def __post_init__(self):
        if not self.provider or not self.dataset or not self.schema or not self.symbols:
            raise ValueError('provider, dataset, schema and symbols are required')
        if len(set(self.symbols)) != len(self.symbols):
            raise ValueError('symbols must be unique')
        if not 0 < self.start_ns < self.end_ns:
            raise ValueError('start must precede end (UTC epoch nanoseconds)')


@dataclass(frozen=True)
class Estimate:
    cost_usd: Decimal
    records: int
    bytes_estimate: int

    def __post_init__(self):
        if not self.cost_usd.is_finite() or self.cost_usd < 0 or self.records < 0 or self.bytes_estimate < 0:
            raise ValueError('invalid provider estimate')

    def to_dict(self):
        return dict(cost_usd=str(self.cost_usd), records=self.records, bytes_estimate=self.bytes_estimate)


class Provider(Protocol):
    mode: str
    venue: str
    source_format: str
    provenance: Provenance

    def estimate(self, request: ImportRequest) -> Estimate: ...
    def fetch(self, request: ImportRequest) -> Iterable[object]: ...
    def normalize(self, records: Iterable[object], request: ImportRequest) -> Iterable[MarketEvent]: ...
