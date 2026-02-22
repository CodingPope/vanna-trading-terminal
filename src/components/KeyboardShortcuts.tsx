import { useUI } from '@/store';
import { X, Keyboard } from 'lucide-react';

export function KeyboardShortcuts() {
  const { state, toggleKeyboardShortcuts } = useUI();

  if (!state.showKeyboardShortcuts) return null;

  const navigationShortcuts = [
    { key: 'J', description: 'Navigate focus list down' },
    { key: 'K', description: 'Navigate focus list up' },
    { key: 'Tab', description: 'Switch trading phase' },
    { key: '1-4', description: 'Switch to phase 1-4' },
  ];

  const actionShortcuts = [
    { key: 'Space', description: 'Stage ticket' },
    { key: 'Enter', description: 'Execute order' },
    { key: 'A', description: 'Set alert' },
    { key: 'D', description: 'Dismiss item' },
  ];

  const systemShortcuts = [
    { key: '?', description: 'Show keyboard shortcuts' },
    { key: 'Cmd/Ctrl + K', description: 'Open command palette' },
    { key: 'Esc', description: 'Close modal / Cancel' },
    { key: '/', description: 'Focus search' },
  ];

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleKeyboardShortcuts();
      }}
    >
      <div className="glass-panel w-full max-w-2xl max-h-[80vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-vanna-cyan" />
            <h2 className="text-lg font-semibold text-vanna-text">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={toggleKeyboardShortcuts}
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-vanna-text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Navigation */}
          <div>
            <h3 className="text-[10px] text-vanna-text-secondary uppercase tracking-wider mb-3">
              Navigation
            </h3>
            <div className="space-y-2">
              {navigationShortcuts.map((shortcut) => (
                <div key={shortcut.key} className="flex items-center justify-between">
                  <kbd className="px-2 py-1 text-xs font-mono bg-vanna-surface border border-white/10 rounded text-vanna-text min-w-[60px] text-center">
                    {shortcut.key}
                  </kbd>
                  <span className="text-sm text-vanna-text-secondary flex-1 ml-3">
                    {shortcut.description}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div>
            <h3 className="text-[10px] text-vanna-text-secondary uppercase tracking-wider mb-3">
              Actions
            </h3>
            <div className="space-y-2">
              {actionShortcuts.map((shortcut) => (
                <div key={shortcut.key} className="flex items-center justify-between">
                  <kbd className="px-2 py-1 text-xs font-mono bg-vanna-surface border border-white/10 rounded text-vanna-text min-w-[60px] text-center">
                    {shortcut.key}
                  </kbd>
                  <span className="text-sm text-vanna-text-secondary flex-1 ml-3">
                    {shortcut.description}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* System */}
          <div>
            <h3 className="text-[10px] text-vanna-text-secondary uppercase tracking-wider mb-3">
              System
            </h3>
            <div className="space-y-2">
              {systemShortcuts.map((shortcut) => (
                <div key={shortcut.key} className="flex items-center justify-between">
                  <kbd className="px-2 py-1 text-xs font-mono bg-vanna-surface border border-white/10 rounded text-vanna-text min-w-[80px] text-center">
                    {shortcut.key}
                  </kbd>
                  <span className="text-sm text-vanna-text-secondary flex-1 ml-3">
                    {shortcut.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/5 bg-vanna-surface-light/20">
          <p className="text-xs text-vanna-text-secondary text-center">
            Press <kbd className="px-1.5 py-0.5 bg-vanna-surface border border-white/10 rounded">Esc</kbd> to close this dialog
          </p>
        </div>
      </div>
    </div>
  );
}
