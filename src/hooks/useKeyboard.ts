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
 *   P       Play/pause the replay
 *   .       Step one replay unit
 *
 * Shortcuts handled in FocusListPanel (list-scoped):
 *   j / k   Navigate focus list up/down
 *   Space   Stage symbol
 *   a       Add alert
 *   d       Dismiss
 */
import { useHotkeys } from 'react-hotkeys-hook';
import { useUIStore } from '@/store/uiStore';
import { useAppDispatch, useAppSelector, useMarketActions } from '@/store/hooks';
import { sendReplayCommand } from '@/services/replayControl';


export function useKeyboard(): void {
  const dispatch = useAppDispatch();
  const playing = useAppSelector(s => s.replay.status?.playing ?? false);
  const canControl = useAppSelector(s => s.replay.status !== null);
  const toggleCommandPalette = useUIStore(s => s.toggleCommandPalette);
  const toggleKeyboardShortcuts = useUIStore(s => s.toggleKeyboardShortcuts);
  const closeAllModals = useUIStore(s => s.closeAllModals);
  const { setPhase } = useMarketActions();

  // F5 — prevent accidental page refresh during live trading
  useHotkeys('f5', (e) => { e.preventDefault(); }, { preventDefault: true });

  // 1–4 — jump directly to a trading phase
  useHotkeys('1', () => setPhase('pre-market'));
  useHotkeys('2', () => setPhase('open'));
  useHotkeys('3', () => setPhase('midday'));
  useHotkeys('4', () => setPhase('power-hour'));

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

  // ? — keyboard shortcuts reference modal.
  //
  // Must be 'shift+slash', not 'shift+/'. A browser reports `key === '?'` for
  // that chord, and react-hotkeys-hook matches it by physical key name — so
  // 'shift+/' matched nothing and the shortcut was dead in the browser while a
  // synthetic KeyboardEvent carrying key '/' kept the unit test green.
  useHotkeys('shift+slash', () => toggleKeyboardShortcuts());

  // Cmd/Ctrl+K — command palette
  useHotkeys('mod+k', (e) => { e.preventDefault(); toggleCommandPalette(); }, { preventDefault: true });

  // P / . — replay transport. react-hotkeys-hook already suppresses these while
  // an <input>, <textarea> or <select> has focus, so typing a quantity into the
  // order ticket never pauses the market underneath it. Space is deliberately
  // not used: the focus list already owns it for staging a symbol.
  useHotkeys('p', (e) => {
    if (!canControl) return;
    e.preventDefault();
    sendReplayCommand(dispatch, playing ? 'pause' : 'play');
  }, { preventDefault: true }, [canControl, playing, dispatch]);

  useHotkeys('period', (e) => {
    if (!canControl) return;
    e.preventDefault();
    sendReplayCommand(dispatch, 'step');
  }, { preventDefault: true }, [canControl, dispatch]);

  // Esc — close any open modal. Previously handled by a second window listener
  // inside UIProvider, which also double-bound ? and mod+k against the hotkeys
  // below, cancelling both toggles out.
  useHotkeys('escape', () => closeAllModals(), { enableOnFormTags: true });
}
