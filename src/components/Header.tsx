import { useState, useRef, useEffect } from 'react';
import { TRADING_PHASES } from '@/store';
import { useAppSelector, useMarketActions } from '@/store/hooks';
import { useUIStore } from '@/store/uiStore';
import { NotificationCenter } from './NotificationCenter';
import { selectCurrentPhase, selectMarketRegime, selectStats } from '@/store/selectors';
import { 
  Search, 
  Settings, 
  Bell, 
  User, 
  ChevronDown,
  Zap
} from 'lucide-react';

export function Header() {
  const currentPhaseId = useAppSelector(selectCurrentPhase);
  const marketRegime = useAppSelector(selectMarketRegime);
  const { setPhase } = useMarketActions();
  const toggleSettings = useUIStore(s => s.toggleSettings);
  const toggleCommandPalette = useUIStore(s => s.toggleCommandPalette);
  const goToLanding = useUIStore(s => s.goToLanding);
  const notificationCount = useUIStore(s => s.notifications.length);
  const [showNotifications, setShowNotifications] = useState(false);
  // Store clock rather than Date.now(): reading the wall clock during render
  // is impure, and this already ticks once a second.
  const lastUpdate = useAppSelector(selectStats).lastUpdate;
  const [showPhaseMenu, setShowPhaseMenu] = useState(false);
  const phaseMenuRef = useRef<HTMLDivElement>(null);

  const currentPhase = TRADING_PHASES.find(p => p.id === currentPhaseId);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (phaseMenuRef.current && !phaseMenuRef.current.contains(e.target as Node)) {
        setShowPhaseMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="h-14 bg-vanna-surface/90 backdrop-blur-xl border-b border-white/5 flex items-center justify-between px-4 sticky top-0 z-50">
      {/* Left: Logo */}
      <div className="flex items-center gap-4">
        <button 
          onClick={goToLanding}
          className="flex items-center gap-2 group"
          aria-label="Return to landing page"
        >
          <span 
            className="text-xl font-bold tracking-tight text-vanna-gold group-hover:text-vanna-gold/80 transition-colors"
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
            VANNA
          </span>
          <span className="terminal-text text-[10px] text-vanna-text-secondary hidden sm:inline">
            γ
          </span>
        </button>

        {/* Phase selector */}
        <div className="relative" ref={phaseMenuRef}>
          <button
            onClick={() => setShowPhaseMenu(!showPhaseMenu)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-vanna-surface-light/50 
                       border border-white/5 hover:border-vanna-cyan/30 transition-all"
            aria-expanded={showPhaseMenu}
            aria-haspopup="listbox"
          >
            <Zap className="w-3.5 h-3.5 text-vanna-cyan" />
            <span className="terminal-text text-xs text-vanna-text">
              {currentPhase?.name}
            </span>
            <ChevronDown className={`w-3 h-3 text-vanna-text-secondary transition-transform ${showPhaseMenu ? 'rotate-180' : ''}`} />
          </button>

          {showPhaseMenu && (
            <div 
              className="absolute top-full left-0 mt-1 w-56 glass-panel py-1 z-50"
              role="listbox"
            >
              {TRADING_PHASES.map((phase) => (
                <button
                  key={phase.id}
                  onClick={() => {
                    setPhase(phase.id);
                    setShowPhaseMenu(false);
                  }}
                  className={`w-full px-3 py-2 text-left hover:bg-white/5 transition-colors
                    ${currentPhaseId === phase.id ? 'bg-vanna-cyan/10' : ''}`}
                  role="option"
                  aria-selected={currentPhaseId === phase.id}
                >
                  <div className="flex items-center justify-between">
                    <span className="terminal-text text-xs text-vanna-text">{phase.name}</span>
                    <span className="terminal-text text-[10px] text-vanna-text-secondary">
                      {phase.startTime}-{phase.endTime}
                    </span>
                  </div>
                  <p className="text-[10px] text-vanna-text-secondary mt-0.5">
                    {phase.description}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Center: Search */}
      <div className="flex-1 max-w-xl mx-4 hidden md:block">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-vanna-text-secondary" />
          {/* Opens the command palette rather than being a second, half-built
              search. The palette already does symbol lookup and is tested, and
              the shortcut badge on the right has been advertising it all along
              — this input just swallowed keystrokes and did nothing with them. */}
          <button
            type="button"
            onClick={toggleCommandPalette}
            aria-label="Search symbols"
            aria-keyshortcuts="Meta+K Control+K"
            className="w-full text-left bg-vanna-surface-light/50 border border-white/5 rounded-md
                       pl-10 pr-20 py-2 text-sm text-vanna-text-secondary/50
                       hover:border-vanna-cyan/30 focus:outline-none focus:border-vanna-cyan/30
                       focus:ring-1 focus:ring-vanna-cyan/20 transition-all"
          >
            Search symbol, sector, or setup...
          </button>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 text-[10px] bg-vanna-surface border border-white/10 rounded text-vanna-text-secondary">
              ⌘
            </kbd>
            <kbd className="px-1.5 py-0.5 text-[10px] bg-vanna-surface border border-white/10 rounded text-vanna-text-secondary">
              K
            </kbd>
          </div>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Orb status indicator */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-md bg-vanna-surface-light/30">
          <span className="text-vanna-cyan text-xs" aria-hidden="true">●</span>
          <div className="flex flex-col">
            <span className="terminal-text text-[10px] text-vanna-text-secondary">REGIME</span>
            <span className={`terminal-text text-[10px] ${
              marketRegime.trend === 'bullish' ? 'text-vanna-green' :
              marketRegime.trend === 'bearish' ? 'text-vanna-red' :
              'text-vanna-gold'
            }`}>
              {marketRegime.trend.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Notifications */}
        <div className="relative">
        <button
          onClick={() => setShowNotifications(v => !v)}
          className="relative p-2 rounded-md hover:bg-white/5 transition-colors"
          aria-label="Notifications"
          aria-expanded={showNotifications}
        >
          <Bell className="w-4 h-4 text-vanna-text-secondary" />
          {/* Was always on, so it permanently implied unread items. */}
          {notificationCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-vanna-red rounded-full" />
          )}
        </button>
        <NotificationCenter
          open={showNotifications}
          onClose={() => setShowNotifications(false)}
          now={lastUpdate}
        />
        </div>

        {/* Settings */}
        <button
          onClick={toggleSettings}
          className="p-2 rounded-md hover:bg-white/5 transition-colors"
          aria-label="Settings"
        >
          <Settings className="w-4 h-4 text-vanna-text-secondary" />
        </button>

        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-white/10" aria-label="Paper demo account">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-vanna-cyan/30 to-vanna-gold/30 
                            flex items-center justify-center border border-white/10">
              <User className="w-4 h-4 text-vanna-text" />
            </div>
            <span className="hidden lg:inline terminal-text text-[10px] text-vanna-text-secondary">DEMO</span>
        </div>
      </div>
    </header>
  );
}
