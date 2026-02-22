import React from 'react';
import { Provider } from 'react-redux';
import { store } from './store';
import { MarketProvider } from './MarketStore';
import { UIProvider } from './UIContext';

export * from './MarketStore';
export * from './UIContext';
export * from './store';
export * from './selectors';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <UIProvider>
        <MarketProvider>
          {children}
        </MarketProvider>
      </UIProvider>
    </Provider>
  );
}
