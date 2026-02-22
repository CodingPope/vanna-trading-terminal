import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserSettings } from '@/types';

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: number;
}

interface UIStoreState {
  // Navigation
  currentView: 'landing' | 'dashboard' | 'morning-brief';
  setView: (view: UIStoreState['currentView']) => void;
  enterDashboard: () => void;
  goToLanding: () => void;

  // Modals
  showCommandPalette: boolean;
  showSettings: boolean;
  showKeyboardShortcuts: boolean;
  toggleCommandPalette: () => void;
  toggleSettings: () => void;
  toggleKeyboardShortcuts: () => void;
  closeAllModals: () => void;

  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Active panel
  activePanel: string | null;
  setActivePanel: (id: string | null) => void;

  // Search
  searchQuery: string;
  searchResults: string[];
  setSearchQuery: (q: string) => void;
  setSearchResults: (r: string[]) => void;

  // Settings
  settings: UserSettings;
  updateSettings: (s: Partial<UserSettings>) => void;

  // Notifications
  notifications: Notification[];
  addNotification: (n: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;

  // Orb
  orbPressed: boolean;
  orbPressProgress: number;
  setOrbPressed: (v: boolean) => void;
  setOrbPressProgress: (v: number) => void;

  // Loading
  isLoading: boolean;
  loadingMessage: string;
  setLoading: (loading: boolean, message?: string) => void;
}

export const useUIStore = create<UIStoreState>()(
  persist(
    (set, get) => ({
      // Navigation
      currentView: 'landing',
      setView: (view) => set({ currentView: view }),
      enterDashboard: () => {
        set({ isLoading: true, loadingMessage: 'Initializing trading terminal...' });
        setTimeout(() => {
          set({ currentView: 'dashboard', isLoading: false, loadingMessage: '' });
          get().addNotification({ type: 'success', message: 'Welcome to VANNA Trading Terminal' });
        }, 1500);
      },
      goToLanding: () => set({ currentView: 'landing' }),

      // Modals
      showCommandPalette: false,
      showSettings: false,
      showKeyboardShortcuts: false,
      toggleCommandPalette: () => set(s => ({ showCommandPalette: !s.showCommandPalette })),
      toggleSettings: () => set(s => ({ showSettings: !s.showSettings })),
      toggleKeyboardShortcuts: () => set(s => ({ showKeyboardShortcuts: !s.showKeyboardShortcuts })),
      closeAllModals: () => set({ showCommandPalette: false, showSettings: false, showKeyboardShortcuts: false }),

      // Sidebar
      sidebarCollapsed: false,
      toggleSidebar: () => set(s => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      // Active panel
      activePanel: null,
      setActivePanel: (id) => set({ activePanel: id }),

      // Search
      searchQuery: '',
      searchResults: [],
      setSearchQuery: (q) => set({ searchQuery: q }),
      setSearchResults: (r) => set({ searchResults: r }),

      // Settings
      settings: {
        highContrastMode: false,
        soundEnabled: true,
        notificationsEnabled: true,
        defaultTimeframe: '5m',
        riskPerTrade: 1,
      },
      updateSettings: (s) => set(state => ({ settings: { ...state.settings, ...s } })),

      // Notifications
      notifications: [],
      addNotification: (n) =>
        set(state => ({
          notifications: [
            { ...n, id: Math.random().toString(36).slice(2, 9), timestamp: Date.now() },
            ...state.notifications,
          ].slice(0, 10),
        })),
      removeNotification: (id) =>
        set(state => ({ notifications: state.notifications.filter(n => n.id !== id) })),

      // Orb
      orbPressed: false,
      orbPressProgress: 0,
      setOrbPressed: (v) => set({ orbPressed: v }),
      setOrbPressProgress: (v) => set({ orbPressProgress: v }),

      // Loading
      isLoading: false,
      loadingMessage: '',
      setLoading: (loading, message = '') => set({ isLoading: loading, loadingMessage: message }),
    }),
    {
      name: 'vanna:ui',
      // Only persist user-configured state, not transient UI state
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        settings: state.settings,
      }),
    }
  )
);
