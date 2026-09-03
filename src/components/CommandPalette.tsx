import { useState, useEffect, useRef } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useAppSelector, useMarketActions } from '@/store/hooks';
import { selectMarketDataMap } from '@/store/selectors';
import { Search, TrendingUp, Bell, Settings, User } from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  action: () => void;
}

export function CommandPalette() {
  const showCommandPalette = useUIStore(s => s.showCommandPalette);
  const toggleCommandPalette = useUIStore(s => s.toggleCommandPalette);
  const setView = useUIStore(s => s.setView);
  const marketData = useAppSelector(selectMarketDataMap);
  const { setSelectedSymbol, setPhase } = useMarketActions();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset local state when the palette transitions to closed.
  const [wasOpen, setWasOpen] = useState(showCommandPalette);
  if (showCommandPalette !== wasOpen) {
    setWasOpen(showCommandPalette);
    if (!showCommandPalette) {
      setSearchQuery('');
      setSelectedIndex(0);
    }
  }

  // Focus input when opened
  useEffect(() => {
    if (showCommandPalette) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [showCommandPalette]);

  const commands: CommandItem[] = [
    // Navigation
    {
      id: 'go-dashboard',
      label: 'Go to Dashboard',
      description: 'Switch to main trading view',
      icon: TrendingUp,
      shortcut: 'G D',
      action: () => {
        setView('dashboard');
        toggleCommandPalette();
      },
    },
    {
      id: 'go-morning-brief',
      label: 'Go to Morning Brief',
      description: 'View pre-market analysis',
      icon: TrendingUp,
      action: () => {
        setView('morning-brief');
        toggleCommandPalette();
      },
    },
    
    // Phase switching
    {
      id: 'phase-pre-market',
      label: 'Switch to Pre-Market',
      description: 'Scanner results & preparation',
      icon: TrendingUp,
      action: () => {
        setPhase('pre-market');
        toggleCommandPalette();
      },
    },
    {
      id: 'phase-open',
      label: 'Switch to Open',
      description: 'Top 3 names - execution mode',
      icon: TrendingUp,
      action: () => {
        setPhase('open');
        toggleCommandPalette();
      },
    },
    {
      id: 'phase-midday',
      label: 'Switch to Midday',
      description: 'Position management',
      icon: TrendingUp,
      action: () => {
        setPhase('midday');
        toggleCommandPalette();
      },
    },
    {
      id: 'phase-power-hour',
      label: 'Switch to Power Hour',
      description: 'Reversion & continuation',
      icon: TrendingUp,
      action: () => {
        setPhase('power-hour');
        toggleCommandPalette();
      },
    },
    
    // Settings
    {
      id: 'settings',
      label: 'Open Settings',
      description: 'Configure preferences',
      icon: Settings,
      shortcut: 'Cmd + ,',
      action: () => {
        toggleCommandPalette();
      },
    },
    {
      id: 'notifications',
      label: 'View Notifications',
      description: 'Check alerts and messages',
      icon: Bell,
      action: () => {
        toggleCommandPalette();
      },
    },
    {
      id: 'profile',
      label: 'View Profile',
      description: 'Account settings',
      icon: User,
      action: () => {
        toggleCommandPalette();
      },
    },
  ];

  // Add symbol commands
  const symbolCommands: CommandItem[] = Array.from(marketData.keys()).map(symbol => ({
    id: `symbol-${symbol}`,
    label: `View ${symbol}`,
    description: `Open ${symbol} chart and analysis`,
    icon: TrendingUp,
    action: () => {
      setSelectedSymbol(symbol);
      toggleCommandPalette();
    },
  }));

  const allCommands = [...commands, ...symbolCommands];

  // Filter commands based on search
  const filteredCommands = searchQuery
    ? allCommands.filter(cmd => 
        cmd.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cmd.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allCommands;

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
        }
        break;
      case 'Escape':
        e.preventDefault();
        toggleCommandPalette();
        break;
    }
  };

  if (!showCommandPalette) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-start justify-center pt-[20vh] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleCommandPalette();
      }}
    >
      <div className="glass-panel w-full max-w-xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <Search className="w-5 h-5 text-vanna-text-secondary" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-vanna-text placeholder:text-vanna-text-secondary/50 focus:outline-none"
          />
          <kbd className="px-2 py-1 text-xs font-mono bg-vanna-surface border border-white/10 rounded text-vanna-text-secondary">
            ESC
          </kbd>
        </div>

        {/* Commands list */}
        <div className="max-h-[50vh] overflow-auto">
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-8 text-center text-vanna-text-secondary">
              <p>No commands found</p>
            </div>
          ) : (
            <div className="py-2">
              {filteredCommands.map((command, index) => {
                const Icon = command.icon;
                const isSelected = index === selectedIndex;
                
                return (
                  <button
                    key={command.id}
                    onClick={command.action}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                      ${isSelected ? 'bg-vanna-cyan/10' : 'hover:bg-white/5'}`}
                  >
                    <Icon className={`w-4 h-4 ${isSelected ? 'text-vanna-cyan' : 'text-vanna-text-secondary'}`} />
                    <div className="flex-1">
                      <p className={`text-sm ${isSelected ? 'text-vanna-text' : 'text-vanna-text'}`}>
                        {command.label}
                      </p>
                      <p className="text-xs text-vanna-text-secondary">
                        {command.description}
                      </p>
                    </div>
                    {command.shortcut && (
                      <kbd className="px-2 py-0.5 text-[10px] font-mono bg-vanna-surface border border-white/10 rounded text-vanna-text-secondary">
                        {command.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 bg-vanna-surface-light/20">
          <div className="flex items-center gap-4 text-[10px] text-vanna-text-secondary">
            <span><kbd className="px-1 bg-vanna-surface rounded">↑↓</kbd> Navigate</span>
            <span><kbd className="px-1 bg-vanna-surface rounded">↵</kbd> Select</span>
          </div>
          <span className="text-[10px] text-vanna-text-secondary">
            {filteredCommands.length} commands
          </span>
        </div>
      </div>
    </div>
  );
}
