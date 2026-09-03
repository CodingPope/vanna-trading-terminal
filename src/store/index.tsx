import React from 'react';
import { Provider } from 'react-redux';
import { store } from './store';
import { MarketFeedProvider } from './marketFeed';

export * from './constants';
export * from './store';
export * from './selectors';
export * from './hooks';
export * from './uiStore';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <MarketFeedProvider>
        {children}
      </MarketFeedProvider>
    </Provider>
  );
}
