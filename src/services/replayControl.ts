/**
 * Sends replay controls and records what is in flight.
 *
 * Every command carries a fresh `commandId`, which is what makes a control
 * safe to resend: the server answers a repeated ID with its original decision
 * instead of applying it twice. See docs/PROTOCOL.md.
 */
import type { AppDispatch } from '@/store/store';
import { commandSent } from '@/store/slices/replaySlice';
import type { ReplayAction, ReplaySpeed } from '@/schemas';
import { activeFeed } from './feedControl';

export interface ReplayCommandOptions {
  speed?: ReplaySpeed;
  /** Decimal-string nanoseconds. Replay time does not fit in a JS number. */
  timestampNs?: string;
}

function commandId(action: ReplayAction): string {
  const unique = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14).padEnd(12, '0');
  return `${action}-${unique}`;
}

/** Returns the command ID so a caller can match the acknowledgement. */
export function sendReplayCommand(
  dispatch: AppDispatch,
  action: ReplayAction,
  options: ReplayCommandOptions = {},
): string | null {
  const feed = activeFeed();
  if (!feed) return null;
  const id = commandId(action);
  dispatch(commandSent({ commandId: id, action, sentAt: Date.now() }));
  feed.send({ type: 'replay', data: { commandId: id, action, ...options } });
  return id;
}
