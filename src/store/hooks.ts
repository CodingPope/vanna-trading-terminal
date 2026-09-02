/**
 * Typed hooks over the Redux store.
 *
 * These replace the old `useMarket()` Context bridge. The bridge handed every
 * consumer one object containing the whole market state, so all 15 call sites
 * re-rendered on every price tick — including the ones that only wanted
 * `marketRegime` or `currentPhase`. Reading through selectors means a component
 * re-renders only when the slice it actually reads changes.
 */
import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from './store';
import {
  setSelectedSymbol as rtkSetSelectedSymbol,
  setPhase as rtkSetPhase,
} from './slices/marketSlice';
import {
  updatePanels as rtkUpdatePanels,
  setWorkspaces as rtkSetWorkspaces,
  addPriceAlert,
} from './slices/panelsSlice';
import { selectPanels, selectWorkspaces, selectCurrentWorkspaceId } from './selectors';
import type { Panel, PriceAlert, TradingPhase, Workspace } from '@/types';

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector = useSelector.withTypes<RootState>();

/**
 * Market and panel actions that depend on nothing but `dispatch`, so the
 * returned object is referentially stable for the life of the component.
 */
export function useMarketActions() {
  const dispatch = useAppDispatch();
  return useMemo(
    () => ({
      setSelectedSymbol: (symbol: string) => {
        dispatch(rtkSetSelectedSymbol(symbol));
      },
      setPhase: (phase: TradingPhase['id']) => {
        dispatch(rtkSetPhase(phase));
      },
      updatePanels: (panels: Panel[]) => {
        dispatch(rtkUpdatePanels(panels));
      },
      addAlert: (alert: Omit<PriceAlert, 'id' | 'createdAt' | 'triggered'>): PriceAlert => {
        const full: PriceAlert = {
          ...alert,
          id: `al_${Date.now()}`,
          createdAt: Date.now(),
          triggered: false,
        };
        dispatch(addPriceAlert(full));
        return full;
      },
    }),
    [dispatch]
  );
}

/**
 * Workspace actions. Separate from `useMarketActions` because saving and
 * deleting read the current panel/workspace lists, so this hook subscribes to
 * them — only Dashboard needs it.
 */
export function useWorkspaceActions() {
  const dispatch = useAppDispatch();
  const panels = useAppSelector(selectPanels);
  const workspaces = useAppSelector(selectWorkspaces);
  const currentWorkspaceId = useAppSelector(selectCurrentWorkspaceId);

  return useMemo(
    () => ({
      saveWorkspace: (name: string, layoutMode: 'grid' | 'free'): Workspace | null => {
        if (!name.trim()) return null;
        const workspace: Workspace = {
          id: `ws_${Date.now()}`,
          name: name.trim(),
          panels: panels.map(p => ({ ...p })),
          layoutMode,
          createdAt: Date.now(),
        };
        dispatch(rtkSetWorkspaces({
          workspaces: [workspace, ...workspaces],
          currentWorkspaceId: workspace.id,
        }));
        return workspace;
      },

      loadWorkspace: (id: string): Workspace | null => {
        const ws = workspaces.find(w => w.id === id);
        if (!ws) return null;
        dispatch(rtkUpdatePanels(ws.panels.map(p => ({ ...p }))));
        dispatch(rtkSetWorkspaces({ workspaces, currentWorkspaceId: ws.id }));
        return ws;
      },

      deleteWorkspace: (id: string) => {
        const remaining = workspaces.filter(w => w.id !== id);
        const newCurrent =
          currentWorkspaceId === id ? (remaining[0]?.id ?? null) : currentWorkspaceId;
        dispatch(rtkSetWorkspaces({ workspaces: remaining, currentWorkspaceId: newCurrent }));
      },
    }),
    [dispatch, panels, workspaces, currentWorkspaceId]
  );
}
