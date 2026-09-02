import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import type { UserSettings } from '@/types';

interface UIState {
  // Navigation
  currentView: 'landing' | 'dashboard' | 'morning-brief';
  
  // Modals & Overlays
  showCommandPalette: boolean;
  showSettings: boolean;
  showKeyboardShortcuts: boolean;
  
  // Sidebar & Panels
  sidebarCollapsed: boolean;
  activePanel: string | null;
  
  // Search
  searchQuery: string;
  searchResults: string[];
  
  // Settings
  settings: UserSettings;
  
  // Notifications
  notifications: Notification[];
  
  // Loading states
  isLoading: boolean;
  loadingMessage: string;
  
  // Orb state
  orbPressed: boolean;
  orbPressProgress: number;
}

interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

type UIAction =
  | { type: 'SET_VIEW'; payload: UIState['currentView'] }
  | { type: 'TOGGLE_COMMAND_PALETTE' }
  | { type: 'TOGGLE_SETTINGS' }
  | { type: 'TOGGLE_KEYBOARD_SHORTCUTS' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_ACTIVE_PANEL'; payload: string | null }
  | { type: 'SET_SEARCH_QUERY'; payload: string }
  | { type: 'SET_SEARCH_RESULTS'; payload: string[] }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<UserSettings> }
  | { type: 'ADD_NOTIFICATION'; payload: Omit<Notification, 'id' | 'timestamp'> }
  | { type: 'REMOVE_NOTIFICATION'; payload: string }
  | { type: 'SET_LOADING'; payload: { isLoading: boolean; message?: string } }
  | { type: 'SET_ORB_PRESSED'; payload: boolean }
  | { type: 'SET_ORB_PRESS_PROGRESS'; payload: number };

const initialSettings: UserSettings = {
  highContrastMode: false,
  soundEnabled: true,
  notificationsEnabled: true,
  defaultTimeframe: '5m',
  riskPerTrade: 1,
};

const initialState: UIState = {
  currentView: 'landing',
  showCommandPalette: false,
  showSettings: false,
  showKeyboardShortcuts: false,
  sidebarCollapsed: false,
  activePanel: null,
  searchQuery: '',
  searchResults: [],
  settings: initialSettings,
  notifications: [],
  isLoading: false,
  loadingMessage: '',
  orbPressed: false,
  orbPressProgress: 0,
};

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, currentView: action.payload };
    case 'TOGGLE_COMMAND_PALETTE':
      return { ...state, showCommandPalette: !state.showCommandPalette };
    case 'TOGGLE_SETTINGS':
      return { ...state, showSettings: !state.showSettings };
    case 'TOGGLE_KEYBOARD_SHORTCUTS':
      return { ...state, showKeyboardShortcuts: !state.showKeyboardShortcuts };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarCollapsed: !state.sidebarCollapsed };
    case 'SET_ACTIVE_PANEL':
      return { ...state, activePanel: action.payload };
    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.payload };
    case 'SET_SEARCH_RESULTS':
      return { ...state, searchResults: action.payload };
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.payload } };
    case 'ADD_NOTIFICATION': {
      const newNotification: Notification = {
        ...action.payload,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
      };
      return { ...state, notifications: [newNotification, ...state.notifications].slice(0, 10) };
    }
    case 'REMOVE_NOTIFICATION':
      return { ...state, notifications: state.notifications.filter(n => n.id !== action.payload) };
    case 'SET_LOADING':
      return { 
        ...state, 
        isLoading: action.payload.isLoading, 
        loadingMessage: action.payload.message || '' 
      };
    case 'SET_ORB_PRESSED':
      return { ...state, orbPressed: action.payload };
    case 'SET_ORB_PRESS_PROGRESS':
      return { ...state, orbPressProgress: action.payload };
    default:
      return state;
  }
}

interface UIContextType {
  state: UIState;
  dispatch: React.Dispatch<UIAction>;
  // Actions
  setView: (view: UIState['currentView']) => void;
  toggleCommandPalette: () => void;
  toggleSettings: () => void;
  toggleKeyboardShortcuts: () => void;
  toggleSidebar: () => void;
  setSearchQuery: (query: string) => void;
  updateSettings: (settings: Partial<UserSettings>) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  setLoading: (isLoading: boolean, message?: string) => void;
  enterDashboard: () => void;
  goToLanding: () => void;
}

const UIContext = createContext<UIContextType | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(uiReducer, initialState);

  const setView = useCallback((view: UIState['currentView']) => {
    dispatch({ type: 'SET_VIEW', payload: view });
  }, []);

  const toggleCommandPalette = useCallback(() => {
    dispatch({ type: 'TOGGLE_COMMAND_PALETTE' });
  }, []);

  const toggleSettings = useCallback(() => {
    dispatch({ type: 'TOGGLE_SETTINGS' });
  }, []);

  const toggleKeyboardShortcuts = useCallback(() => {
    dispatch({ type: 'TOGGLE_KEYBOARD_SHORTCUTS' });
  }, []);

  const toggleSidebar = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  }, []);

  const setSearchQuery = useCallback((query: string) => {
    dispatch({ type: 'SET_SEARCH_QUERY', payload: query });
  }, []);

  const updateSettings = useCallback((settings: Partial<UserSettings>) => {
    dispatch({ type: 'UPDATE_SETTINGS', payload: settings });
  }, []);

  const addNotification = useCallback((notification: Omit<Notification, 'id' | 'timestamp'>) => {
    dispatch({ type: 'ADD_NOTIFICATION', payload: notification });
  }, []);

  const removeNotification = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_NOTIFICATION', payload: id });
  }, []);

  const setLoading = useCallback((isLoading: boolean, message?: string) => {
    dispatch({ type: 'SET_LOADING', payload: { isLoading, message } });
  }, []);

  const enterDashboard = useCallback(() => {
    dispatch({ type: 'SET_LOADING', payload: { isLoading: true, message: 'Initializing trading terminal...' } });
    setTimeout(() => {
      dispatch({ type: 'SET_VIEW', payload: 'dashboard' });
      dispatch({ type: 'SET_LOADING', payload: { isLoading: false } });
      dispatch({ type: 'ADD_NOTIFICATION', payload: { type: 'success', message: 'Welcome to VANNA Trading Terminal' } });
    }, 1500);
  }, []);

  const goToLanding = useCallback(() => {
    dispatch({ type: 'SET_VIEW', payload: 'landing' });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command palette: ?
      if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        toggleKeyboardShortcuts();
      }
      
      // Command palette: Cmd/Ctrl + K
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommandPalette();
      }
      
      // Escape to close modals
      if (e.key === 'Escape') {
        if (state.showCommandPalette) {
          dispatch({ type: 'TOGGLE_COMMAND_PALETTE' });
        } else if (state.showKeyboardShortcuts) {
          dispatch({ type: 'TOGGLE_KEYBOARD_SHORTCUTS' });
        } else if (state.showSettings) {
          dispatch({ type: 'TOGGLE_SETTINGS' });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.showCommandPalette, state.showKeyboardShortcuts, state.showSettings, toggleCommandPalette, toggleKeyboardShortcuts]);

  const value: UIContextType = {
    state,
    dispatch,
    setView,
    toggleCommandPalette,
    toggleSettings,
    toggleKeyboardShortcuts,
    toggleSidebar,
    setSearchQuery,
    updateSettings,
    addNotification,
    removeNotification,
    setLoading,
    enterDashboard,
    goToLanding,
  };

  return (
    <UIContext.Provider value={value}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return context;
}

// Keyboard shortcuts definition
export const KEYBOARD_SHORTCUTS = [
  { key: '?', description: 'Show keyboard shortcuts' },
  { key: 'Cmd/Ctrl + K', description: 'Open command palette' },
  { key: 'J', description: 'Navigate focus list down' },
  { key: 'K', description: 'Navigate focus list up' },
  { key: 'Space', description: 'Stage ticket' },
  { key: 'Enter', description: 'Execute order' },
  { key: 'A', description: 'Set alert' },
  { key: 'D', description: 'Dismiss item' },
  { key: 'Tab', description: 'Switch phase mode' },
  { key: 'Esc', description: 'Close modal / Cancel' },
  { key: '1-4', description: 'Switch to phase 1-4' },
];
