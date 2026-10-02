# Replay control protocol v1

This is the wire contract between the browser and the VANNA replay service for
playback control. It covers the control commands, their acknowledgements, and
the authoritative status the server publishes. Market-data framing, sequence
recovery, and paper-order REST commands are described in
[ARCHITECTURE.md](ARCHITECTURE.md).

The protocol is paper-only and educational. No command in it reaches a broker.

## Versioning

Every `ReplayStatus` carries `protocolVersion`. Version 1 is described here. A
client that does not recognise the version should refuse to render controls
rather than guess at their meaning. Fields may be added within a version;
existing field names and meanings will not change within one.

Server models live in `server/app/models.py`; the client's mirror schemas live
in `src/schemas/index.ts`. `src/schemas/__tests__/contract.test.ts` validates
captured server output against those schemas, so drift fails a build instead of
silently disabling a panel. Regenerate the capture with:

~~~bash
server/.venv/bin/python server/scripts/capture_samples.py
~~~

## Time on the wire

Replay time is a nanosecond epoch. That needs 61 bits, and a JSON number is an
IEEE-754 double with 53 bits of mantissa, so `1789678816585999872` would arrive
in JavaScript rounded to the nearest ~256ns. Every nanosecond field therefore
crosses the wire as a **decimal string** and is an exact integer on both sides:

~~~json
{ "eventTimeNs": "1789678816585999872", "startNs": "1789678816585999872" }
~~~

Clients should use `BigInt` for arithmetic on these values and convert to
`Number` only for display or for a proportional scrubber position, where the
rounding is smaller than a pixel.

Trade, candle, and quote timestamps elsewhere in the feed remain milliseconds,
which is comfortably inside the safe integer range.

## Replay units

One **replay unit** is the smallest amount of playback the server will advance.
`ReplayStatus.unit` names it:

| Mode | `unit` | One unit is |
| --- | --- | --- |
| `recorded`, `replay` | `event` | One normalized source event from the fixture |
| `synthetic` | `tick` | One synthetic tick: every symbol advanced once, one second of event time |

`ReplayStatus.sequence` counts units applied since the current generation began.
It is not an order-book sequence and not a source event sequence.

## Status

`ReplayStatus` is the authoritative playback state. The client renders it; it
never infers it from its own timers. It arrives in the REST snapshot
(`GET /api/snapshot` → `replay`), inside every acknowledgement, and as a
`replay_status` frame:

- immediately on connect, so a reconnecting client never renders controls from
  a guess;
- whenever a control-relevant field changes — including when playback stops on
  its own at the end of a fixture;
- otherwise at most once a second while a session is running, so the clock on
  screen advances without spending a frame per replay unit.

| Field | Meaning |
| --- | --- |
| `protocolVersion` | Version of this contract, currently `1` |
| `fixtureId` | Stable source identity. For a fixture, `fixture_id:sha256` of the event bytes |
| `mode` | `synthetic`, `replay`, or `recorded` — the provenance label the UI must show |
| `unit` | `event` or `tick`; what one step advances |
| `eventTimeNs` | Current replay clock, decimal-string nanoseconds |
| `startNs`, `endNs` | Inclusive session bounds, decimal-string nanoseconds |
| `speed` | Current speed: one of `speeds` |
| `speeds` | Supported speeds: `[0.5, 1.0, 2.0, 5.0, "max"]` |
| `playing` | Whether the clock is advancing |
| `ended` | Whether the cursor has reached the end of the source |
| `sequence` | Replay units applied since this generation began |
| `generation` | Increments on every reset and seek |
| `canSeek` | Whether this source supports seek |
| `canStep` | Whether this source supports step |

`generation` exists so a client can discard frames that were in flight when the
server rebuilt state. Any frame that arrives referring to an older generation's
market state is superseded by the authoritative snapshots that follow a rebuild.

### Speeds

`0.5`, `1.0`, `2.0`, and `5.0` are multiples of recorded event time: at `2.0`,
two seconds of session time pass per second of wall-clock time.

`"max"` is **not** a rate. It means: ignore event-time pacing and drain up to
the server's per-turn budget of replay units. That budget is `UNITS_PER_TURN`
(256) per scheduler turn, and the scheduler turns every 100ms, so `max` is
bounded at roughly 2,560 units per second per session regardless of hardware.
Nothing is dropped at `max`; unplayed events stay queued in the immutable store.

## Commands

A command is a WebSocket text frame:

~~~json
{
  "type": "replay",
  "data": { "commandId": "a1b2c3d4", "action": "speed", "speed": 2.0 }
}
~~~

| Field | Required | Notes |
| --- | --- | --- |
| `commandId` | yes | 8–80 characters of `[A-Za-z0-9_-]`. Unique per command, stable across retries |
| `action` | yes | `play`, `pause`, `speed`, `step`, `seek`, or `reset` |
| `speed` | `speed` only | A number from `speeds`, or `"max"` |
| `timestampNs` | `seek` only | Decimal-string nanoseconds within `[startNs, endNs]` |

Unknown fields are rejected. A boolean `speed` is rejected rather than coerced.

| Action | Effect |
| --- | --- |
| `play` | Resumes the clock. Refused with `at_end` when the cursor is at the end |
| `pause` | Stops the clock. The cursor, book, tape, and account are untouched |
| `speed` | Changes pacing. Does not change whether playback is running |
| `step` | Applies exactly one replay unit, then pauses. Refused with `at_end` at the end |
| `seek` | Rebuilds state at an instant. Requires `canSeek` |
| `reset` | Returns to the documented initial state |

`reset` restores: `eventTimeNs` = `startNs`, `sequence` = 0, `speed` = 1.0,
`playing` = true, a fresh empty paper account, and an incremented `generation`.

### Seek

Seek is available when the session is backed by an indexed event store
(`canSeek`). A synthetic session walks a generated path forward and cannot
reproduce a past instant, so it reports `canSeek: false` and refuses seek with
`seek_unavailable` rather than pretending.

Out-of-range targets are **rejected, not clamped**, so a client never believes
it moved somewhere it did not. A target between two events is legal: the server
applies every event at or before it, and the clock reports the requested
instant.

**Seek discards user orders, positions, and cash.** A paper fill that happened
after the target instant cannot honestly survive a rewind past its own trade.
The same policy applies to `reset`.

Seek cost is bounded by a checkpoint stride, not by fixture length. The server
keeps sparse market images every `CHECKPOINT_STRIDE` (512) events, capped at
`CHECKPOINT_LIMIT` (64) images so a longer fixture gets a longer stride rather
than more memory, and rebuilds from the nearest one — or from the current
position when the target is just ahead of it. Measured on authored fixtures: a
seek to the end folds 88 events in a 600-event fixture and 392 in a 5,000-event
one. The index is a pure function of the immutable store, so every session over
that store shares one copy.

Seeking to the same instant twice, seeking backwards to it, and playing forward
to it all produce identical logical state, because the market is a pure fold
over the event prefix.

### Idempotency

Controls are retry-safe by `commandId`. The server keeps the last 256
acknowledgements per session, including across a reconnect within that session.
Re-sending a command with an ID that has already been answered returns the
original decision with `duplicate: true` and a **current** status; the command
is not applied a second time. This holds for rejections too: a retried
rejected command stays rejected, with its original code.

Use a fresh `commandId` for each new intent. Reusing an ID for a different
action returns the earlier command's decision, not a new one.

## Acknowledgements

Every command that parses is answered exactly once, to the connection that sent
it:

~~~json
{
  "type": "replay_ack",
  "data": {
    "commandId": "a1b2c3d4",
    "action": "speed",
    "accepted": true,
    "code": null,
    "message": null,
    "duplicate": false,
    "status": { "...": "ReplayStatus" }
  }
}
~~~

An accepted command is also announced to the whole session as a `replay_status`
frame, so a second tab watching the same session is never out of date. A
rejection changed nothing, so it produces no session-wide frame.

### Rejection codes

A rejection is a normal answer on a healthy socket. The socket is never closed
for a bad command.

| `code` | Meaning |
| --- | --- |
| `invalid_command` | Required field missing for the action |
| `unsupported_speed` | `speed` absent or not in `speeds` |
| `at_end` | `play` or `step` at the end of the source |
| `seek_unavailable` | This source cannot be rewound |
| `out_of_bounds` | `timestampNs` outside `[startNs, endNs]` |

A frame that cannot be parsed into a command at all — an unknown action, a
malformed payload — cannot be acknowledged, because there may be no trustworthy
`commandId`. It produces an error frame instead, and the socket stays open:

~~~json
{
  "type": "error",
  "data": { "code": "invalid_command", "commandId": "a1b2c3d4", "message": "Unsupported replay command" }
}
~~~

## Frames after a rebuild

`reset` and `seek` rebuild market and account state. Before the status frame,
each connection in the session receives exactly **one** `snapshot` frame for the
symbols it subscribes to:

~~~json
{
  "type": "snapshot",
  "data": {
    "marketData": {}, "orderBooks": {}, "candlesticks": {}, "trades": {},
    "sequences": {}, "positions": [], "source": "recorded",
    "replay": { "...": "ReplayStatus" },
    "account": { "...": "the session's paper account" }
  }
}
~~~

It is the same body as `GET /api/snapshot`, so hydration and rebuild take one
code path on the client. It carries the paper account as well as the market,
because a rebuild resets both and a client should not need two frames to become
whole. A client **replaces** its state with this frame — including reseeding its
per-symbol book sequences from `sequences` — and does not attempt to reconcile
it with deltas from the previous generation. Gap detection resumes from the new
sequences immediately.

## Rebuilds and in-flight commands

A rebuild is one synchronous transaction: the replacement market is folded in
full before anything is swapped in, so a failed rebuild leaves the session
exactly as it was and no client can observe a half-rebuilt state. While one is
in progress the session refuses paper-order commands with HTTP 409 (`Replay
state is rebuilding; retry after the next snapshot`).

## Isolation

Sessions are identified by the `session` query parameter on `/ws` and the
`X-Paper-Session` header on REST. Each owns its cursor, clock, speed, play
state, market state, paper account, and command history, over one shared
immutable source. A control in one session has no effect on any other.
