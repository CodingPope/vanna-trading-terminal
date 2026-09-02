/**
 * MarketStore — backward-compatible Context bridge over Redux Toolkit.
 *
 * Existing components continue to call useMarket() unchanged.
 * New code can import RTK selectors from @/store/selectors directly.
 */
import React, { createContext, useContext, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from './store';
import {
  batchUpdateMarketData,
  setSelectedSymbol as rtkSetSelectedSymbol,
  setPhase as rtkSetPhase,
  setStats as rtkSetStats,
  setConnected as rtkSetConnected,
} from './slices/marketSlice';
import { setOrderBook } from './slices/orderBookSlice';
import { setFocusList } from './slices/positionsSlice';
import { updatePanels as rtkUpdatePanels, setWorkspaces as rtkSetWorkspaces, addPriceAlert, removePriceAlert } from './slices/panelsSlice';
import type {
  MarketData, CandlestickData, OrderBookEntry, Position, FocusItem,
  TradingPhase, StatsForNerds, MarketRegime, Panel, Workspace, PriceAlert,
} from '@/types';
import {
  SYMBOLS, generateMockOrderBook, generateInitialFocusList,
} from './mockData';

// ── Context type — identical interface as original ───────────────────────────
interface MarketContextType {
  state: {
    marketData: Map<string, MarketData>;
    candlesticks: Map<string, CandlestickData[]>;
    orderBooks: Map<string, OrderBookEntry[]>;
    positions: Position[];
    focusList: FocusItem[];
    currentPhase: TradingPhase['id'];
    selectedSymbol: string;
    marketRegime: MarketRegime;
    stats: StatsForNerds;
    panels: Panel[];
    workspaces: Workspace[];
    currentWorkspaceId: string | null;
    alerts: PriceAlert[];
    isConnected: boolean;
    lastUpdate: number;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: React.Dispatch<any>;
  updateMarketData: (symbol: string, data: MarketData) => void;
  setSelectedSymbol: (symbol: string) => void;
  setPhase: (phase: TradingPhase['id']) => void;
  updatePanels: (panels: Panel[]) => void;
  saveWorkspace: (name: string, layoutMode: 'grid' | 'free') => Workspace | null;
  loadWorkspace: (id: string) => Workspace | null;
  deleteWorkspace: (id: string) => void;
  addAlert: (alert: Omit<PriceAlert, 'id' | 'createdAt' | 'triggered'>) => PriceAlert;
  getMarketData: (symbol: string) => MarketData | undefined;
  getCandlesticks: (symbol: string) => CandlestickData[];
  getOrderBook: (symbol: string) => OrderBookEntry[];
}

const MarketContext = createContext<MarketContextType | null>(null);

// ── Provider ─────────────────────────────────────────────────────────────────
export function MarketProvider({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch<AppDispatch>();

  // ── Read from RTK ──────────────────────────────────────────────────────────
  const marketEntities = useSelector((s: RootState) => s.market.entities);
  const candlesticksRecord = useSelector((s: RootState) => s.market.candlesticks);
  const orderBooksRecord = useSelector((s: RootState) => s.orderBook.books);
  const positions = useSelector((s: RootState) => s.positions.positions);
  const focusList = useSelector((s: RootState) => s.positions.focusList);
  const currentPhase = useSelector((s: RootState) => s.market.currentPhase);
  const selectedSymbol = useSelector((s: RootState) => s.market.selectedSymbol);
  const marketRegime = useSelector((s: RootState) => s.market.marketRegime);
  const stats = useSelector((s: RootState) => s.market.stats);
  const panels = useSelector((s: RootState) => s.panels.panels);
  const workspaces = useSelector((s: RootState) => s.panels.workspaces);
  const currentWorkspaceId = useSelector((s: RootState) => s.panels.currentWorkspaceId);
  const alerts = useSelector((s: RootState) => s.panels.alerts);
  const isConnected = useSelector((s: RootState) => s.market.isConnected);
  const lastUpdate = useSelector((s: RootState) => s.market.lastUpdate);

  // ── Convert Records → Maps for backward compat ─────────────────────────────
  const marketDataMap = useMemo(() => new Map(Object.entries(marketEntities)), [marketEntities]);
  const candlesticksMap = useMemo(() => new Map(Object.entries(candlesticksRecord)), [candlesticksRecord]);
  const orderBooksMap = useMemo(() => new Map(Object.entries(orderBooksRecord)), [orderBooksRecord]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const updateMarketData = useCallback((symbol: string, data: MarketData) => {
    dispatch(batchUpdateMarketData([data]));
    // symbol param kept for API compat; data.symbol is the canonical key
    void symbol;
  }, [dispatch]);

  const setSelectedSymbol = useCallback((symbol: string) => {
    dispatch(rtkSetSelectedSymbol(symbol));
  }, [dispatch]);

  const setPhase = useCallback((phase: TradingPhase['id']) => {
    dispatch(rtkSetPhase(phase));
  }, [dispatch]);

  const updatePanels = useCallback((newPanels: Panel[]) => {
    dispatch(rtkUpdatePanels(newPanels));
  }, [dispatch]);

  const saveWorkspace = useCallback((name: string, layoutMode: 'grid' | 'free'): Workspace | null => {
    if (!name.trim()) return null;
    const workspace: Workspace = {
      id: `ws_${Date.now()}`,
      name: name.trim(),
      panels: panels.map(p => ({ ...p })),
      layoutMode,
      createdAt: Date.now(),
    };
    const updated = [workspace, ...workspaces];
    dispatch(rtkSetWorkspaces({ workspaces: updated, currentWorkspaceId: workspace.id }));
    return workspace;
  }, [panels, workspaces, dispatch]);

  const loadWorkspace = useCallback((id: string): Workspace | null => {
    const ws = workspaces.find(w => w.id === id);
    if (!ws) return null;
    dispatch(rtkUpdatePanels(ws.panels.map(p => ({ ...p }))));
    dispatch(rtkSetWorkspaces({ workspaces, currentWorkspaceId: ws.id }));
    return ws;
  }, [workspaces, dispatch]);

  const deleteWorkspace = useCallback((id: string) => {
    const remaining = workspaces.filter(w => w.id !== id);
    const newCurrent = currentWorkspaceId === id ? (remaining[0]?.id ?? null) : currentWorkspaceId;
    dispatch(rtkSetWorkspaces({ workspaces: remaining, currentWorkspaceId: newCurrent }));
  }, [workspaces, currentWorkspaceId, dispatch]);

  const addAlert = useCallback((alert: Omit<PriceAlert, 'id' | 'createdAt' | 'triggered'>): PriceAlert => {
    const full: PriceAlert = { ...alert, id: `al_${Date.now()}`, createdAt: Date.now(), triggered: false };
    dispatch(addPriceAlert(full));
    return full;
  }, [dispatch]);

  const getMarketData = useCallback((symbol: string) => marketDataMap.get(symbol), [marketDataMap]);
  const getCandlesticks = useCallback((symbol: string) => candlesticksMap.get(symbol) ?? [], [candlesticksMap]);
  const getOrderBook = useCallback((symbol: string) => orderBooksMap.get(symbol) ?? [], [orderBooksMap]);

  // ── Keep a ref of current entities for use inside the rAF loop ────────────
  const entitiesRef = useRef(marketEntities);
  useEffect(() => {
    entitiesRef.current = marketEntities;
  }, [marketEntities]);

  // ── Mock WebSocket simulation (replaced by real WS in Phase 1.4) ──────────
  const frameRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    dispatch(rtkSetConnected(true));

    // Initialize focus list once
    dispatch(setFocusList(generateInitialFocusList(entitiesRef.current)));

    // Initialize order books with prices from market entities
    SYMBOLS.forEach(symbol => {
      const price = entitiesRef.current[symbol]?.price ?? 100;
      dispatch(setOrderBook({ symbol, entries: generateMockOrderBook(price) }));
    });

    const updateData = () => {
      const now = Date.now();

      if (now - lastUpdateRef.current > 100) {
        const updates: MarketData[] = [];

        SYMBOLS.forEach(symbol => {
          const currentData = entitiesRef.current[symbol];
          if (currentData) {
            const priceChange = (Math.random() - 0.5) * 0.5;
            const newPrice = Math.max(0.01, currentData.price + priceChange);
            const newChange = newPrice - currentData.open;
            updates.push({
              ...currentData,
              price: newPrice,
              change: newChange,
              changePercent: (newChange / currentData.open) * 100,
              bid: newPrice - 0.01,
              ask: newPrice + 0.01,
              bidSize: Math.floor(Math.random() * 1000) + 100,
              askSize: Math.floor(Math.random() * 1000) + 100,
              timestamp: now,
            });
          }
        });

        if (updates.length) dispatch(batchUpdateMarketData(updates));
        lastUpdateRef.current = now;
      }

      frameRef.current = requestAnimationFrame(updateData);
    };

    frameRef.current = requestAnimationFrame(updateData);
    return () => cancelAnimationFrame(frameRef.current);
  // Run once on mount only — entities are read via ref
  }, [dispatch]);

  // ── Stats updater ─────────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      dispatch(rtkSetStats({
        fps: Math.floor(58 + Math.random() * 4),
        memoryUsage: mem ? Math.round(mem.usedJSHeapSize / 1_048_576) : Math.floor(50 + Math.random() * 100),
        wsLatency: Math.floor(10 + Math.random() * 50),
        renderTime: Math.floor(8 + Math.random() * 10),
        lastUpdate: Date.now(),
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, [dispatch]);

  // ── Alert cleanup — remove stale triggered alerts after 5s ───────────────
  useEffect(() => {
    const triggered = alerts.filter(a => a.triggered);
    if (!triggered.length) return;
    const timer = setTimeout(() => {
      triggered.forEach(a => dispatch(removePriceAlert(a.id)));
    }, 5000);
    return () => clearTimeout(timer);
  }, [alerts, dispatch]);

  // ── Context value ─────────────────────────────────────────────────────────
  const value: MarketContextType = {
    state: {
      marketData: marketDataMap,
      candlesticks: candlesticksMap,
      orderBooks: orderBooksMap,
      positions,
      focusList,
      currentPhase,
      selectedSymbol,
      marketRegime,
      stats,
      panels,
      workspaces,
      currentWorkspaceId,
      alerts,
      isConnected,
      lastUpdate,
    },
    dispatch,
    updateMarketData,
    setSelectedSymbol,
    setPhase,
    updatePanels,
    saveWorkspace,
    loadWorkspace,
    deleteWorkspace,
    addAlert,
    getMarketData,
    getCandlesticks,
    getOrderBook,
  };

  return (
    <MarketContext.Provider value={value}>
      {children}
    </MarketContext.Provider>
  );
}

export function useMarket() {
  const context = useContext(MarketContext);
  if (!context) throw new Error('useMarket must be used within a MarketProvider');
  return context;
}

// ── Re-exported constants ─────────────────────────────────────────────────────
export { DEFAULT_PANELS } from './slices/panelsSlice';

export const TRADING_PHASES: TradingPhase[] = [
  { id: 'pre-market', name: 'PRE-MARKET', description: 'Scanner results & preparation', startTime: '04:00', endTime: '09:30', maxFocusItems: 12 },
  { id: 'open', name: 'OPEN', description: 'Top 3 names only - execution mode', startTime: '09:30', endTime: '11:00', maxFocusItems: 3 },
  { id: 'midday', name: 'MIDDAY', description: 'Position management & monitoring', startTime: '11:00', endTime: '15:00', maxFocusItems: 6 },
  { id: 'power-hour', name: 'POWER HOUR', description: 'Reversion & continuation plays', startTime: '15:00', endTime: '16:00', maxFocusItems: 5 },
];

export const MORNING_BRIEF_TEMPLATES = [
  { id: 'momentum', name: 'US EQUITIES MOMENTUM', description: 'High volume breakouts with strong relative strength', filters: { minVolume: 1_000_000, patterns: ['breakout', 'gap-up'] } },
  { id: 'earnings', name: 'EARNINGS PLAYBOOK', description: 'Pre/post earnings momentum plays', filters: { patterns: ['earnings-gap', 'volatility-expansion'] } },
  { id: 'macro', name: 'MACRO + ETFS', description: 'Sector rotation and macro-driven moves', filters: { sectors: ['ETF'], patterns: ['sector-rotation'] } },
];
