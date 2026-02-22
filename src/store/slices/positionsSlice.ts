import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Position, FocusItem } from '@/types';

export interface PositionsSliceState {
  positions: Position[];
  focusList: FocusItem[];
}

const initialState: PositionsSliceState = {
  positions: [],
  focusList: [],
};

export const positionsSlice = createSlice({
  name: 'positions',
  initialState,
  reducers: {
    setPositions(state, action: PayloadAction<Position[]>) {
      state.positions = action.payload;
    },
    upsertPosition(state, action: PayloadAction<Position>) {
      const idx = state.positions.findIndex(
        p => p.symbol === action.payload.symbol && p.side === action.payload.side
      );
      if (idx !== -1) state.positions[idx] = action.payload;
      else state.positions.push(action.payload);
    },
    removePosition(state, action: PayloadAction<{ symbol: string; side: 'long' | 'short' }>) {
      state.positions = state.positions.filter(
        p => !(p.symbol === action.payload.symbol && p.side === action.payload.side)
      );
    },
    setFocusList(state, action: PayloadAction<FocusItem[]>) {
      state.focusList = action.payload;
    },
  },
});

export const { setPositions, upsertPosition, removePosition, setFocusList } = positionsSlice.actions;
export default positionsSlice.reducer;
