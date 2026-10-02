/**
 * Server-authoritative playback state.
 *
 * Nothing here is inferred locally. The server owns whether the clock is
 * running, where it is, and what the session may do; the client renders that
 * and records what it has asked for but not yet had answered. Optimistically
 * flipping a play button and then discovering the command was refused is how a
 * control surface starts lying about the system it controls.
 *
 * The wire contract is docs/PROTOCOL.md.
 */
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ReplayAck, ReplayAction, ReplayStatus } from '@/schemas';

export interface PendingCommand {
  commandId: string;
  action: ReplayAction;
  sentAt: number;
}

export interface ReplayRejection {
  commandId: string;
  action: ReplayAction;
  code: string;
  message: string;
}

export interface ReplaySliceState {
  /** Null until a snapshot or status frame arrives: unknown, not "stopped". */
  status: ReplayStatus | null;
  pending: PendingCommand[];
  /** The last refusal, kept until the user acts again or it is dismissed. */
  rejection: ReplayRejection | null;
  /** The last command the server accepted, for a brief acknowledged state. */
  acknowledged: { commandId: string; action: ReplayAction; at: number } | null;
}

const initialState: ReplaySliceState = {
  status: null, pending: [], rejection: null, acknowledged: null,
};

export const replaySlice = createSlice({
  name: 'replay',
  initialState,
  reducers: {
    receiveStatus(state, action: PayloadAction<ReplayStatus>) {
      state.status = action.payload;
    },
    commandSent(state, action: PayloadAction<PendingCommand>) {
      state.pending.push(action.payload);
      state.rejection = null;
    },
    receiveAck(state, action: PayloadAction<ReplayAck>) {
      const ack = action.payload;
      state.pending = state.pending.filter(p => p.commandId !== ack.commandId);
      state.status = ack.status;
      if (ack.accepted) {
        state.acknowledged = { commandId: ack.commandId, action: ack.action, at: Date.now() };
        state.rejection = null;
      } else {
        state.rejection = {
          commandId: ack.commandId, action: ack.action,
          code: ack.code ?? 'rejected',
          message: ack.message ?? 'The server refused that control.',
        };
      }
    },
    /**
     * The socket dropped. Commands in flight will never be answered on it, and
     * the status we hold describes a session we are no longer watching, so both
     * are cleared rather than left to look current.
     */
    feedLost(state) {
      state.pending = [];
      state.status = null;
      state.acknowledged = null;
    },
    dismissRejection(state) {
      state.rejection = null;
    },
  },
});

export const { receiveStatus, commandSent, receiveAck, feedLost, dismissRejection } = replaySlice.actions;
export default replaySlice.reducer;
