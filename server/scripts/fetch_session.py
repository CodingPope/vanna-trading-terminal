#!/usr/bin/env python3
"""Estimate, fetch, normalize, validate, or summarize normalized event fixtures.

Run from server/: .venv/bin/python scripts/fetch_session.py --help
No data download occurs for estimate, normalize, validate, or summarize.
Historical downloads require an explicit cost ceiling and your provider license.
"""
from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import import_pipeline
from app.providers.base import ImportRequest


def provider_for(name):
    if name == 'databento':
        from app.providers.databento import DatabentoProvider
        return DatabentoProvider()
    raise ValueError(f'unsupported provider: {name}')


def parser():
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest='command', required=True)
    for name in ['estimate', 'fetch', 'normalize']:
        command = commands.add_parser(name)
        command.add_argument('--provider', required=True)
        command.add_argument('--dataset', required=True)
        command.add_argument('--schema', required=True)
        command.add_argument('--symbols', required=True, help='comma-separated raw symbols')
        command.add_argument('--start', type=int, required=True, help='UTC epoch nanoseconds, inclusive')
        command.add_argument('--end', type=int, required=True, help='UTC epoch nanoseconds, exclusive for provider retrieval')
        if name != 'estimate':
            command.add_argument('--output', type=Path, required=True)
            command.add_argument('--overwrite', action='store_true')
            command.add_argument('--license-note', required=True)
            command.add_argument('--redistribution', choices=['unknown', 'private', 'approved'], default='unknown')
        if name == 'fetch':
            command.add_argument('--max-cost-usd', type=Decimal, default=Decimal('0'))
        if name == 'normalize':
            command.add_argument('--input', type=Path, required=True, help='provider-shaped JSON lines')
    for name in ['validate', 'summarize']:
        command = commands.add_parser(name)
        command.add_argument('--input', type=Path, required=True, help='fixture directory or parent of fixtures')
    return root


def main(argv=None, provider_factory=provider_for):
    args = parser().parse_args(argv)
    try:
        if args.command in ('validate', 'summarize'):
            paths = [args.input] if (args.input / 'manifest.json').exists() else sorted(
                p.parent for p in args.input.glob('*/manifest.json'))
            if not paths:
                raise ValueError(f'no manifests found in {args.input}')
            reports = [import_pipeline.summarize(*import_pipeline.read_fixture(path)) for path in paths]
            print(json.dumps(reports, indent=2))
            return 0
        provider = provider_factory(args.provider)
        request = ImportRequest(args.provider, args.dataset, args.schema,
                                tuple(args.symbols.split(',')), args.start, args.end)
        if args.command == 'estimate':
            print(json.dumps(provider.estimate(request).to_dict(), indent=2))
            return 0
        kwargs = dict(license_note=args.license_note, redistribution=args.redistribution, overwrite=args.overwrite)
        if args.command == 'fetch':
            result = import_pipeline.fetch(provider, request, args.output, max_cost_usd=args.max_cost_usd,
                                           on_estimate=lambda x: print(json.dumps({'estimate': x}), flush=True), **kwargs)
        else:
            data = args.input.read_bytes()
            records = [json.loads(line) for line in data.splitlines()]
            result = import_pipeline.normalize(provider, request, records, args.output,
                                                source_sha256=import_pipeline.checksum(data), **kwargs)
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, OSError, ImportError, InvalidOperation) as exc:
        print(f'Import failed: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
