/**
 * Playback controls for the replay session.
 *
 * Everything on this bar is drawn from server-authoritative status. When the
 * server has not told us the state — before hydration, or after the socket
 * drops — the controls say so and disable themselves rather than showing a
 * paused clock that is really still running somewhere.
 *
 * Wire contract: docs/PROTOCOL.md.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { dismissRejection } from '@/store/slices/replaySlice';
import { sendReplayCommand } from '@/services/replayControl';
import type { ReplaySpeed } from '@/schemas';

/** Milliseconds an accepted command stays visibly acknowledged. */
const ACKNOWLEDGED_MS = 1200;

function speedLabel(speed: ReplaySpeed): string {
  return speed === 'max' ? 'Max' : `${speed}x`;
}

/** Replay time is nanoseconds as a decimal string; only BigInt keeps it exact. */
function clockLabel(eventTimeNs: string): string {
  const ms = Number(BigInt(eventTimeNs) / 1_000_000n);
  return new Date(ms).toISOString().slice(11, 19);
}

function progress(status: { startNs: string; endNs: string; eventTimeNs: string }): number {
  const span = BigInt(status.endNs) - BigInt(status.startNs);
  if (span <= 0n) return 0;
  const done = BigInt(status.eventTimeNs) - BigInt(status.startNs);
  // Scaled to basis points before Number, so a 61-bit span keeps its precision.
  return Math.min(10_000, Math.max(0, Number((done * 10_000n) / span)));
}

export function ReplayBar() {
  const dispatch = useAppDispatch();
  const status = useAppSelector(s => s.replay.status);
  const pending = useAppSelector(s => s.replay.pending);
  const rejection = useAppSelector(s => s.replay.rejection);
  const acknowledged = useAppSelector(s => s.replay.acknowledged);
  const connected = useAppSelector(s => s.market.isConnected);
  const hasPaperState = useAppSelector(
    s => s.paper.account !== null && (s.paper.account.orders.length > 0 || s.paper.account.positions.length > 0),
  );
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // The store clock, not Date.now(): reading the wall clock during render is
  // impure, and this already ticks while the terminal is running.
  const now = useAppSelector(s => s.market.stats.lastUpdate);
  const recentlyAcknowledged = acknowledged !== null && now - acknowledged.at < ACKNOWLEDGED_MS;

  useEffect(() => {
    if (confirmingReset) confirmRef.current?.focus();
  }, [confirmingReset]);

  const busy = pending.length > 0;
  const position = useMemo(() => (status ? progress(status) : 0), [status]);

  if (!status) {
    return (
      <div
        data-testid="replay-bar"
        role="group"
        aria-label="Replay controls"
        className="h-10 flex items-center gap-3 px-3 border-b border-white/5 bg-vanna-surface/60 text-[11px] font-mono text-vanna-text-secondary"
      >
        <span data-testid="replay-state">
          {connected ? 'Replay status unavailable' : 'Reconnecting — replay controls unavailable'}
        </span>
      </div>
    );
  }

  const send = (action: 'play' | 'pause' | 'step' | 'reset' | 'speed' | 'seek', options?: { speed?: ReplaySpeed; timestampNs?: string }) => {
    sendReplayCommand(dispatch, action, options);
  };

  const seekTo = (basisPoints: number) => {
    const span = BigInt(status.endNs) - BigInt(status.startNs);
    const target = BigInt(status.startNs) + (span * BigInt(basisPoints)) / 10_000n;
    send('seek', { timestampNs: target.toString() });
  };

  const disabled = !connected || busy;

  return (
    <div
      data-testid="replay-bar"
      role="group"
      aria-label="Replay controls"
      className="h-10 flex items-center gap-2 px-3 border-b border-white/5 bg-vanna-surface/60 text-[11px] font-mono"
    >
      <span
        data-testid="replay-provenance"
        title="Where this data comes from"
        className="px-1.5 py-0.5 rounded bg-vanna-gold/15 text-vanna-gold tracking-wider"
      >
        {status.mode.toUpperCase()}
      </span>

      <button
        type="button"
        onClick={() => send(status.playing ? 'pause' : 'play')}
        disabled={disabled || (status.ended && !status.playing)}
        aria-label={status.playing ? 'Pause replay' : 'Play replay'}
        aria-pressed={status.playing}
        className="p-1 rounded text-vanna-text hover:text-vanna-cyan disabled:opacity-40 disabled:hover:text-vanna-text"
      >
        {status.playing ? <Pause size={14} /> : <Play size={14} />}
      </button>

      <button
        type="button"
        onClick={() => send('step')}
        disabled={disabled || status.ended || !status.canStep}
        aria-label={`Step one ${status.unit}`}
        className="p-1 rounded text-vanna-text hover:text-vanna-cyan disabled:opacity-40 disabled:hover:text-vanna-text"
      >
        <SkipForward size={14} />
      </button>

      <label className="flex items-center gap-1 text-vanna-text-secondary">
        <span className="sr-only">Playback speed</span>
        <select
          aria-label="Playback speed"
          value={String(status.speed)}
          disabled={disabled}
          onChange={e => send('speed', { speed: e.target.value === 'max' ? 'max' : Number(e.target.value) })}
          className="px-1 py-0.5 rounded bg-vanna-surface-light/40 border border-white/10 text-vanna-text disabled:opacity-40"
        >
          {status.speeds.map(speed => (
            <option key={String(speed)} value={String(speed)}>{speedLabel(speed)}</option>
          ))}
        </select>
      </label>

      <input
        type="range"
        min={0}
        max={10_000}
        step={100}
        value={scrub ?? position}
        disabled={disabled || !status.canSeek}
        aria-label="Seek through the session"
        aria-valuetext={`${clockLabel(status.eventTimeNs)}, ${(position / 100).toFixed(0)} percent through the session`}
        title={status.canSeek ? 'Seek through the session' : 'This source cannot be rewound'}
        onChange={e => setScrub(Number(e.target.value))}
        onPointerUp={() => { if (scrub !== null) { seekTo(scrub); setScrub(null); } }}
        onKeyUp={e => {
          if (scrub !== null && ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
            seekTo(scrub);
            setScrub(null);
          }
        }}
        className="flex-1 min-w-24 max-w-64 accent-vanna-cyan disabled:opacity-40"
      />

      <span data-testid="replay-clock" className="text-vanna-text tabular-nums">
        {clockLabel(status.eventTimeNs)}
      </span>

      {confirmingReset ? (
        <span className="flex items-center gap-1" role="alertdialog" aria-label="Confirm replay reset">
          <span className="text-amber-300">Discard orders and positions?</span>
          <button
            type="button"
            ref={confirmRef}
            onClick={() => { send('reset'); setConfirmingReset(false); }}
            className="px-1.5 py-0.5 rounded border border-vanna-red/50 text-vanna-red"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => setConfirmingReset(false)}
            className="px-1.5 py-0.5 rounded border border-white/10 text-vanna-text-secondary"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => (hasPaperState ? setConfirmingReset(true) : send('reset'))}
          disabled={disabled}
          aria-label="Reset replay to the start"
          className="p-1 rounded text-vanna-text hover:text-vanna-cyan disabled:opacity-40 disabled:hover:text-vanna-text"
        >
          <RotateCcw size={14} />
        </button>
      )}

      <span
        data-testid="replay-state"
        role="status"
        aria-live="polite"
        className={rejection ? 'text-vanna-red' : busy ? 'text-amber-300' : 'text-vanna-text-secondary'}
      >
        {!connected ? 'Reconnecting'
          : rejection ? rejection.message
          : busy ? `${pending[pending.length - 1].action}…`
          : recentlyAcknowledged ? 'Applied'
          : status.ended ? 'End of session'
          : status.playing ? `Playing ${speedLabel(status.speed)}`
          : 'Paused'}
      </span>

      {rejection && (
        <button
          type="button"
          onClick={() => dispatch(dismissRejection())}
          aria-label="Dismiss replay error"
          className="px-1 text-vanna-text-secondary hover:text-vanna-text"
        >
          ×
        </button>
      )}

      <span data-testid="replay-fixture" className="truncate max-w-40 text-vanna-text-secondary" title={status.fixtureId}>
        {status.fixtureId}
      </span>
    </div>
  );
}
