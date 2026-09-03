import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useKeyboard } from '@/hooks/useKeyboard';
import { DEFAULT_PANELS } from '@/store/slices/panelsSlice';
import { useAppSelector, useMarketActions, useWorkspaceActions } from '@/store/hooks';
import { selectPanels, selectWorkspaces, selectCurrentWorkspaceId } from '@/store/selectors';
import { Header } from '@/components/Header';
import { StatsFooter } from '@/components/StatsFooter';
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts';
import { CommandPalette } from '@/components/CommandPalette';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Notifications } from '@/components/Notifications';
import { WatchlistPanel } from '@/components/panels/WatchlistPanel';
import { ChartPanel } from '@/components/panels/ChartPanel';
import { OrderBookPanel } from '@/components/panels/OrderBookPanel';
import { PositionsPanel } from '@/components/panels/PositionsPanel';
import { AnaPanel } from '@/components/panels/AnaPanel';
import { FocusListPanel } from '@/components/panels/FocusListPanel';
import { MorningBriefPanel } from '@/components/panels/MorningBriefPanel';
import { TickerPanel } from '@/components/panels/TickerPanel';
import { TradesPanel } from '@/components/panels/TradesPanel';
import { DepthPanel } from '@/components/panels/DepthPanel';
import { DepthChartPanel } from '@/components/panels/DepthChartPanel';
import type { Panel } from '@/types';

// Panel component mapping
// Panels are rendered without props; every prop any of them accepts is optional.
type PanelComponentProps = {
  symbol?: string;
  compact?: boolean;
  onSelectSymbol?: (symbol: string) => void;
};

const PANEL_COMPONENTS: Record<Panel['type'], React.ComponentType<PanelComponentProps>> = {
  watchlist: WatchlistPanel,
  ticker: TickerPanel,
  chart: ChartPanel,
  orderbook: OrderBookPanel,
  depth: DepthPanel,
  'depth-chart': DepthChartPanel,
  trades: TradesPanel,
  positions: PositionsPanel,
  ana: AnaPanel,
  'focus-list': FocusListPanel,
  'morning-brief': MorningBriefPanel,
};

interface DraggablePanelProps {
  panel: Panel;
  onUpdate: (panel: Panel) => void;
  children: React.ReactNode;
  canDrag: boolean;
  canResize: boolean;
}

const MIN_PANEL_WIDTH = 240;
const MIN_PANEL_HEIGHT = 160;

function DraggablePanel({ panel, onUpdate, children, canDrag, canResize }: DraggablePanelProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!canDrag) return;
    if ((e.target as HTMLElement).closest('.drag-handle')) {
      setIsDragging(true);
      setDragOffset({
        x: e.clientX - panel.x,
        y: e.clientY - panel.y,
      });
    }
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const dx = e.clientX - resizeStartRef.current.x;
      const dy = e.clientY - resizeStartRef.current.y;
      const maxWidth = Math.max(MIN_PANEL_WIDTH, window.innerWidth - panel.x - 24);
      const maxHeight = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - panel.y - 72);
      onUpdate({
        ...panel,
        width: Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, resizeStartRef.current.width + dx)),
        height: Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, resizeStartRef.current.height + dy)),
      });
      return;
    }

    if (isDragging) {
      onUpdate({
        ...panel,
        x: Math.max(0, e.clientX - dragOffset.x),
        y: Math.max(0, e.clientY - dragOffset.y),
      });
    }
  }, [isDragging, isResizing, dragOffset, panel, onUpdate]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(false);
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!canResize) return;
    e.preventDefault();
    e.stopPropagation();
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: panel.width,
      height: panel.height,
    };
    setIsResizing(true);
  }, [canResize, panel.width, panel.height]);

  React.useEffect(() => {
    if (!isDragging && !isResizing) return;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  return (
    <div
      className={`absolute glass-panel overflow-hidden flex flex-col transition-shadow
        ${(isDragging || isResizing) ? 'shadow-glow-cyan z-50' : 'hover:shadow-glow-cyan/50'}
        ${panel.minimized ? 'h-10' : ''}`}
      style={{
        left: panel.x,
        top: panel.y,
        width: panel.width,
        height: panel.minimized ? 40 : panel.height,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-vanna-surface-light/30 cursor-default">
        <div className={`flex items-center gap-2 drag-handle ${canDrag ? 'cursor-move' : 'cursor-default'}`}>
          <div className="w-1 h-4 rounded-full bg-vanna-text-secondary/30" />
          <span className="text-[10px] text-vanna-text-secondary uppercase tracking-wider font-semibold">
            {panel.title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onUpdate({ ...panel, minimized: !panel.minimized })}
            className="p-1 rounded hover:bg-white/5 transition-colors"
            aria-label={panel.minimized ? 'Maximize' : 'Minimize'}
          >
            <div className={`w-3 h-0.5 bg-vanna-text-secondary transition-all ${panel.minimized ? 'rotate-0' : '-rotate-90'}`} />
          </button>
        </div>
      </div>
      
      {/* Panel content */}
      {!panel.minimized && (
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      )}

      {!panel.minimized && canResize && (
        <button
          type="button"
          aria-label="Resize panel"
          onMouseDown={handleResizeMouseDown}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize bg-transparent"
        >
          <span className="absolute bottom-1 right-1 w-2 h-2 border-r border-b border-vanna-text-secondary/70" />
        </button>
      )}
    </div>
  );
}

export function Dashboard() {
  useKeyboard();
  const panels = useAppSelector(selectPanels);
  const workspaces = useAppSelector(selectWorkspaces);
  const currentWorkspaceId = useAppSelector(selectCurrentWorkspaceId);
  const { updatePanels } = useMarketActions();
  const { saveWorkspace, loadWorkspace, deleteWorkspace } = useWorkspaceActions();
  const [layoutMode, setLayoutMode] = useState<'grid' | 'free'>(() => {
    const stored = localStorage.getItem('vanna:layout-mode');
    return stored === 'grid' || stored === 'free' ? stored : 'free';
  });
  useEffect(() => {
    localStorage.setItem('vanna:layout-mode', layoutMode);
  }, [layoutMode]);

  const handleResetLayout = () => {
    const confirmReset = window.confirm('Reset panels to default layout? This will overwrite your current workspace.');
    if (!confirmReset) return;
    const freshPanels = DEFAULT_PANELS.map(p => ({ ...p }));
    updatePanels(freshPanels);
    setLayoutMode('grid');
  };

  const handleSaveWorkspace = () => {
    const name = window.prompt('Workspace name');
    if (!name) return;
    const ws = saveWorkspace(name, layoutMode);
    if (ws) {
      localStorage.setItem('vanna:layout-mode', ws.layoutMode);
    }
  };

  const handleLoadWorkspace = (id: string) => {
    const ws = loadWorkspace(id);
    if (ws) {
      setLayoutMode(ws.layoutMode);
      localStorage.setItem('vanna:layout-mode', ws.layoutMode);
    }
  };

  const handleDeleteWorkspace = () => {
    if (!currentWorkspaceId) return;
    const confirmDelete = window.confirm('Delete this workspace?');
    if (!confirmDelete) return;
    deleteWorkspace(currentWorkspaceId);
  };

  const handlePanelUpdate = useCallback((updatedPanel: Panel) => {
    const newPanels = panels.map(p => 
      p.id === updatedPanel.id ? updatedPanel : p
    );
    updatePanels(newPanels);
  }, [panels, updatePanels]);

  // Grid layout positions
  const gridLayout = [
    { id: 'watchlist', x: 0, y: 0, width: 280, height: 420 },
    { id: 'ticker', x: 0, y: 430, width: 280, height: 200 },
    { id: 'focus-list', x: 0, y: 640, width: 280, height: 210 },
    { id: 'chart', x: 290, y: 0, width: 560, height: 430 },
    { id: 'depth-chart', x: 290, y: 440, width: 560, height: 200 },
    { id: 'ana', x: 290, y: 650, width: 270, height: 200 },
    { id: 'trades', x: 570, y: 650, width: 280, height: 200 },
    { id: 'orderbook', x: 860, y: 0, width: 260, height: 430 },
    { id: 'depth', x: 860, y: 440, width: 260, height: 200 },
    { id: 'positions', x: 860, y: 650, width: 260, height: 200 },
  ];

  return (
    <div className="h-screen flex flex-col bg-vanna-bg">
      <Header />
      
      {/* Main content area */}
      <main className="flex-1 relative overflow-hidden">
        {/* Workspace controls. Sits in its own band rather than floating over
            the canvas: the panel container below is inset-0, so anything
            positioned near the top right (the order book, at x:860 y:0) was
            rendering underneath these buttons. */}
        <div className="absolute top-0 left-0 right-0 h-10 z-20 flex items-center justify-end gap-1 px-2 bg-vanna-surface/80 backdrop-blur-sm border-b border-white/5">
          <button
            onClick={() => setLayoutMode('grid')}
            className={`px-2 py-1 text-[10px] rounded transition-colors
              ${layoutMode === 'grid' ? 'bg-vanna-cyan/20 text-vanna-cyan' : 'text-vanna-text-secondary hover:text-vanna-text'}`}
          >
            Grid
          </button>
          <button
            onClick={() => setLayoutMode('free')}
            className={`px-2 py-1 text-[10px] rounded transition-colors
              ${layoutMode === 'free' ? 'bg-vanna-cyan/20 text-vanna-cyan' : 'text-vanna-text-secondary hover:text-vanna-text'}`}
          >
            Free
          </button>
          <button
            onClick={handleResetLayout}
            className="ml-2 px-2 py-1 text-[10px] rounded border border-white/10 text-vanna-text-secondary hover:text-white hover:border-vanna-cyan/40 transition-colors"
          >
            Reset
          </button>
          <select
            value={currentWorkspaceId || ''}
            onChange={(e) => handleLoadWorkspace(e.target.value)}
            className="ml-2 px-2 py-1 text-[10px] rounded bg-vanna-surface-light/40 border border-white/10 text-vanna-text"
          >
            <option value="" disabled>Select workspace</option>
            {workspaces.map(ws => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </select>
          <button
            onClick={handleSaveWorkspace}
            className="px-2 py-1 text-[10px] rounded border border-vanna-cyan/30 text-vanna-cyan hover:border-vanna-cyan/60 transition-colors"
          >
            Save
          </button>
          <button
            onClick={handleDeleteWorkspace}
            className="px-2 py-1 text-[10px] rounded border border-white/10 text-vanna-text-secondary hover:text-vanna-red hover:border-vanna-red/60 transition-colors"
          >
            Delete
          </button>
        </div>

        {/* Panels container — starts below the workspace controls band. */}
        <div className="absolute inset-x-0 bottom-0 top-10 p-4 overflow-auto">
          {panels.map((panel) => {
            const PanelComponent = PANEL_COMPONENTS[panel.type];
            if (!PanelComponent) return null;

            const layout = gridLayout.find(l => l.id === panel.id);
            const displayPanel = layoutMode === 'grid' && layout 
              ? { ...panel, ...layout } 
              : panel;

            return (
              <DraggablePanel
                key={panel.id}
                panel={displayPanel}
                onUpdate={handlePanelUpdate}
                canDrag={layoutMode === 'free'}
                canResize={layoutMode === 'free'}
              >
                <PanelComponent />
              </DraggablePanel>
            );
          })}
        </div>
      </main>

      <StatsFooter />
      
      {/* Overlays */}
      <KeyboardShortcuts />
      <SettingsDialog />
      <CommandPalette />
      <Notifications />
    </div>
  );
}
