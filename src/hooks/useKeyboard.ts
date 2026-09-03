/**
 * Centralized keyboard shortcut hook for the trading dashboard.
 * Uses react-hotkeys-hook so bindings automatically don't fire when the user
 * is typing in an <input>, <textarea>, or <select>.
 *
 * Mount once from Dashboard — not from individual panels.
 *
 * Shortcuts handled here (global):
 *   1–4     Switch trading phase directly
 *   Tab     Cycle to next trading phase
 *   /       Focus the focus-list search input
 *   F5      Prevent accidental page refresh during trading
 *   ?       Toggle keyboard shortcuts reference modal
 *   Cmd/Ctrl+K  Toggle command palette
 *
 * Shortcuts handled in FocusListPanel (list-scoped):
 *   j / k   Navigate focus list up/down
 *   Space   Stage symbol
 *   a       Add alert
 *   d       Dismiss
 */
import { useHotkeys } from 'react-hotkeys-hook';
import { useUIStore } from '@/store/uiStore';
import { useAppSelector, useMarketActions } from '@/store/hooks';
import { selectCurrentPhase } from '@/store/selectors';
import type { TradingPhase } from '@/types';

const PHASES: TradingPhase['id'][] = ['pre-market', 'open', 'midday', 'power-hour'];

export function useKeyboard(): void {
  const toggleCommandPalette = useUIStore(s => s.toggleCommandPalette);
  const toggleKeyboardShortcuts = useUIStore(s => s.toggleKeyboardShortcuts);
  const closeAllModals = useUIStore(s => s.closeAllModals);
  const currentPhase = useAppSelector(selectCurrentPhase);
  const { setPhase } = useMarketActions();

  // F5 — prevent accidental page refresh during live trading
  useHotkeys('f5', (e) => { e.preventDefault(); }, { preventDefault: true });

  // 1–4 — jump directly to a trading phase
  useHotkeys('1', () => setPhase('pre-market'));
  useHotkeys('2', () => setPhase('open'));
  useHotkeys('3', () => setPhase('midday'));
  useHotkeys('4', () => setPhase('power-hour'));

  // Tab — cycle to next phase
  useHotkeys(
    'tab',
    (e) => {
      e.preventDefault();
      const idx = PHASES.indexOf(currentPhase);
      setPhase(PHASES[(idx + 1) % PHASES.length]);
    },
    { preventDefault: true },
  );

  // / — focus the focus-list search input
  useHotkeys(
    '/',
    (e) => {
      e.preventDefault();
      const input = document.querySelector<HTMLInputElement>('[aria-label="Filter focus list"]');
      input?.focus();
    },
    { preventDefault: true },
  );

  // ? — keyboard shortcuts reference modal
  useHotkeys('shift+/', () => toggleKeyboardShortcuts());

  // Cmd/Ctrl+K — command palette
  useHotkeys('mod+k', (e) => { e.preventDefault(); toggleCommandPalette(); }, { preventDefault: true });

  // Esc — close any open modal. Previously handled by a second window listener
  // inside UIProvider, which also double-bound ? and mod+k against the hotkeys
  // below, cancelling both toggles out.
  useHotkeys('escape', () => closeAllModals(), { enableOnFormTags: true });
}
