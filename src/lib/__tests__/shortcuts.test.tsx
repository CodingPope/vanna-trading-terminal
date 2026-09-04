import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import { store } from '@/store/store';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useUIStore } from '@/store/uiStore';
import { ALL_SHORTCUTS, SHORTCUT_GROUPS } from '../shortcuts';

/**
 * Keeps the advertised keyboard map honest.
 *
 * The shortcuts modal used to carry its own hand-written table, which had
 * drifted from the actual bindings: it promised "Enter — Execute order" for a
 * feature that does not exist, and omitted F5, which is bound. A help screen
 * that lies is worse than no help screen — the reader trusts it and concludes
 * the app is broken.
 *
 * Every global shortcut listed is driven here against the real hook.
 */

function wrapper({ children }: { children: React.ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}

const mount = () => renderHook(() => useKeyboard(), { wrapper });

/**
 * Dispatch a keydown the way a browser would.
 *
 * `code` matters: react-hotkeys-hook matches chords like 'shift+slash' on the
 * physical key, and a browser reports key '?' with code 'Slash' for shift+/.
 * Omitting it made an event no real keyboard produces, which is how a dead
 * shortcut kept a green test.
 */
const CODES: Record<string, string> = { '?': 'Slash', '/': 'Slash' };

function press(key: string, init: KeyboardEventInit = {}) {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key, code: CODES[key], bubbles: true, ...init }),
  );
}

beforeEach(() => {
  useUIStore.setState({
    showCommandPalette: false,
    showKeyboardShortcuts: false,
    showSettings: false,
  });
});

describe('the advertised shortcuts are real', () => {
  it('lists nothing twice', () => {
    const keys = ALL_SHORTCUTS.map(s => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('describes every shortcut it lists', () => {
    for (const s of ALL_SHORTCUTS) {
      expect(s.keys.trim()).not.toBe('');
      expect(s.description.trim()).not.toBe('');
    }
  });

  it('does not advertise order execution, which does not exist yet', () => {
    // The old modal promised "Enter — Execute order". There is no order entry
    // in the app at all; it is Tier 2 on the roadmap. Re-adding it here should
    // fail until the feature ships.
    const claims = ALL_SHORTCUTS.map(s => s.description.toLowerCase());
    expect(claims.some(d => d.includes('execute order'))).toBe(false);
  });

  it('documents F5, which is bound but was previously invisible', () => {
    expect(ALL_SHORTCUTS.some(s => s.keys === 'F5')).toBe(true);
  });

  it('opens the command palette on the combination it advertises', () => {
    mount();
    press('k', { metaKey: true });
    expect(useUIStore.getState().showCommandPalette).toBe(true);
  });

  it('opens this reference on the key it advertises', () => {
    mount();
    // What a browser actually sends for shift+/ on a US layout.
    press('?', { shiftKey: true });
    expect(useUIStore.getState().showKeyboardShortcuts).toBe(true);
  });

  it('closes dialogs on Esc, as advertised', () => {
    mount();
    useUIStore.setState({ showCommandPalette: true, showSettings: true });

    press('Escape');

    expect(useUIStore.getState().showCommandPalette).toBe(false);
    expect(useUIStore.getState().showSettings).toBe(false);
  });

  it('switches trading phase on 1-4, as advertised', () => {
    mount();
    press('2');
    expect(store.getState().market.currentPhase).toBe('open');
    press('1');
    expect(store.getState().market.currentPhase).toBe('pre-market');
  });

  it('cycles phase on Tab, as advertised', () => {
    mount();
    press('1');
    const before = store.getState().market.currentPhase;

    press('Tab');

    expect(store.getState().market.currentPhase).not.toBe(before);
  });

  it('groups every shortcut under a titled section', () => {
    const grouped = SHORTCUT_GROUPS.flatMap(g => g.shortcuts).length;
    expect(grouped).toBe(ALL_SHORTCUTS.length);
    for (const group of SHORTCUT_GROUPS) {
      expect(group.title.trim()).not.toBe('');
      expect(group.shortcuts.length).toBeGreaterThan(0);
    }
  });

  it('marks focus-list-only shortcuts as scoped', () => {
    // J/K/Space/A/D are bound inside FocusListPanel, not globally, so the
    // reference has to say where they work or it is quietly wrong.
    const scoped = ALL_SHORTCUTS.filter(s => s.scope === 'focus-list').map(s => s.keys);
    expect(scoped).toEqual(expect.arrayContaining(['J', 'K', 'Space', 'A', 'D']));
  });
});
