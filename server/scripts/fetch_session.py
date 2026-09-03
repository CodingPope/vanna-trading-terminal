#!/usr/bin/env python3
"""
Build a replay fixture from real recorded market data.

Run once; commit the result. The server then replays a real session instead of
synthesising prices, which is what makes AAPL trade near AAPL's price without
taking on a live market data dependency.

    python scripts/fetch_session.py --source stooq --days 1

Why a committed fixture rather than a live API call at runtime:

  * It works at 3am on a Sunday. A demo whose quality depends on when someone
    opens it is a demo you do not control.
  * It is deterministic, so a walkthrough is reproducible.
  * We keep ownership of the stream, which is the only reason chaos injection
    is possible — you cannot force a disconnect on someone else's feed.
  * No API key, no rate limit, no third-party outage in the demo path.

Stooq is the default because it serves plain CSV over HTTPS with no key. It
offers daily and intraday bars for US equities and ETFs. Anything that yields
OHLCV bars works; only `_to_bars` needs to know the shape.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, List

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "session.json"

SYMBOLS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "NFLX", "AMD", "CRM",
    "UBER", "COIN", "PLTR", "ARKK", "SPY", "QQQ", "IWM", "GLD", "TLT",
]

# Stooq wants a market suffix on US tickers.
STOOQ_URL = "https://stooq.com/q/d/l/?s={symbol}.us&i={interval}"


def _fetch_csv(url: str) -> List[dict]:
    req = urllib.request.Request(url, headers={"User-Agent": "vanna-fixture/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    if not body.strip() or body.lower().startswith("<!doctype"):
        raise ValueError("empty or non-CSV response")
    return list(csv.DictReader(io.StringIO(body)))


def _to_bars(rows: List[dict], limit: int) -> List[dict]:
    """Normalise provider rows into the fixture's bar shape."""
    bars: List[dict] = []
    for row in rows[-limit:]:
        try:
            date = row.get("Date") or row.get("date") or ""
            time = row.get("Time") or row.get("time") or "00:00:00"
            stamp = f"{date} {time}"
            # Epoch ms without pulling in a date library.
            import datetime as _dt
            fmt = "%Y-%m-%d %H:%M:%S" if ":" in time else "%Y-%m-%d %H:%M"
            dt = _dt.datetime.strptime(stamp.strip(), fmt).replace(tzinfo=_dt.timezone.utc)
            bars.append({
                "t": int(dt.timestamp() * 1000),
                "o": float(row["Open"]),
                "h": float(row["High"]),
                "l": float(row["Low"]),
                "c": float(row["Close"]),
                "v": float(row.get("Volume") or 0),
            })
        except (KeyError, ValueError):
            continue
    return bars


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--interval", default="d",
                    help="stooq interval: d=daily, 5=5min, 60=hourly (default: d)")
    ap.add_argument("--bars", type=int, default=390,
                    help="bars to keep per symbol (default: 390, a US session in minutes)")
    ap.add_argument("--out", type=Path, default=FIXTURE)
    args = ap.parse_args()

    bars: Dict[str, List[dict]] = {}
    failed: List[str] = []

    for symbol in SYMBOLS:
        url = STOOQ_URL.format(symbol=symbol.lower(), interval=args.interval)
        try:
            rows = _fetch_csv(url)
            parsed = _to_bars(rows, args.bars)
            if len(parsed) < 10:
                raise ValueError(f"only {len(parsed)} usable bars")
            bars[symbol] = parsed
            print(f"  {symbol:6} {len(parsed):4} bars  last close {parsed[-1]['c']}")
        except (urllib.error.URLError, ValueError, TimeoutError) as exc:
            failed.append(symbol)
            print(f"  {symbol:6} FAILED: {exc}", file=sys.stderr)

    if not bars:
        print("\nNo data fetched. The server falls back to seeded synthesis, so it "
              "still runs — but prices will be invented.", file=sys.stderr)
        return 1

    last_date = max(
        (b[-1]["t"] for b in bars.values()), default=0
    )
    import datetime as _dt
    session_date = _dt.datetime.utcfromtimestamp(last_date / 1000).strftime("%Y-%m-%d")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        "sessionDate": session_date,
        "source": "stooq",
        "interval": args.interval,
        "symbols": sorted(bars),
        "bars": bars,
    }))

    print(f"\nWrote {args.out} — {len(bars)} symbols, session {session_date}")
    if failed:
        print(f"Missing: {', '.join(failed)} (these fall back to synthesis)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
