import { configureStore } from '@reduxjs/toolkit';
import paperReducer from './slices/paperSlice';
import marketReducer from './slices/marketSlice';
import orderBookReducer from './slices/orderBookSlice';
import positionsReducer from './slices/positionsSlice';
import panelsReducer, { persistPanels } from './slices/panelsSlice';
import tradesReducer from './slices/tradesSlice';

export const store = configureStore({
  reducer: {
    market: marketReducer,
    paper: paperReducer,
    orderBook: orderBookReducer,
    positions: positionsReducer,
    panels: panelsReducer,
    trades: tradesReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

let persistedPanels = store.getState().panels;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
store.subscribe(() => {
  const next = store.getState().panels;
  if (next.panels === persistedPanels.panels && next.workspaces === persistedPanels.workspaces && next.currentWorkspaceId === persistedPanels.currentWorkspaceId) return;
  persistedPanels = next;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persistPanels(store.getState().panels), 150);
});
