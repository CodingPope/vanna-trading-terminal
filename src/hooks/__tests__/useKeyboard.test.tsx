import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import { store } from '@/store/store';
import { useKeyboard } from '../useKeyboard';
import { useUIStore } from '@/store/uiStore';

// useKeyboard reads the trading phase from Redux as well as UI state.
function wrapper({ children }: { children: React.ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}

const mount = () => renderHook(() => useKeyboard(), { wrapper });

/**
 * Regression cover for a real double-binding bug.
 *
 * `?` and Cmd/Ctrl+K used to be handled twice: once here via react-hotkeys-hook,
 * and again by a `keydown` listener inside UIProvider. Both fired on the same
 * event and both toggled, so the net effect on the dashboard — where useKeyboard
 * is mounted — was that neither shortcut did anything. These assert a single
 * toggle per press.
 */
function press(key: string, init: KeyboardEventInit = {}) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

describe('useKeyboard', () => {
  beforeEach(() => {
    useUIStore.setState({
      showCommandPalette: false,
      showKeyboardShortcuts: false,
      showSettings: false,
    });
  });

  it('opens the command palette on one mod+k press', () => {
    mount();
    press('k', { metaKey: true });
    expect(useUIStore.getState().showCommandPalette).toBe(true);
  });

  it('opens the shortcuts modal on one ? press', () => {
    mount();
    press('/', { shiftKey: true });
    expect(useUIStore.getState().showKeyboardShortcuts).toBe(true);
  });

  it('closes open modals on escape', () => {
    mount();
    useUIStore.setState({ showCommandPalette: true, showKeyboardShortcuts: true });

    press('Escape');

    const s = useUIStore.getState();
    expect(s.showCommandPalette).toBe(false);
    expect(s.showKeyboardShortcuts).toBe(false);
  });
});
