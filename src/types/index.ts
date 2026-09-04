// VANNA Trading Dashboard Types

export interface MarketData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  close: number;
  timestamp: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
}

export interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OrderBookEntry {
  price: number;
  size: number;
  total: number;
  side: 'bid' | 'ask';
}

export interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}

export interface AnaAnalysis {
  symbol: string;
  setupType: 'breakout' | 'pullback' | 'reversal' | 'continuation' | 'range';
  triggerPrice: number;
  invalidationLevel: number;
  targetPrice: number;
  regimeFit: 'strong' | 'moderate' | 'weak';
  riskRewardRatio: number;
  verdict: 'VALID' | 'NO_TRADE' | 'STANDBY';
  confidence: number;
  notes: string;
}

export interface FocusItem {
  symbol: string;
  name: string;
  sector: string;
  setupQuality: number; // 0-100
  anaAnalysis: AnaAnalysis;
  marketData: MarketData;
  tags: string[];
}

export interface TradingPhase {
  id: 'pre-market' | 'open' | 'midday' | 'power-hour';
  name: string;
  description: string;
  startTime: string;
  endTime: string;
  maxFocusItems: number;
}

export interface MorningBriefTemplate {
  id: string;
  name: string;
  description: string;
  filters: {
    sectors?: string[];
    minVolume?: number;
    minPrice?: number;
    maxPrice?: number;
    patterns?: string[];
  };
}

export interface StatsForNerds {
  fps: number;
  memoryUsage: number;
  wsLatency: number;
  renderTime: number;
  lastUpdate: number;
}

/**
 * A time & sales print.
 *
 * `side` is the aggressor: which party crossed the spread to make it happen.
 * A print at the ask is a buy, at the bid a sell. That is what makes tape bias
 * readable — it is not the direction of the price, it is who was impatient.
 */
export interface Trade {
  id: string;
  symbol: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  timestamp: number;
}

export interface UserSettings {
  highContrastMode: boolean;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  defaultTimeframe: '1m' | '5m' | '15m' | '1h' | '1d';
  riskPerTrade: number;
}

export type PanelType = 
  | 'watchlist' 
  | 'ticker'
  | 'chart' 
  | 'orderbook' 
  | 'depth'
  | 'depth-chart'
  | 'trades'
  | 'positions' 
  | 'ana' 
  | 'focus-list' 
  | 'morning-brief';

export interface Panel {
  id: string;
  type: PanelType;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  panels: Panel[];
  layoutMode: 'grid' | 'free';
  createdAt: number;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  price: number;
  note?: string;
  createdAt: number;
  triggered: boolean;
}

export interface KeyboardShortcut {
  key: string;
  modifier?: 'ctrl' | 'alt' | 'shift' | 'meta';
  description: string;
  action: () => void;
}

export interface MarketRegime {
  trend: 'bullish' | 'bearish' | 'neutral';
  volatility: 'high' | 'medium' | 'low';
  breadth: 'strong' | 'weak' | 'mixed';
  sentiment: 'greed' | 'fear' | 'neutral';
}

export interface ScannerResult {
  symbol: string;
  score: number;
  criteria: string[];
  timestamp: number;
}

// ── Discriminated Unions ──────────────────────────────────────────────────────

export type OrderStatus =
  | { status: 'pending' }
  | { status: 'filled'; fillPrice: number; fillTime: number }
  | { status: 'cancelled'; reason: string }
  | { status: 'rejected'; reason: string };

export type AnaVerdict = 'VALID' | 'NO_TRADE' | 'STANDBY';

export type AnaRegimeFit = 'strong' | 'moderate' | 'weak';

export type SetupType = 'breakout' | 'pullback' | 'reversal' | 'continuation' | 'range';

// ── Template Literal Types ────────────────────────────────────────────────────

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

/** All supported trading symbols are uppercase strings */
export type SymbolKey = Uppercase<string>;

/** Canonical price pair format e.g. "AAPL/USD" */
export type TradingPair = `${string}/${string}`;

/** Panel IDs are prefixed with "panel_" */
export type PanelId = `panel_${string}`;

/** Workspace IDs are prefixed with "ws_" */
export type WorkspaceId = `ws_${string}`;

/** Alert IDs are prefixed with "al_" */
export type AlertId = `al_${string}`;
