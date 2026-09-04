/**
 * The reading the orb is currently showing.
 *
 * Bridges two stores: which universe to summarise is a user setting (Zustand),
 * the quotes themselves are market state (Redux). Keeping the join here means
 * the orb and its legend cannot end up describing different things, which is
 * the whole risk of a legend — a key that explains something other than what
 * is on screen is worse than none.
 */
import { useAppSelector } from '@/store/hooks';
import { selectMarketPulse, selectFocusPulse } from '@/store/selectors';
import { useUIStore } from '@/store/uiStore';
import type { MarketPulse } from '@/lib/marketPulse';
import type { OrbScope } from '@/types';

export interface ScopedPulse {
  pulse: MarketPulse;
  scope: OrbScope;
  /** How to name the universe in the UI. */
  label: string;
}

export function useMarketPulse(): ScopedPulse {
  const scope = useUIStore(s => s.settings.orbScope);
  const marketPulse = useAppSelector(selectMarketPulse);
  const focusPulse = useAppSelector(selectFocusPulse);

  const pulse = scope === 'focus' ? focusPulse : marketPulse;

  return {
    pulse,
    scope,
    label: scope === 'focus' ? 'Focus list' : 'Whole market',
  };
}
