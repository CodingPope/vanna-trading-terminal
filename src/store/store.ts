import { configureStore } from '@reduxjs/toolkit';
import marketReducer from './slices/marketSlice';
import orderBookReducer from './slices/orderBookSlice';
import positionsReducer from './slices/positionsSlice';
import panelsReducer from './slices/panelsSlice';

export const store = configureStore({
  reducer: {
    market: marketReducer,
    orderBook: orderBookReducer,
    positions: positionsReducer,
    panels: panelsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
