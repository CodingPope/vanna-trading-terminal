/**
 * The keyboard map, in one place.
 *
 * There used to be two lists: the bindings in `useKeyboard` and
 * `FocusListPanel`, and a hand-written table inside the shortcuts modal. They
 * had already drifted — the modal advertised "Enter — Execute order" for a
 * feature that does not exist, and said nothing about F5, which is bound.
 *
 * Both the shortcuts modal and Settings render from this, and
 * `shortcuts.test.ts` drives the real hooks with these key strings, so a
 * shortcut that stops working fails a test rather than quietly becoming a lie
 * on a help screen.
 */

export type ShortcutScope = 'global' | 'focus-list';

export interface Shortcut {
  /** How it is written on screen. */
  keys: string;
  description: string;
  /**
   * Where it fires. Global shortcuts come from `useKeyboard`, which Dashboard
   * mounts once; focus-list ones only apply while that panel has the keys.
   */
  scope: ShortcutScope;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: '1 – 4', description: 'Jump to trading phase', scope: 'global' },
      { keys: 'J', description: 'Move down the focus list', scope: 'focus-list' },
      { keys: 'K', description: 'Move up the focus list', scope: 'focus-list' },
    ],
  },
  {
    title: 'Focus list',
    shortcuts: [
      { keys: 'Space', description: 'Stage the selected symbol', scope: 'focus-list' },
      { keys: 'A', description: 'Set a price alert', scope: 'focus-list' },
      { keys: 'D', description: 'Dismiss from the list', scope: 'focus-list' },
      { keys: '/', description: 'Focus the filter box', scope: 'global' },
    ],
  },
  {
    title: 'System',
    shortcuts: [
      { keys: '⌘K / Ctrl+K', description: 'Command palette', scope: 'global' },
      { keys: '?', description: 'This shortcut reference', scope: 'global' },
      { keys: 'Esc', description: 'Close any open dialog', scope: 'global' },
      // Not previously documented anywhere, despite being bound: a reflexive
      // F5 mid-session would otherwise reload the terminal.
      { keys: 'F5', description: 'Suppressed — prevents an accidental reload', scope: 'global' },
    ],
  },
];

export const ALL_SHORTCUTS: Shortcut[] = SHORTCUT_GROUPS.flatMap(g => g.shortcuts);
