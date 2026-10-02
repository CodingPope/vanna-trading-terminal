"""Capture real server frames for the cross-language contract test.

Two model layers in two languages drift silently. This writes exactly what the
running FastAPI app emits into the fixture the client's Zod schemas are tested
against, so regenerating it is a command rather than a careful copy-paste.

    server/.venv/bin/python server/scripts/capture_samples.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'server'))

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402

OUTPUT = ROOT / 'src' / 'schemas' / '__tests__' / 'server-samples.json'
SESSION = 'session-capture-samples'
WANTED = {'order_book_snapshot', 'candle_snapshot', 'market_data', 'trade',
          'order_book_delta', 'candle', 'account_snapshot', 'pong',
          'replay_status', 'replay_ack', 'snapshot'}
CONTROLS = [{'commandId': 'capture-speed', 'action': 'speed', 'speed': 2.0},
            {'commandId': 'capture-step', 'action': 'step'},
            {'commandId': 'capture-reset', 'action': 'reset'},
            {'commandId': 'capture-pause', 'action': 'pause'}]


def capture():
    main.registry.sessions.clear()
    with TestClient(main.app) as client:
        snapshot = client.get('/api/snapshot?symbols=AAPL,NVDA',
                              headers={'X-Paper-Session': SESSION}).json()
        with client.websocket_connect(f'/ws?session={SESSION}') as ws:
            for control in CONTROLS:
                ws.send_json({'type': 'replay', 'data': control})
            ws.send_json({'type': 'ping', 'data': None})
            seen = {}
            for _ in range(4000):
                message = ws.receive_json()
                seen.setdefault(message['type'], message)
                if WANTED <= set(seen):
                    break
            else:
                raise SystemExit(f'Missing frame types: {sorted(WANTED - set(seen))}')
    # One frame per type, in a stable order, so a diff shows a contract change.
    return {'messages': [seen[name] for name in sorted(WANTED)], 'snapshot': snapshot}


if __name__ == '__main__':
    OUTPUT.write_text(json.dumps(capture(), indent=2, sort_keys=True) + '\n')
    print(f'wrote {OUTPUT.relative_to(ROOT)}')
