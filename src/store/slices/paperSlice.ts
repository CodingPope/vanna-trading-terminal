import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PaperAccount } from '@/schemas/paper';

interface PaperState { account: PaperAccount | null; synchronized: boolean }
const initialState: PaperState = { account: null, synchronized: false };
const slice = createSlice({
  name: 'paper', initialState,
  reducers: {
    receiveAccount(state, { payload }: PayloadAction<PaperAccount>) {
      // HTTP acknowledgements and socket snapshots can arrive in either order.
      if (state.account?.epoch === payload.epoch && state.account.revision > payload.revision) return;
      state.account = payload;
      state.synchronized = true;
    },
    invalidateAccount(state) { state.synchronized = false; },
  },
});
export const { receiveAccount, invalidateAccount } = slice.actions;
export default slice.reducer;
