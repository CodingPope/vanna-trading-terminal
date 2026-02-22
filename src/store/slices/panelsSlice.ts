import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Panel, Workspace, PriceAlert } from '@/types';

const PANELS_STORAGE_KEY = 'vanna:panels';
const WORKSPACES_STORAGE_KEY = 'vanna:workspaces';

export const DEFAULT_PANELS: Panel[] = [
  { id: 'watchlist', type: 'watchlist', title: 'WATCHLIST', x: 0, y: 0, width: 280, height: 420, minimized: false, maximized: false },
  { id: 'ticker', type: 'ticker', title: 'TICKER', x: 0, y: 430, width: 280, height: 200, minimized: false, maximized: false },
  { id: 'focus-list', type: 'focus-list', title: 'FOCUS LIST', x: 0, y: 640, width: 280, height: 210, minimized: false, maximized: false },
  { id: 'chart', type: 'chart', title: 'CHART', x: 290, y: 0, width: 560, height: 430, minimized: false, maximized: false },
  { id: 'depth-chart', type: 'depth-chart', title: 'DEPTH CHART', x: 290, y: 440, width: 560, height: 200, minimized: false, maximized: false },
  { id: 'ana', type: 'ana', title: 'ANA ANALYSIS', x: 290, y: 650, width: 270, height: 200, minimized: false, maximized: false },
  { id: 'trades', type: 'trades', title: 'TRADES', x: 570, y: 650, width: 280, height: 200, minimized: false, maximized: false },
  { id: 'orderbook', type: 'orderbook', title: 'ORDER BOOK', x: 860, y: 0, width: 260, height: 430, minimized: false, maximized: false },
  { id: 'depth', type: 'depth', title: 'DEPTH', x: 860, y: 440, width: 260, height: 200, minimized: false, maximized: false },
  { id: 'positions', type: 'positions', title: 'POSITIONS', x: 860, y: 650, width: 260, height: 200, minimized: false, maximized: false },
];

function mergeWithDefaultPanels(storedPanels: Panel[]): Panel[] {
  const byId = new Map<string, Panel>();

  for (const panel of storedPanels) byId.set(panel.id, panel);
  for (const def of DEFAULT_PANELS) {
    if (!byId.has(def.id)) byId.set(def.id, { ...def });
  }

  return Array.from(byId.values());
}

function loadInitialPanels(): Panel[] {
  try {
    const stored = localStorage.getItem(PANELS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Panel[];
      if (Array.isArray(parsed) && parsed.length) return mergeWithDefaultPanels(parsed);
    }
  } catch (_) { /* ignore */ }
  return DEFAULT_PANELS.map(p => ({ ...p }));
}

function loadInitialWorkspaces(): { workspaces: Workspace[]; currentWorkspaceId: string | null } {
  try {
    const stored = localStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as { workspaces: Workspace[]; currentId: string | null };
      if (parsed?.workspaces) {
        return {
          workspaces: parsed.workspaces.map(ws => ({ ...ws, panels: mergeWithDefaultPanels(ws.panels) })),
          currentWorkspaceId: parsed.currentId ?? null,
        };
      }
    }
  } catch (_) { /* ignore */ }
  const defaultWs: Workspace = {
    id: 'ws_default', name: 'Default',
    panels: DEFAULT_PANELS.map(p => ({ ...p })),
    layoutMode: 'free', createdAt: Date.now(),
  };
  return { workspaces: [defaultWs], currentWorkspaceId: defaultWs.id };
}

export interface PanelsSliceState {
  panels: Panel[];
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  alerts: PriceAlert[];
}

const loaded = loadInitialWorkspaces();
const initialState: PanelsSliceState = {
  panels: loadInitialPanels(),
  workspaces: loaded.workspaces,
  currentWorkspaceId: loaded.currentWorkspaceId,
  alerts: [],
};

function persistWorkspacesToStorage(workspaces: Workspace[], currentId: string | null) {
  try {
    localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify({ workspaces, currentId }));
  } catch (_) { /* ignore */ }
}

export const panelsSlice = createSlice({
  name: 'panels',
  initialState,
  reducers: {
    updatePanels(state, action: PayloadAction<Panel[]>) {
      state.panels = action.payload;
      try { localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(action.payload)); } catch (_) { /* ignore */ }
    },
    setWorkspaces(state, action: PayloadAction<{ workspaces: Workspace[]; currentWorkspaceId?: string | null }>) {
      state.workspaces = action.payload.workspaces;
      if (action.payload.currentWorkspaceId !== undefined) {
        state.currentWorkspaceId = action.payload.currentWorkspaceId;
      }
      persistWorkspacesToStorage(state.workspaces, state.currentWorkspaceId);
    },
    addPriceAlert(state, action: PayloadAction<PriceAlert>) {
      state.alerts.unshift(action.payload);
    },
    removePriceAlert(state, action: PayloadAction<string>) {
      state.alerts = state.alerts.filter(a => a.id !== action.payload);
    },
    triggerPriceAlert(state, action: PayloadAction<string>) {
      const alert = state.alerts.find(a => a.id === action.payload);
      if (alert) alert.triggered = true;
    },
  },
});

export const { updatePanels, setWorkspaces, addPriceAlert, removePriceAlert, triggerPriceAlert } = panelsSlice.actions;
export default panelsSlice.reducer;
