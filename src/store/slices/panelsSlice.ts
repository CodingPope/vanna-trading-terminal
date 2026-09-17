import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Panel, Workspace, PriceAlert } from '@/types';
import { z } from 'zod';
const panelSchema = z.object({ id: z.string(), type: z.enum(['watchlist','chart','orderbook','order-entry','orders','positions','trades','depth-chart','focus-list','diagnostics']), title: z.string(), x: z.number().min(0).max(10000), y: z.number().min(0).max(10000), width: z.number().min(200).max(3000), height: z.number().min(100).max(3000), minimized: z.boolean(), maximized: z.boolean() });
const workspaceSchema = z.object({ id: z.string(), name: z.string(), panels: z.array(panelSchema), layoutMode: z.enum(['grid', 'free']), createdAt: z.number() });

const PANELS_STORAGE_KEY = 'vanna:panels:v2';
const WORKSPACES_STORAGE_KEY = 'vanna:workspaces:v2';

export const DEFAULT_PANELS: Panel[] = [
  { id: 'watchlist', type: 'watchlist', title: 'WATCHLIST', x: 0, y: 0, width: 230, height: 410, minimized: false, maximized: false },
  { id: 'chart', type: 'chart', title: 'CHART', x: 240, y: 0, width: 540, height: 410, minimized: false, maximized: false },
  { id: 'orderbook', type: 'orderbook', title: 'ORDER BOOK', x: 790, y: 0, width: 260, height: 410, minimized: false, maximized: false },
  { id: 'order-entry', type: 'order-entry', title: 'ORDER TICKET', x: 1060, y: 0, width: 300, height: 490, minimized: false, maximized: false },
  { id: 'orders', type: 'orders', title: 'ORDER BLOTTER', x: 0, y: 420, width: 1050, height: 300, minimized: false, maximized: false },
  { id: 'positions', type: 'positions', title: 'POSITIONS & RISK', x: 1060, y: 500, width: 300, height: 300, minimized: false, maximized: false },
  { id: 'trades', type: 'trades', title: 'TRADES', x: 0, y: 730, width: 300, height: 300, minimized: false, maximized: false },
  { id: 'depth-chart', type: 'depth-chart', title: 'DEPTH CHART', x: 310, y: 730, width: 350, height: 300, minimized: false, maximized: false },
  { id: 'focus-list', type: 'focus-list', title: 'FOCUS LIST', x: 670, y: 730, width: 300, height: 300, minimized: false, maximized: false },
  { id: 'diagnostics', type: 'diagnostics', title: 'DEMO & FEED HEALTH', x: 980, y: 810, width: 380, height: 300, minimized: false, maximized: false },
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
      const parsed = z.array(panelSchema).parse(JSON.parse(stored));
      if (Array.isArray(parsed) && parsed.length) return mergeWithDefaultPanels(parsed);
    }
  } catch { /* ignore */ }
  return DEFAULT_PANELS.map(p => ({ ...p }));
}

function loadInitialWorkspaces(): { workspaces: Workspace[]; currentWorkspaceId: string | null } {
  try {
    const stored = localStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (stored) {
      const parsed = z.object({ workspaces: z.array(workspaceSchema), currentId: z.string().nullable() }).parse(JSON.parse(stored));
      if (parsed?.workspaces) {
        return {
          workspaces: parsed.workspaces.map(ws => ({ ...ws, panels: mergeWithDefaultPanels(ws.panels) })),
          currentWorkspaceId: parsed.currentId ?? null,
        };
      }
    }
  } catch { /* ignore */ }
  const defaultWs: Workspace = {
    id: 'ws_default', name: 'Default',
    panels: DEFAULT_PANELS.map(p => ({ ...p })),
    layoutMode: 'grid', createdAt: Date.now(),
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

export const panelsSlice = createSlice({
  name: 'panels',
  initialState,
  reducers: {
    updatePanels(state, action: PayloadAction<Panel[]>) {
      state.panels = action.payload;
    },
    setWorkspaces(state, action: PayloadAction<{ workspaces: Workspace[]; currentWorkspaceId?: string | null }>) {
      state.workspaces = action.payload.workspaces;
      if (action.payload.currentWorkspaceId !== undefined) {
        state.currentWorkspaceId = action.payload.currentWorkspaceId;
      }
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

/** Persist after state transitions, outside reducers. */
export function persistPanels(state: PanelsSliceState) {
  try {
    localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(state.panels));
    localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify({ workspaces: state.workspaces, currentId: state.currentWorkspaceId }));
  } catch { /* Storage can be unavailable; the workspace remains usable. */ }
}
