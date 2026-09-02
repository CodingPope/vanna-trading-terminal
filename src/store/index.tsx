import React from 'react';
import { Provider } from 'react-redux';
import { store } from './store';
import { MarketFeedProvider } from './marketFeed';
import { UIProvider } from './UIContext';

export * from './constants';
export * from './UIContext';
export * from './store';
export * from './selectors';
export * from './hooks';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <UIProvider>
        <MarketFeedProvider>
          {children}
        </MarketFeedProvider>
      </UIProvider>
    </Provider>
  );
}
